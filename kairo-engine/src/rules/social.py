"""
Módulo Social — 14 reglas
Evaluación: diaria + semanal
"""
from src.models import AlertCreate, AlertType, Module, AlertAction, RuleResult, UserContext


def evaluate_all(ctx: UserContext) -> list[RuleResult]:
    rules = [
        rule_SOC_01, rule_SOC_02, rule_SOC_03, rule_SOC_04, rule_SOC_05, rule_SOC_06,
        rule_SOC_07, rule_SOC_08, rule_SOC_09, rule_SOC_10, rule_SOC_11, rule_SOC_12,
        rule_SOC_13, rule_SOC_14,
    ]
    return [r(ctx) for r in rules]


def rule_SOC_01(ctx: UserContext) -> RuleResult:
    """Nuevas sugerencias de conexión disponibles"""
    if ctx.connections_count < 5:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="SOC-01", module=Module.SOCIAL,
            type=AlertType.CONNECTION, priority=3,
            title="Nuevas personas compatibles",
            description="He encontrado personas en tu zona con intereses similares. ¿Las conocemos?",
            primary_action=AlertAction(label="Ver sugerencias", action_key="view_connections"),
        ))
    return RuleResult(triggered=False, reason="Conexiones suficientes")


def rule_SOC_02(ctx: UserContext) -> RuleResult:
    """Conexión pendiente de aceptar hace más de 3 días"""
    return RuleResult(triggered=False, reason="Requiere datos de conexiones pendientes")


def rule_SOC_03(ctx: UserContext) -> RuleResult:
    """Plan social compatible disponible este fin de semana"""
    from datetime import date
    today = date.today()
    if today.weekday() == 3:  # Jueves — recordatorio para el finde
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="SOC-03", module=Module.SOCIAL,
            type=AlertType.SUGGESTION, priority=3,
            title="Planes para este fin de semana",
            description="He encontrado actividades compatibles con tus intereses cerca de ti este fin de semana.",
            primary_action=AlertAction(label="Ver planes", action_key="view_plans"),
        ))
    return RuleResult(triggered=False, reason="No es jueves")


def rule_SOC_04(ctx: UserContext) -> RuleResult:
    """Cumpleaños de conexión próximo"""
    return RuleResult(triggered=False, reason="Requiere datos de cumpleaños de conexiones")


def rule_SOC_05(ctx: UserContext) -> RuleResult:
    """Hueco libre en agenda para plan social"""
    return RuleResult(triggered=False, reason="Requiere integración con calendario")


def rule_SOC_06(ctx: UserContext) -> RuleResult:
    """Evento de interés cercano (Ticketmaster/Eventbrite)"""
    return RuleResult(triggered=False, reason="Requiere integración con APIs de eventos")


def rule_SOC_07(ctx: UserContext) -> RuleResult:
    """Grupo compatible detectado en tu zona"""
    return RuleResult(triggered=False, reason="Requiere datos de grupos activos")


def rule_SOC_08(ctx: UserContext) -> RuleResult:
    """Conexión sin contacto más de 30 días"""
    return RuleResult(triggered=False, reason="Requiere histórico de interacciones")


def rule_SOC_09(ctx: UserContext) -> RuleResult:
    """Primera conexión — motivación para interactuar"""
    if ctx.connections_count == 1:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="SOC-09", module=Module.SOCIAL,
            type=AlertType.MOTIVATION, priority=4,
            title="¡Primera conexión realizada!",
            description="Has hecho tu primera conexión en Kairo. El primer paso es siempre el más importante.",
            primary_action=AlertAction(label="Enviar mensaje", action_key="open_chat_connection"),
        ))
    return RuleResult(triggered=False, reason="Sin primera conexión o ya tiene varias")


def rule_SOC_10(ctx: UserContext) -> RuleResult:
    """Plan creado sin confirmación de asistencia"""
    return RuleResult(triggered=False, reason="Requiere datos de planes creados")


def rule_SOC_11(ctx: UserContext) -> RuleResult:
    """Aislamiento social prolongado"""
    if ctx.last_social_activity_days > 21:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="SOC-11", module=Module.SOCIAL,
            type=AlertType.WARNING, priority=2,
            title="Llevas tiempo sin actividad social",
            description="Más de 3 semanas sin actividad social. Las conexiones son importantes para el bienestar.",
            primary_action=AlertAction(label="Explorar conexiones", action_key="view_connections"),
        ))
    return RuleResult(triggered=False, reason="Actividad social normal")


def rule_SOC_12(ctx: UserContext) -> RuleResult:
    """Grupos compatibles disponibles"""
    return RuleResult(triggered=False, reason="Requiere datos de grupos por intereses")


def rule_SOC_13(ctx: UserContext) -> RuleResult:
    """Aniversario de conexión — fortalecer vínculo"""
    return RuleResult(triggered=False, reason="Requiere histórico de conexiones")


def rule_SOC_14(ctx: UserContext) -> RuleResult:
    """Resumen social semanal"""
    from datetime import date
    if date.today().weekday() == 6:  # Domingo
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="SOC-14", module=Module.SOCIAL,
            type=AlertType.SUGGESTION, priority=4,
            title="Resumen social de la semana",
            description="Esta semana has tenido actividad social. ¿Cómo ha ido? ¿Alguien con quien quieras quedar pronto?",
            primary_action=AlertAction(label="Ver conexiones", action_key="view_connections"),
        ))
    return RuleResult(triggered=False, reason="No es domingo")
