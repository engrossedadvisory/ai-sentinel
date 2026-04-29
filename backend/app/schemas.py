from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict
from datetime import datetime
from .models import AgentStatus, RiskLevel, PolicyAction, MitigationStatus


# ── Agent ──────────────────────────────────────────────────────────────────

class AgentBase(BaseModel):
    name: str
    type: str = "unknown"
    version: str = "unknown"
    endpoint: Optional[str] = None
    capabilities: List[str] = []
    allowed_actions: List[str] = []
    owner: str = "unknown"
    environment: str = "unknown"
    deployment_source: str = "unknown"
    agent_metadata: Dict[str, Any] = {}


class AgentCreate(AgentBase):
    agent_id: Optional[str] = None
    is_authorized: bool = False


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    version: Optional[str] = None
    endpoint: Optional[str] = None
    status: Optional[AgentStatus] = None
    risk_level: Optional[RiskLevel] = None
    capabilities: Optional[List[str]] = None
    allowed_actions: Optional[List[str]] = None
    owner: Optional[str] = None
    environment: Optional[str] = None
    is_authorized: Optional[bool] = None
    agent_metadata: Optional[Dict[str, Any]] = None


class AgentOut(AgentBase):
    id: int
    agent_id: str
    status: AgentStatus
    risk_level: RiskLevel
    is_authorized: bool
    first_seen: datetime
    last_seen: datetime

    model_config = {"from_attributes": True}


# ── Policy ─────────────────────────────────────────────────────────────────

class PolicyCondition(BaseModel):
    type: str
    value: Any
    operator: str = "equals"


class PolicyBase(BaseModel):
    name: str
    description: str = ""
    enabled: bool = True
    priority: int = 100
    scope: Dict[str, Any] = {}
    conditions: List[Dict[str, Any]] = []
    action: PolicyAction
    action_config: Dict[str, Any] = {}


class PolicyCreate(PolicyBase):
    pass


class PolicyUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None
    priority: Optional[int] = None
    scope: Optional[Dict[str, Any]] = None
    conditions: Optional[List[Dict[str, Any]]] = None
    action: Optional[PolicyAction] = None
    action_config: Optional[Dict[str, Any]] = None


class PolicyOut(PolicyBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Activity ───────────────────────────────────────────────────────────────

class ActivityReport(BaseModel):
    agent_id: str
    activity_type: str
    action: str
    resource: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    source_ip: Optional[str] = None


class ActivityOut(BaseModel):
    id: int
    agent_id: str
    activity_type: str
    action: str
    resource: Optional[str]
    risk_score: float
    flagged: bool
    timestamp: datetime
    result: Optional[str]

    model_config = {"from_attributes": True}


# ── Detection ──────────────────────────────────────────────────────────────

class DetectionReport(BaseModel):
    detection_type: str
    source: str
    entity: Dict[str, Any]
    confidence: float = Field(ge=0.0, le=1.0)
    risk_assessment: Dict[str, Any] = {}


class DetectionOut(BaseModel):
    id: int
    detection_type: str
    source: str
    entity: Dict[str, Any]
    confidence: float
    risk_assessment: Dict[str, Any]
    status: str
    detected_at: datetime
    agent_id: Optional[int]

    model_config = {"from_attributes": True}


class DetectionStatusUpdate(BaseModel):
    status: str


# ── Mitigation ─────────────────────────────────────────────────────────────

class MitigationCreate(BaseModel):
    agent_id: Optional[int] = None
    violation_id: Optional[int] = None
    action_type: str
    action_config: Dict[str, Any] = {}
    initiated_by: str = "human"


class MitigationOut(BaseModel):
    id: int
    agent_id: Optional[int]
    violation_id: Optional[int]
    action_type: str
    action_config: Dict[str, Any]
    status: MitigationStatus
    initiated_by: str
    result: Optional[str]
    created_at: datetime
    completed_at: Optional[datetime]

    model_config = {"from_attributes": True}


# ── Policy Violation ───────────────────────────────────────────────────────

class ViolationOut(BaseModel):
    id: int
    agent_id: Optional[int]
    policy_id: Optional[int]
    violation_details: Dict[str, Any]
    severity: RiskLevel
    status: str
    detected_at: datetime
    resolved_at: Optional[datetime]

    model_config = {"from_attributes": True}


# ── Dashboard ──────────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_agents: int
    active_agents: int
    quarantined_agents: int
    unauthorized_agents: int
    active_policies: int
    open_violations: int
    pending_mitigations: int
    new_detections: int
    risk_distribution: Dict[str, int]
    activity_last_24h: int
