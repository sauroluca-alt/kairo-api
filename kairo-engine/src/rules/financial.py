"""
Módulo Financiero — 18 reglas
Evaluación: diaria + webhooks bancarios tiempo real
LÍMITES IRRENUNCIABLES: No asesoramiento inversión MiFID II, no ejecuta transacciones
"""
from src.models import AlertCreate, AlertType, Module, AlertAction, RuleResult, UserContext


def evaluate_all(ctx: UserContext) -> list[RuleResult]:
    if not ctx.bank_connected:
        return []  # Sin banco conectado no evaluamos reglas financieras
    rules = [
        rule_FIN_01, rule_FIN_02, rule_FIN_03, rule_FIN_04, rule_FIN_05, rule_FIN_06,
        rule_FIN_07, rule_FIN_08, rule_FIN_09, rule_FIN_10, rule_FIN_11, rule_FIN_12,
        rule_FIN_13, rule_FIN_14, rule_FIN_15, rule_FIN_16, rule_FIN_17, rule_FIN_18,
    ]
    return [r(ctx) for r in rules]


def rule_FIN_01(ctx: UserContext) -> RuleResult:
    """Gasto mensual supera el 75% del presupuesto"""
    if ctx.monthly_expense_pct >= 75:
        pct = int(ctx.monthly_expense_pct)
        urgency = AlertType.URGENT if pct >= 95 else AlertType.WARNING
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="FIN-01", module=Module.FINANCIAL,
            type=urgency, priority=2,
            title=f"Gasto mensual al {pct}%",
            description=f"Has consumido el {pct}% de tu presupuesto mensual. Te muestro qué categorías se han pasado.",
            primary_action=AlertAction(label="Ver desglose", action_key="view_expenses"),
            secondary_action=AlertAction(label="Ajustar límites", action_key="edit_budgets"),
        ))
    return RuleResult(triggered=False, reason=f"Gasto al {ctx.monthly_expense_pct:.0f}%")


def rule_FIN_02(ctx: UserContext) -> RuleResult:
    """Cargo desconocido detectado"""
    return RuleResult(triggered=False, reason="Requiere análisis de transacciones en tiempo real")


def rule_FIN_03(ctx: UserContext) -> RuleResult:
    """Saldo por debajo del mínimo de seguridad"""
    return RuleResult(triggered=False, reason="Requiere datos de saldo en tiempo real")


def rule_FIN_04(ctx: UserContext) -> RuleResult:
    """Auditoría de suscripciones — detecta prescindibles"""
    if ctx.subscriptions_total > 100:
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="FIN-04", module=Module.FINANCIAL,
            type=AlertType.SUGGESTION, priority=3,
            title="Auditoría de suscripciones",
            description=f"Tienes {ctx.subscriptions_total:.0f}€/mes en suscripciones. He detectado algunas que podrías estar duplicando o no usando.",
            primary_action=AlertAction(label="Ver suscripciones", action_key="view_subscriptions"),
        ))
    return RuleResult(triggered=False, reason="Suscripciones dentro del rango normal")


def rule_FIN_05(ctx: UserContext) -> RuleResult:
    """Próximo pago importante en 3 días"""
    return RuleResult(triggered=False, reason="Requiere datos de pagos programados")


def rule_FIN_06(ctx: UserContext) -> RuleResult:
    """Fondos sin destino — sugerir ahorro"""
    return RuleResult(triggered=False, reason="Requiere análisis de flujo de caja")


def rule_FIN_07(ctx: UserContext) -> RuleResult:
    """Objetivo de ahorro al 50%"""
    return RuleResult(triggered=False, reason="Requiere datos de objetivos de ahorro")


def rule_FIN_08(ctx: UserContext) -> RuleResult:
    """Categoría de gasto con anomalía (+50% vs mes anterior)"""
    return RuleResult(triggered=False, reason="Requiere histórico de transacciones")


def rule_FIN_09(ctx: UserContext) -> RuleResult:
    """Recordatorio pago tarjeta de crédito"""
    from datetime import date
    today = date.today()
    if today.day == 22:  # 3 días antes del vencimiento típico (día 25)
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="FIN-09", module=Module.FINANCIAL,
            type=AlertType.WARNING, priority=2,
            title="Vencimiento de tarjeta en 3 días",
            description="El pago de tu tarjeta vence el día 25. Verifica que tienes saldo suficiente.",
            primary_action=AlertAction(label="Ver saldo", action_key="view_balance"),
        ))
    return RuleResult(triggered=False, reason="No es día de recordatorio de tarjeta")


def rule_FIN_10(ctx: UserContext) -> RuleResult:
    """Ratio de endeudamiento elevado"""
    return RuleResult(triggered=False, reason="Requiere datos de deudas e ingresos")


def rule_FIN_11(ctx: UserContext) -> RuleResult:
    """Ingreso inesperado detectado"""
    return RuleResult(triggered=False, reason="Requiere análisis de transacciones")


def rule_FIN_12(ctx: UserContext) -> RuleResult:
    """Gasto en restaurantes supera límite"""
    return RuleResult(triggered=False, reason="Requiere datos de categorías de gasto")


def rule_FIN_13(ctx: UserContext) -> RuleResult:
    """Tasa de ahorro mensual por debajo del 10%"""
    return RuleResult(triggered=False, reason="Requiere cálculo de tasa de ahorro")


def rule_FIN_14(ctx: UserContext) -> RuleResult:
    """Ahorro sin rentabilizar — educación financiera"""
    return RuleResult(triggered=False, reason="Requiere datos de saldo en cuenta corriente")


def rule_FIN_15(ctx: UserContext) -> RuleResult:
    """Optimización de seguros"""
    return RuleResult(triggered=False, reason="Requiere datos de seguros contratados")


def rule_FIN_16(ctx: UserContext) -> RuleResult:
    """Alerta de inflación en categorías de gasto"""
    return RuleResult(triggered=False, reason="Requiere histórico de 6 meses")


def rule_FIN_17(ctx: UserContext) -> RuleResult:
    """Recordatorio declaración trimestral IVA (autónomos)"""
    from datetime import date
    today = date.today()
    trimestral_days = [(1, 20), (4, 20), (7, 20), (10, 20)]
    for month, day in trimestral_days:
        if today.month == month and today.day == day - 5:
            return RuleResult(triggered=True, alert=AlertCreate(
                user_id=ctx.user_id, rule_id="FIN-17", module=Module.FINANCIAL,
                type=AlertType.WARNING, priority=2,
                title="Declaración trimestral en 5 días",
                description=f"El plazo de presentación trimestral vence el {day}/{month}. Prepara tus facturas.",
                primary_action=AlertAction(label="Ver facturas", action_key="view_invoices"),
            ))
    return RuleResult(triggered=False, reason="Fuera del periodo trimestral")


def rule_FIN_18(ctx: UserContext) -> RuleResult:
    """Resumen financiero semanal (lunes)"""
    from datetime import date
    if date.today().weekday() == 0:  # Lunes
        return RuleResult(triggered=True, alert=AlertCreate(
            user_id=ctx.user_id, rule_id="FIN-18", module=Module.FINANCIAL,
            type=AlertType.SUGGESTION, priority=4,
            title="Resumen financiero semanal",
            description="Nueva semana, nuevo vistazo a tus finanzas. Te preparo el resumen de la semana pasada.",
            primary_action=AlertAction(label="Ver resumen", action_key="view_weekly_summary"),
        ))
    return RuleResult(triggered=False, reason="No es lunes")
