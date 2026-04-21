"""
Módulo Emocional — 13 reglas
Evaluación: cada 6h + check-in diario
LÍMITES IRRENUNCIABLES: EMO-12 y EMO-13 siempre derivan a profesional
"""
from src.models import AlertCreate, AlertType, Module, AlertAction, RuleResult, UserContext


def evaluate_all(ctx: UserContext) -> list[RuleResult]:
    rules = [
        rule_EMO_01, rule_EMO_02, rule_EMO_03, rule_EMO_04, rule_EMO_05,
        rule_EMO_06, rule_EMO_07, rule_EMO_08, rule_EMO_09, rule_EMO_10,
        rule_EMO_11, rule_EMO_12, rule_EMO_13,
    ]
    return [r(ctx) for r in rules]


def rule_EMO_01(ctx: UserContext) -> RuleResult:
    """Check-in diario pendiente"""
    if ctx.last_checkin_days >= 1:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="EMO-01", module=Module.EMOTIONAL,
            type=AlertType.SUGGESTION, priority=3,
            title="Check-in de hoy pendiente",
            description="¿Cómo te encuentras hoy? Solo necesito 30 segundos para entenderte mejor.",
            primary_action=AlertAction(label="Hacer check-in", action_key="open_checkin"),
        ))
    return RuleResult(triggered=False, reason="Check-in completado hoy")


def rule_EMO_02(ctx: UserContext) -> RuleResult:
    """Sin check-in 3 días consecutivos"""
    if ctx.last_checkin_days >= 3:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="EMO-02", module=Module.EMOTIONAL,
            type=AlertType.WARNING, priority=2,
            title="Llevas 3 días sin check-in",
            description="He notado que no hemos hablado en unos días. ¿Todo bien? Estoy aquí cuando quieras.",
            primary_action=AlertAction(label="Conectar ahora", action_key="open_checkin"),
        ))
    return RuleResult(triggered=False, reason=f"Último check-in hace {ctx.last_checkin_days} días")


def rule_EMO_03(ctx: UserContext) -> RuleResult:
    """Semana de alta carga laboral detectada"""
    return RuleResult(triggered=False, reason="Requiere análisis de calendario")


def rule_EMO_04(ctx: UserContext) -> RuleResult:
    """Recordatorio de descanso activo"""
    from datetime import datetime
    hour = datetime.now().hour
    if hour == 11 or hour == 17:  # 11:00 y 17:00
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="EMO-04", module=Module.EMOTIONAL,
            type=AlertType.SUGGESTION, priority=4,
            title="Momento de descanso activo",
            description="Llevas horas trabajando. 5 minutos de estiramiento o una caminata corta mejoran el foco.",
            primary_action=AlertAction(label="Rutina rápida", action_key="view_rest_routine"),
        ))
    return RuleResult(triggered=False, reason="Fuera del horario de descanso")


def rule_EMO_05(ctx: UserContext) -> RuleResult:
    """Sugerencia de gratitud semanal"""
    from datetime import date
    if date.today().weekday() == 6:  # Domingo
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="EMO-05", module=Module.EMOTIONAL,
            type=AlertType.MOTIVATION, priority=4,
            title="Reflexión de fin de semana",
            description="¿Qué tres cosas buenas han pasado esta semana? La gratitud mejora el bienestar.",
            primary_action=AlertAction(label="Escribir reflexión", action_key="open_journal"),
        ))
    return RuleResult(triggered=False, reason="No es domingo")


def rule_EMO_06(ctx: UserContext) -> RuleResult:
    """Logro deportivo — refuerzo positivo"""
    if ctx.workout_days_week >= 3:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="EMO-06", module=Module.EMOTIONAL,
            type=AlertType.MOTIVATION, priority=4,
            title="¡Semana activa completada!",
            description=f"Has entrenado {ctx.workout_days_week} días esta semana. El ejercicio regular mejora el estado de ánimo.",
        ))
    return RuleResult(triggered=False, reason="Sin logros deportivos esta semana")


def rule_EMO_07(ctx: UserContext) -> RuleResult:
    """Patrón de sueño irregular detectado"""
    return RuleResult(triggered=False, reason="Requiere datos de sueño de Health Connect")


def rule_EMO_08(ctx: UserContext) -> RuleResult:
    """Estrés financiero detectado por contexto"""
    if ctx.monthly_expense_pct > 90 and ctx.bank_connected:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="EMO-08", module=Module.EMOTIONAL,
            type=AlertType.SUGGESTION, priority=3,
            title="El dinero puede generar estrés",
            description="He notado tensión en tus finanzas este mes. Hablar de ello puede ayudar — ¿cómo te sientes al respecto?",
            primary_action=AlertAction(label="Hablar con Kairo", action_key="open_chat"),
        ))
    return RuleResult(triggered=False, reason="Sin estrés financiero detectado")


def rule_EMO_09(ctx: UserContext) -> RuleResult:
    """Aislamiento social detectado"""
    if ctx.last_social_activity_days > 14:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="EMO-09", module=Module.EMOTIONAL,
            type=AlertType.SUGGESTION, priority=3,
            title="Llevas un tiempo sin actividad social",
            description="El contacto social es importante para el bienestar. ¿Te apetece quedar con alguien esta semana?",
            primary_action=AlertAction(label="Ver conexiones", action_key="open_social"),
        ))
    return RuleResult(triggered=False, reason="Actividad social dentro de lo normal")


def rule_EMO_10(ctx: UserContext) -> RuleResult:
    """Recordatorio de hobby o actividad placentera"""
    from datetime import date
    if date.today().weekday() == 4:  # Viernes
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="EMO-10", module=Module.EMOTIONAL,
            type=AlertType.SUGGESTION, priority=4,
            title="¡Es viernes! ¿Tienes planes?",
            description="El descanso activo y las actividades placenteras son esenciales para el bienestar.",
            primary_action=AlertAction(label="Ver planes", action_key="open_social"),
        ))
    return RuleResult(triggered=False, reason="No es viernes")


def rule_EMO_11(ctx: UserContext) -> RuleResult:
    """Mes con alto número de alertas urgentes"""
    return RuleResult(triggered=False, reason="Requiere análisis histórico de alertas")


def rule_EMO_12(ctx: UserContext) -> RuleResult:
    """
    LÍMITE IRRENUNCIABLE — Señales de crisis emocional severa
    Siempre deriva a profesional. Sin excepciones.
    """
    return RuleResult(triggered=False, reason="Solo activable por señales explícitas en chat")


def rule_EMO_13(ctx: UserContext) -> RuleResult:
    """
    LÍMITE IRRENUNCIABLE — Ideación autolesiva detectada
    Siempre muestra recursos de crisis. Sin excepciones.
    Activación: solo desde el módulo de chat con detección NLP
    """
    return RuleResult(triggered=False, reason="Solo activable por análisis NLP en chat")
