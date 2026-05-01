from sqlalchemy import (
    Column, Integer, String, DateTime, JSON, Boolean, Float,
    ForeignKey, Text, Enum as SAEnum
)
from sqlalchemy.orm import relationship
from .database import Base
import enum
from datetime import datetime, timezone


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AgentStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    QUARANTINED = "quarantined"
    UNKNOWN = "unknown"


class RiskLevel(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class PolicyAction(str, enum.Enum):
    ALLOW = "allow"
    WARN = "warn"
    BLOCK = "block"
    QUARANTINE = "quarantine"
    TERMINATE = "terminate"
    ESCALATE = "escalate"


class MitigationStatus(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


class Agent(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(String, unique=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, default="unknown")
    version = Column(String, default="unknown")
    endpoint = Column(String, nullable=True)
    status = Column(SAEnum(AgentStatus), default=AgentStatus.UNKNOWN)
    risk_level = Column(SAEnum(RiskLevel), default=RiskLevel.LOW)
    capabilities = Column(JSON, default=list)
    allowed_actions = Column(JSON, default=list)
    owner = Column(String, default="unknown")
    environment = Column(String, default="unknown")
    deployment_source = Column(String, default="unknown")
    first_seen = Column(DateTime, default=utcnow)
    last_seen = Column(DateTime, default=utcnow)
    agent_metadata = Column(JSON, default=dict)
    is_authorized = Column(Boolean, default=False)

    activities = relationship("Activity", back_populates="agent", cascade="all, delete-orphan")
    violations = relationship("PolicyViolation", back_populates="agent", cascade="all, delete-orphan")
    mitigations = relationship("Mitigation", back_populates="agent")


class Policy(Base):
    __tablename__ = "policies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(Text, default="")
    enabled = Column(Boolean, default=True)
    priority = Column(Integer, default=100)
    scope = Column(JSON, default=dict)
    conditions = Column(JSON, default=list)
    action = Column(SAEnum(PolicyAction), nullable=False)
    action_config = Column(JSON, default=dict)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow)

    violations = relationship("PolicyViolation", back_populates="policy")


class Activity(Base):
    __tablename__ = "activities"

    id = Column(Integer, primary_key=True, index=True)
    agent_db_id = Column(Integer, ForeignKey("agents.id"), nullable=True)
    agent_id = Column(String, index=True)
    activity_type = Column(String)
    action = Column(String)
    resource = Column(String, nullable=True)
    payload = Column(JSON, nullable=True)
    result = Column(String, nullable=True)
    risk_score = Column(Float, default=0.0)
    flagged = Column(Boolean, default=False)
    policy_violation_id = Column(Integer, nullable=True)
    timestamp = Column(DateTime, default=utcnow, index=True)
    source_ip = Column(String, nullable=True)

    agent = relationship("Agent", back_populates="activities")


class PolicyViolation(Base):
    __tablename__ = "policy_violations"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)
    policy_id = Column(Integer, ForeignKey("policies.id"), nullable=True)
    activity_id = Column(Integer, ForeignKey("activities.id"), nullable=True)
    violation_details = Column(JSON, default=dict)
    severity = Column(SAEnum(RiskLevel), default=RiskLevel.MEDIUM)
    status = Column(String, default="open")
    detected_at = Column(DateTime, default=utcnow)
    resolved_at = Column(DateTime, nullable=True)

    agent = relationship("Agent", back_populates="violations")
    policy = relationship("Policy", back_populates="violations")


class Mitigation(Base):
    __tablename__ = "mitigations"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)
    violation_id = Column(Integer, ForeignKey("policy_violations.id"), nullable=True)
    action_type = Column(String)
    action_config = Column(JSON, default=dict)
    status = Column(SAEnum(MitigationStatus), default=MitigationStatus.PENDING)
    initiated_by = Column(String, default="auto")
    result = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    completed_at = Column(DateTime, nullable=True)

    agent = relationship("Agent", back_populates="mitigations")


class PolicyRecommendation(Base):
    """AI-generated policy suggestions from the Policy Brain."""
    __tablename__ = "policy_recommendations"

    id            = Column(Integer, primary_key=True, index=True)
    name          = Column(String)
    description   = Column(Text)
    conditions    = Column(JSON, default=list)
    action        = Column(String)
    priority      = Column(Integer, default=50)
    rationale     = Column(Text)
    gap_summary   = Column(Text, nullable=True)
    brain_model   = Column(String, nullable=True)
    status        = Column(String, default="pending")  # pending|accepted|rejected
    is_demo       = Column(Boolean, default=False)
    created_at    = Column(DateTime, default=utcnow)


class Detection(Base):
    __tablename__ = "detections"

    id = Column(Integer, primary_key=True, index=True)
    detection_type = Column(String)
    source = Column(String)
    entity = Column(JSON, default=dict)
    confidence = Column(Float, default=0.0)
    risk_assessment = Column(JSON, default=dict)
    status = Column(String, default="new")
    detected_at = Column(DateTime, default=utcnow, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)
