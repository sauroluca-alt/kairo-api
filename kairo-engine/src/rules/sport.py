"""
Módulo Deportivo — 12 reglas
Evaluación: cada 6h + sync Health Connect
"""
from src.models import AlertCreate, AlertType, Module, AlertAction, RuleResult, UserContext


def evaluate_all(ctx: UserContext) -> list[RuleResult]:
    rules = [
        rule_DEP_01, rule_DEP_02, rule_DEP_03, rule_DEP_04, rule_DEP_05, rule_DEP_06,
        rule_DEP_07, rule_DEP_08, rule_DEP_09, rule_DEP_10, rule_DEP_11, rule_DEP_12,
    ]
    return [r(ctx) for r in rules]


def rule_DEP_01(ctx: UserContext) -> RuleResult:
    """Objetivo de pasos diarios no alcanzado a las 20:00"""
    from datetime import datetime
    hour = datetime.now().hour
    if hour >= 20 and ctx.steps_today < 7000:
        deficit = 7000 - ctx.steps_today
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="DEP-01", module=Module.SPORT,
            type=AlertType.SUGGESTION, priority=3,
            title=f"Te faltan {deficit:,} pasos para hoy",
            description=f"Llevas {ctx.steps_today:,} pasos. Una caminata de 20 minutos te acerca al objetivo.",
            primary_action=AlertAction(label="Ver ruta", action_key="view_walking_route"),
        ))
    return RuleResult(triggered=False, reason=f"Pasos: {ctx.steps_today}")


def rule_DEP_02(ctx: UserContext) -> RuleResult:
    """Objetivo de pasos alcanzado — refuerzo positivo"""
    if ctx.steps_today >= 10000:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="DEP-02", module=Module.SPORT,
            type=AlertType.MOTIVATION, priority=4,
            title=f"¡{ctx.steps_today:,} pasos hoy!",
            description="Has superado los 10.000 pasos. Excelente jornada activa.",
        ))
    return RuleResult(triggered=False, reason="Objetivo no alcanzado aún")


def rule_DEP_03(ctx: UserContext) -> RuleResult:
    """3 días sin actividad física"""
    if ctx.workout_days_week == 0 and ctx.steps_today < 3000:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="DEP-03", module=Module.SPORT,
            type=AlertType.WARNING, priority=3,
            title="Llevas días sin actividad",
            description="El movimiento diario mejora la energía y el estado de ánimo. ¿Empezamos con algo suave?",
            primary_action=AlertAction(label="Rutina de 10 min", action_key="view_workout"),
        ))
    return RuleResult(triggered=False, reason="Actividad dentro de lo normal")


def rule_DEP_04(ctx: UserContext) -> RuleResult:
    """Semana deportiva completada"""
    if ctx.workout_days_week >= 5:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="DEP-04", module=Module.SPORT,
            type=AlertType.MOTIVATION, priority=4,
            title="¡Semana deportiva completada!",
            description=f"Has entrenado {ctx.workout_days_week} días esta semana. Consistencia es la clave.",
        ))
    return RuleResult(triggered=False, reason="Semana no completada")


def rule_DEP_05(ctx: UserContext) -> RuleResult:
    """Recordatorio hidratación"""
    from datetime import datetime
    hour = datetime.now().hour
    if hour in [10, 14, 17] and ctx.steps_today > 3000:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="DEP-05", module=Module.SPORT,
            type=AlertType.SUGGESTION, priority=4,
            title="Momento de hidratarte",
            description="Con tu nivel de actividad, asegúrate de beber agua regularmente.",
        ))
    return RuleResult(triggered=False, reason="No es hora de recordatorio de hidratación")


def rule_DEP_06(ctx: UserContext) -> RuleResult:
    """Tiempo óptimo para entrenar según agenda"""
    return RuleResult(triggered=False, reason="Requiere integración con calendario")


def rule_DEP_07(ctx: UserContext) -> RuleResult:
    """FC en reposo elevada"""
    return RuleResult(triggered=False, reason="Requiere datos de frecuencia cardíaca")


def rule_DEP_08(ctx: UserContext) -> RuleResult:
    """Sesión de activación sugerida (mañana)"""
    from datetime import datetime
    hour = datetime.now().hour
    if hour == 7 and ctx.workout_days_week < 3:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="DEP-08", module=Module.SPORT,
            type=AlertType.SUGGESTION, priority=3,
            title="Buenos días — ¿empezamos activos?",
            description="10 minutos de activación por la mañana aumentan la energía y el foco durante el día.",
            primary_action=AlertAction(label="Rutina matutina", action_key="view_morning_routine"),
        ))
    return RuleResult(triggered=False, reason="No es momento de activación matutina")


def rule_DEP_09(ctx: UserContext) -> RuleResult:
    """Racha de pasos consecutivos"""
    return RuleResult(triggered=False, reason="Requiere histórico de pasos")


def rule_DEP_10(ctx: UserContext) -> RuleResult:
    """Sueño insuficiente detectado"""
    return RuleResult(triggered=False, reason="Requiere datos de sueño")


def rule_DEP_11(ctx: UserContext) -> RuleResult:
    """Competición o evento deportivo próximo"""
    return RuleResult(triggered=False, reason="Requiere datos de eventos deportivos")


def rule_DEP_12(ctx: UserContext) -> RuleResult:
    """Recuperación activa post-entrenamiento intenso"""
    return RuleResult(triggered=False, reason="Requiere análisis de intensidad de entrenos")
