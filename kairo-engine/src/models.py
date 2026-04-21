from pydantic import BaseModel, Field
from typing import Optional, Any
from enum import Enum
from datetime import datetime
import uuid


class AlertType(str, Enum):
    URGENT     = "urgent"
    WARNING    = "warning"
    SUGGESTION = "suggestion"
    MOTIVATION = "motivation"
    CONNECTION = "connection"


class Module(str, Enum):
    SPORT     = "sport"
    LEGAL     = "legal"
    EMOTIONAL = "emotional"
    SOCIAL    = "social"
    FINANCIAL = "financial"


class AlertAction(BaseModel):
    label: str
    action_key: str
    payload: dict[str, Any] = {}


class AlertCreate(BaseModel):
    user_id: str
    rule_id: str
    module: Module
    type: AlertType
    title: str
    description: str
    priority: int = Field(default=2, ge=1, le=4)
    primary_action: Optional[AlertAction] = None
    secondary_action: Optional[AlertAction] = None
    metadata: dict[str, Any] = {}


class UserContext(BaseModel):
    """Contexto completo del usuario para evaluar reglas"""
    user_id: str
    name: str
    plan: str
    active_modules: list[str]
    city: str = "Madrid"
    birth_year: Optional[int] = None
    interests: list[str] = []
    # Preferencias
    silence_start: str = "22:00"
    silence_end: str = "08:00"
    max_daily_alerts: int = 5
    # Stats del día
    alerts_today: int = 0
    last_checkin_days: int = 0
    # Financiero
    bank_connected: bool = False
    monthly_expense_pct: float = 0.0   # % del presupuesto gastado
    subscriptions_total: float = 0.0
    # Deportivo
    steps_today: int = 0
    workout_days_week: int = 0
    # Laboral
    contracts_expiring_days: Optional[int] = None
    pending_documents: int = 0
    # Social
    connections_count: int = 0
    last_social_activity_days: int = 0


class RuleResult(BaseModel):
    """Resultado de evaluar una regla"""
    triggered: bool
    alert: Optional[AlertCreate] = None
    reason: str = ""
