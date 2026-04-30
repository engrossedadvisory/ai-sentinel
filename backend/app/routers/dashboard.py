from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta, timezone
from typing import List

from ..database import get_db
from ..models import Agent, Policy, Activity, PolicyViolation, Mitigation, Detection, AgentStatus, RiskLevel, MitigationStatus
from ..schemas import DashboardStats
from ..seed_data import DEMO_AGENT_IDS, DEMO_DETECTION_STRINGS

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

_DEMO_STRINGS = set(DEMO_AGENT_IDS) | DEMO_DETECTION_STRINGS

def _is_demo_detection(d) -> bool:
    entity = d.entity or {}
    if entity.get("_demo"):
        return True
    return any(v in _DEMO_STRINGS for v in entity.values() if isinstance(v, str))


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _agent_q(db, demo_mode: bool):
    q = db.query(Agent)
    if not demo_mode:
        q = q.filter(Agent.agent_id.notin_(DEMO_AGENT_IDS))
    return q


def _activity_q(db, demo_mode: bool):
    q = db.query(Activity)
    if not demo_mode:
        q = q.filter(Activity.agent_id.notin_(DEMO_AGENT_IDS))
    return q


def _violation_q(db, demo_mode: bool):
    q = db.query(PolicyViolation)
    if not demo_mode:
        q = q.join(Agent, PolicyViolation.agent_id == Agent.id).filter(
            Agent.agent_id.notin_(DEMO_AGENT_IDS)
        )
    return q


@router.get("/stats", response_model=DashboardStats)
def get_stats(demo_mode: bool = True, db: Session = Depends(get_db)):
    aq = _agent_q(db, demo_mode)
    total_agents        = aq.count()
    active_agents       = aq.filter(Agent.status == AgentStatus.ACTIVE).count()
    quarantined_agents  = aq.filter(Agent.status == AgentStatus.QUARANTINED).count()
    unauthorized_agents = aq.filter(Agent.is_authorized == False).count()
    active_policies     = db.query(Policy).filter(Policy.enabled == True).count()

    vq = _violation_q(db, demo_mode)
    open_violations     = vq.filter(PolicyViolation.status == "open").count()

    pending_mitigations = db.query(Mitigation).filter(
        Mitigation.status.in_([MitigationStatus.PENDING, MitigationStatus.IN_PROGRESS])
    ).count()

    all_detections = db.query(Detection).filter(Detection.status.in_(["new", "investigating"])).all()
    if demo_mode:
        new_detections = len(all_detections)
    else:
        new_detections = sum(1 for d in all_detections if not _is_demo_detection(d))

    aq2 = _agent_q(db, demo_mode)
    risk_distribution = {
        "low":      aq2.filter(Agent.risk_level == RiskLevel.LOW).count(),
        "medium":   aq2.filter(Agent.risk_level == RiskLevel.MEDIUM).count(),
        "high":     aq2.filter(Agent.risk_level == RiskLevel.HIGH).count(),
        "critical": aq2.filter(Agent.risk_level == RiskLevel.CRITICAL).count(),
    }

    cutoff = utcnow() - timedelta(hours=24)
    activity_last_24h = _activity_q(db, demo_mode).filter(Activity.timestamp >= cutoff).count()

    return DashboardStats(
        total_agents=total_agents,
        active_agents=active_agents,
        quarantined_agents=quarantined_agents,
        unauthorized_agents=unauthorized_agents,
        active_policies=active_policies,
        open_violations=open_violations,
        pending_mitigations=pending_mitigations,
        new_detections=new_detections,
        risk_distribution=risk_distribution,
        activity_last_24h=activity_last_24h,
    )


@router.get("/activity-chart")
def get_activity_chart(hours: int = 24, demo_mode: bool = True, db: Session = Depends(get_db)):
    """Returns activity counts bucketed by hour for the last N hours."""
    now = utcnow()
    buckets = []
    for i in range(hours - 1, -1, -1):
        bucket_start = now - timedelta(hours=i + 1)
        bucket_end   = now - timedelta(hours=i)
        base = _activity_q(db, demo_mode).filter(
            Activity.timestamp >= bucket_start,
            Activity.timestamp < bucket_end,
        )
        total   = base.count()
        flagged = base.filter(Activity.flagged == True).count()
        buckets.append({
            "hour":         bucket_end.strftime("%H:%M"),
            "bucket_start": bucket_start.isoformat(),
            "total":        total,
            "flagged":      flagged,
        })
    return buckets


@router.get("/recent-violations")
def get_recent_violations(limit: int = 10, demo_mode: bool = True, db: Session = Depends(get_db)):
    violations = (
        _violation_q(db, demo_mode)
        .order_by(PolicyViolation.detected_at.desc())
        .limit(limit)
        .all()
    )
    result = []
    for v in violations:
        agent_name  = v.agent.name  if v.agent  else "Unknown"
        policy_name = v.policy.name if v.policy else "Unknown"
        result.append({
            "id":          v.id,
            "agent":       agent_name,
            "agent_id":    v.agent.agent_id if v.agent else None,
            "policy":      policy_name,
            "severity":    v.severity.value,
            "status":      v.status,
            "detected_at": v.detected_at.isoformat(),
            "details":     v.violation_details,
        })
    return result


@router.get("/recent-detections")
def get_recent_detections(limit: int = 5, demo_mode: bool = True, db: Session = Depends(get_db)):
    all_d = (
        db.query(Detection)
        .order_by(Detection.detected_at.desc())
        .all()
    )
    if not demo_mode:
        all_d = [d for d in all_d if not _is_demo_detection(d)]
    all_d = all_d[:limit]
    return [
        {
            "id":             d.id,
            "detection_type": d.detection_type,
            "source":         d.source,
            "entity":         {k: v for k, v in (d.entity or {}).items() if k != "_demo"},
            "confidence":     d.confidence,
            "status":         d.status,
            "detected_at":    d.detected_at.isoformat(),
        }
        for d in all_d
    ]
