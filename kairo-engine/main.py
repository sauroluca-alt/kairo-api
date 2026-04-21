import os
import asyncio
import structlog
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Header, Depends
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from dotenv import load_dotenv

from src.models import UserContext
from src.services.engine import evaluate_user, dispatch_alerts

load_dotenv()
logger = structlog.get_logger()

API_URL    = os.getenv("KAIRO_API_URL", "http://localhost:3001/api/v1")
API_SECRET = os.getenv("ALERT_ENGINE_SECRET", "secreto")
SERVICE_SECRET = os.getenv("ALERT_ENGINE_SECRET", "secreto")

scheduler = AsyncIOScheduler()


# ── JOBS PROGRAMADOS ───────────────────────────────────────────────────────────
async def run_full_evaluation():
    """Evaluación completa de todos los usuarios — cada 6 horas"""
    logger.info("evaluacion_iniciada")
    try:
        async with __import__('asyncpg').create_pool(os.getenv("DATABASE_URL")) as pool:
            users = await pool.fetch("""
                SELECT u.id, u.name, u.plan, u.active_modules, u.city,
                       u.birth_year, u.interests,
                       p.silence_start::text, p.silence_end::text,
                       p.max_daily_alerts,
                       (SELECT COUNT(*) FROM alerts
                        WHERE user_id = u.id AND created_at >= CURRENT_DATE) as alerts_today,
                       (SELECT COALESCE(MAX(CURRENT_DATE - created_at::date), 999)
                        FROM mood_checkins WHERE user_id = u.id) as last_checkin_days,
                       (SELECT COUNT(*) > 0 FROM financial_accounts
                        WHERE user_id = u.id AND sync_status = 'synced') as bank_connected
                FROM users u
                LEFT JOIN user_preferences p ON p.user_id = u.id
                WHERE u.deleted_at IS NULL AND u.plan != 'koral'
            """)

            total_alerts = 0
            for row in users:
                ctx = UserContext(
                    user_id=str(row['id']),
                    name=row['name'],
                    plan=row['plan'],
                    active_modules=row['active_modules'] or [],
                    city=row['city'],
                    birth_year=row['birth_year'],
                    interests=row['interests'] or [],
                    silence_start=str(row['silence_start'] or '22:00')[:5],
                    silence_end=str(row['silence_end'] or '08:00')[:5],
                    max_daily_alerts=row['max_daily_alerts'] or 5,
                    alerts_today=int(row['alerts_today'] or 0),
                    last_checkin_days=int(row['last_checkin_days'] or 0),
                    bank_connected=bool(row['bank_connected']),
                )
                alerts = await evaluate_user(ctx)
                saved = await dispatch_alerts(alerts, API_URL, API_SECRET)
                total_alerts += saved

            logger.info("evaluacion_completada", users=len(users), alerts_created=total_alerts)
    except Exception as e:
        logger.error("error_evaluacion", error=str(e))


# ── LIFECYCLE ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Arranque
    scheduler.add_job(run_full_evaluation, CronTrigger(hour="*/6"), id="full_eval", replace_existing=True)
    scheduler.start()
    logger.info("motor_arrancado", jobs=len(scheduler.get_jobs()))
    yield
    # Cierre
    scheduler.shutdown()
    logger.info("motor_detenido")


# ── APP FASTAPI ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Kairo Alert Engine",
    description="Motor de alertas proactivas — 72 reglas en 5 módulos",
    version="1.0.0",
    lifespan=lifespan
)


def verify_secret(x_service_secret: str = Header(...)):
    if x_service_secret != SERVICE_SECRET:
        raise HTTPException(status_code=401, detail="Secreto de servicio inválido")


# GET /health
@app.get("/health")
async def health():
    jobs = [{"id": j.id, "next_run": str(j.next_run_time)} for j in scheduler.get_jobs()]
    return {"status": "ok", "version": "1.0.0", "scheduled_jobs": jobs}


# POST /evaluate/{user_id} — evaluación manual de un usuario
@app.post("/evaluate/{user_id}", dependencies=[Depends(verify_secret)])
async def evaluate_one(user_id: str, ctx: UserContext):
    if ctx.user_id != user_id:
        raise HTTPException(status_code=400, detail="user_id no coincide")
    alerts = await evaluate_user(ctx)
    saved = await dispatch_alerts(alerts, API_URL, API_SECRET)
    return {
        "user_id": user_id,
        "alerts_generated": len(alerts),
        "alerts_saved": saved,
        "rules_triggered": [a.rule_id for a in alerts]
    }


# POST /evaluate/batch — evaluación manual de todos (trigger inmediato)
@app.post("/evaluate/batch", dependencies=[Depends(verify_secret)])
async def evaluate_batch():
    asyncio.create_task(run_full_evaluation())
    return {"message": "Evaluación batch iniciada en background"}


# POST /users/{user_id}/modules — notificación de cambio de módulos
@app.post("/users/{user_id}/modules", dependencies=[Depends(verify_secret)])
async def update_modules(user_id: str, body: dict):
    logger.info("modulos_actualizados", user_id=user_id, modules=body.get("active_modules"))
    return {"message": "Módulos actualizados en motor de alertas"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True, log_level="info")
