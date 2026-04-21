"""
Motor de alertas de Kairo
Evalúa las 72 reglas para todos los usuarios activos
"""
import structlog
import httpx
from src.models import UserContext, AlertCreate
from src.rules import legal, financial, emotional, sport, social

logger = structlog.get_logger()

MODULE_EVALUATORS = {
    "legal":     legal.evaluate_all,
    "financial": financial.evaluate_all,
    "emotional": emotional.evaluate_all,
    "sport":     sport.evaluate_all,
    "social":    social.evaluate_all,
}


async def evaluate_user(ctx: UserContext) -> list[AlertCreate]:
    """Evalúa todas las reglas activas para un usuario y devuelve las alertas a crear."""
    alerts: list[AlertCreate] = []

    for module_name in ctx.active_modules:
        evaluator = MODULE_EVALUATORS.get(module_name)
        if not evaluator:
            continue

        try:
            results = evaluator(ctx)
            for result in results:
                if result.triggered and result.alert:
                    alerts.append(result.alert)
                    logger.info("regla_disparada",
                        user_id=ctx.user_id,
                        rule_id=result.alert.rule_id,
                        module=module_name)
        except Exception as e:
            logger.error("error_evaluando_modulo",
                user_id=ctx.user_id,
                module=module_name,
                error=str(e))

    # Aplicar límite diario de alertas
    alerts = _apply_daily_limit(alerts, ctx)
    # Aplicar silencio nocturno
    if _is_silence_time(ctx):
        alerts = [a for a in alerts if a.priority == 1]  # Solo urgentes

    return alerts


def _apply_daily_limit(alerts: list[AlertCreate], ctx: UserContext) -> list[AlertCreate]:
    """Respeta el máximo de alertas diarias configurado por el usuario."""
    remaining = ctx.max_daily_alerts - ctx.alerts_today
    if remaining <= 0:
        return [a for a in alerts if a.priority == 1]  # Solo urgentes pasan
    return sorted(alerts, key=lambda a: a.priority)[:remaining]


def _is_silence_time(ctx: UserContext) -> bool:
    """Comprueba si estamos en periodo de silencio nocturno."""
    from datetime import datetime
    now = datetime.now()
    current = now.hour * 60 + now.minute

    def time_to_minutes(t: str) -> int:
        h, m = map(int, t.split(":"))
        return h * 60 + m

    start = time_to_minutes(ctx.silence_start)
    end   = time_to_minutes(ctx.silence_end)

    if start > end:  # Cruza medianoche (22:00 → 08:00)
        return current >= start or current < end
    return start <= current < end


async def dispatch_alerts(alerts: list[AlertCreate], api_url: str, api_secret: str) -> int:
    """Envía las alertas generadas a la API REST de Node.js para persistirlas."""
    if not alerts:
        return 0

    saved = 0
    async with httpx.AsyncClient(timeout=10.0) as client:
        for alert in alerts:
            try:
                resp = await client.post(
                    f"{api_url}/internal/alerts",
                    json=alert.model_dump(),
                    headers={"X-Service-Secret": api_secret}
                )
                if resp.status_code in [200, 201]:
                    saved += 1
                    logger.info("alerta_guardada", rule_id=alert.rule_id, user_id=alert.user_id)
                else:
                    logger.warning("error_guardando_alerta",
                        rule_id=alert.rule_id,
                        status=resp.status_code)
            except Exception as e:
                logger.error("error_dispatch", rule_id=alert.rule_id, error=str(e))

    return saved
