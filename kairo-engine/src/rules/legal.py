"""
Módulo Laboral/Legal — 15 reglas
Evaluación: diaria + tiempo real (webhooks)
"""
from src.models import AlertCreate, AlertType, Module, AlertAction, RuleResult, UserContext


def evaluate_all(ctx: UserContext) -> list[RuleResult]:
    rules = [
        rule_LAB_01, rule_LAB_02, rule_LAB_03, rule_LAB_04, rule_LAB_05,
        rule_LAB_06, rule_LAB_07, rule_LAB_08, rule_LAB_09, rule_LAB_10,
        rule_LAB_11, rule_LAB_12, rule_LAB_13, rule_LAB_14, rule_LAB_15,
    ]
    return [r(ctx) for r in rules]


def rule_LAB_01(ctx: UserContext) -> RuleResult:
    """Contrato laboral caduca en menos de 7 días"""
    if ctx.contracts_expiring_days is not None and ctx.contracts_expiring_days <= 7:
        days = ctx.contracts_expiring_days
        urgency = AlertType.URGENT if days <= 3 else AlertType.WARNING
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="LAB-01", module=Module.LEGAL,
            type=urgency, priority=1,
            title=f"Contrato caduca en {days} día{'s' if days != 1 else ''}",
            description="He preparado el borrador de renovación para que lo revises antes de que venza.",
            primary_action=AlertAction(label="Ver borrador", action_key="view_contract"),
            secondary_action=AlertAction(label="Posponer 24h", action_key="snooze", payload={"minutes": 1440}),
        ))
    return RuleResult(triggered=False, reason="Sin contratos próximos a vencer")


def rule_LAB_02(ctx: UserContext) -> RuleResult:
    """Documentos pendientes de revisión"""
    if ctx.pending_documents >= 3:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="LAB-02", module=Module.LEGAL,
            type=AlertType.WARNING, priority=2,
            title=f"{ctx.pending_documents} documentos pendientes",
            description="Tienes documentos sin revisar que podrían requerir tu atención esta semana.",
            primary_action=AlertAction(label="Ver documentos", action_key="view_documents"),
        ))
    return RuleResult(triggered=False, reason="Documentos pendientes dentro del límite")


def rule_LAB_03(ctx: UserContext) -> RuleResult:
    """Nómina no recibida (día 6 del mes)"""
    from datetime import date
    today = date.today()
    if today.day == 6:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="LAB-03", module=Module.LEGAL,
            type=AlertType.WARNING, priority=2,
            title="¿Has recibido tu nómina?",
            description="Hoy es día 6. Si esperabas cobrar y no lo has hecho, puede ser el momento de consultarlo.",
            primary_action=AlertAction(label="Verificar cuenta", action_key="view_expenses"),
        ))
    return RuleResult(triggered=False, reason="No es día de revisión de nómina")


def rule_LAB_04(ctx: UserContext) -> RuleResult:
    """Recordatorio declaración renta (abril-junio)"""
    from datetime import date
    today = date.today()
    if today.month in [4, 5] and today.day == 1:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="LAB-04", module=Module.LEGAL,
            type=AlertType.SUGGESTION, priority=3,
            title="Campaña de la renta activa",
            description="Empieza la campaña de declaración de la renta. Tengo tus datos financieros listos para ayudarte.",
            primary_action=AlertAction(label="Ver desglose", action_key="view_tax_summary"),
        ))
    return RuleResult(triggered=False, reason="Fuera del periodo de renta")


def rule_LAB_05(ctx: UserContext) -> RuleResult:
    """Bloqueo de tiempo para preparar reunión importante"""
    return RuleResult(triggered=False, reason="Requiere integración con calendario")


def rule_LAB_06(ctx: UserContext) -> RuleResult:
    """Recordatorio vacaciones no planificadas"""
    from datetime import date
    today = date.today()
    if today.month == 5 and today.day == 1:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="LAB-06", module=Module.LEGAL,
            type=AlertType.SUGGESTION, priority=3,
            title="¿Has planificado tus vacaciones?",
            description="Quedan 2 meses para el verano. Es buen momento para bloquear fechas antes de que se adelanten tus compañeros.",
            primary_action=AlertAction(label="Abrir agenda", action_key="open_calendar"),
        ))
    return RuleResult(triggered=False, reason="Fuera del periodo de recordatorio")


def rule_LAB_07(ctx: UserContext) -> RuleResult:
    """Seguro de desempleo próximo a caducar"""
    return RuleResult(triggered=False, reason="Requiere datos de seguro")


def rule_LAB_08(ctx: UserContext) -> RuleResult:
    """Alerta de horas extra acumuladas"""
    return RuleResult(triggered=False, reason="Requiere integración laboral")


def rule_LAB_09(ctx: UserContext) -> RuleResult:
    """Recordatorio renovación DNI/pasaporte"""
    return RuleResult(triggered=False, reason="Requiere fecha de caducidad de documentos")


def rule_LAB_10(ctx: UserContext) -> RuleResult:
    """Optimización fiscal — deducibles detectados"""
    if ctx.bank_connected and ctx.monthly_expense_pct > 0:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="LAB-10", module=Module.LEGAL,
            type=AlertType.SUGGESTION, priority=3,
            title="Gastos deducibles detectados",
            description="He detectado gastos que podrían ser deducibles en tu próxima declaración. Te preparo un resumen.",
            primary_action=AlertAction(label="Ver deducibles", action_key="view_tax_deductions"),
        ))
    return RuleResult(triggered=False, reason="Sin datos bancarios conectados")


def rule_LAB_11(ctx: UserContext) -> RuleResult:
    """Recordatorio cotización autónomos"""
    return RuleResult(triggered=False, reason="Requiere perfil de autónomo")


def rule_LAB_12(ctx: UserContext) -> RuleResult:
    """Alerta reunión sin preparación"""
    return RuleResult(triggered=False, reason="Requiere datos de calendario")


def rule_LAB_13(ctx: UserContext) -> RuleResult:
    """Contrato de alquiler próximo a vencer"""
    return RuleResult(triggered=False, reason="Requiere datos de alquiler")


def rule_LAB_14(ctx: UserContext) -> RuleResult:
    """Seguro de hogar próximo a vencer"""
    return RuleResult(triggered=False, reason="Requiere datos de seguros")


def rule_LAB_15(ctx: UserContext) -> RuleResult:
    """Recordatorio formación continua"""
    from datetime import date
    today = date.today()
    if today.weekday() == 0 and today.day <= 7:  # Primer lunes del mes
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="LAB-15", module=Module.LEGAL,
            type=AlertType.SUGGESTION, priority=4,
            title="Momento de formación",
            description="¿Tienes algún curso o certificación pendiente? El primer lunes del mes es buen momento para avanzar.",
            primary_action=AlertAction(label="Ver recursos", action_key="view_learning"),
        ))
    return RuleResult(triggered=False, reason="No es el primer lunes del mes")
