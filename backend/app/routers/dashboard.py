from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta, timezone
from typing import List

from ..database import get_db
from ..models import Agent, Policy, Activity, PolicyViolation, Mitigation, Detection, AgentStatus, RiskLevel, MitigationStatus
from ..schemas import DashboardStats

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


@router.get("/stats", response_model=DashboardStats)
def get_stats(db: Session = Depends(get_db)):
    total_agents = db.query(Agent).count()
    active_agents = db.query(Agent).filter(Agent.status == AgentStatus.ACTIVE).count()
    quarantined_agents = db.query(Agent).filter(Agent.status == AgentStatus.QUARANTINED).count()
    unauthorized_agents = db.query(Agent).filter(Agent.is_authorized == False).count()
    active_policies = db.query(Policy).filter(Policy.enabled == True).count()
    open_violations = db.query(PolicyViolation).filter(PolicyViolation.status == "open").count()
    pending_mitigations = db.query(Mitigation).filter(
        Mitigation.status.in_([MitigationStatus.PENDING, MitigationStatus.IN_PROGRESS])
    ).count()
    new_detections = db.query(Detection).filter(Detection.status.in_(["new", "investigating"])).count()

    risk_distribution = {
        "low": db.query(Agent).filter(Agent.risk_level == RiskLevel.LOW).count(),
        "medium": db.query(Agent).filter(Agent.risk_level == RiskLevel.MEDIUM).count(),
        "high": db.query(Agent).filter(Agent.risk_level == RiskLevel.HIGH).count(),
        "critical": db.query(Agent).filter(Agent.risk_level == RiskLevel.CRITICAL).count(),
    }

    cutoff = utcnow() - timedelta(hours=24)
    activity_last_24h = db.query(Activity).filter(Activity.timestamp >= cutoff).count()

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
def get_activity_chart(hours: int = 24, db: Session = Depends(get_db)):
    """Returns activity counts bucketed by hour for the last N hours."""
    now = utcnow()
    buckets = []
    for i in range(hours - 1, -1, -1):
        bucket_start = now - timedelta(hours=i + 1)
        bucket_end = now - timedelta(hours=i)
        total = db.query(Activity).filter(
            Activity.timestamp >= bucket_start,
            Activity.timestamp < bucket_end,
        ).count()
        flagged = db.query(Activity).filter(
            Activity.timestamp >= bucket_start,
            Activity.timestamp < bucket_end,
            Activity.flagged == True,
        ).count()
        buckets.append({
            "hour": bucket_end.strftime("%H:%M"),
            "total": total,
            "flagged": flagged,
        })
    return buckets


@router.get("/recent-violations")
def get_recent_violations(limit: int = 10, db: Session = Depends(get_db)):
    violations = (
        db.query(PolicyViolation)
        .order_by(PolicyViolation.detected_at.desc())
        .limit(limit)
        .all()
    )
    result = []
    for v in violations:
        agent_name = v.agent.name if v.agent else "Unknown"
        policy_name = v.policy.name if v.policy else "Unknown"
        result.append({
            "id": v.id,
            "agent": agent_name,
            "policy": policy_name,
            "severity": v.severity.value,
            "status": v.status,
            "detected_at": v.detected_at.isoformat(),
            "details": v.violation_details,
        })
    return result


@router.get("/recent-detections")
def get_recent_detections(limit: int = 5, db: Session = Depends(get_db)):
    detections = (
        db.query(Detection)
        .order_by(Detection.detected_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": d.id,
            "detection_type": d.detection_type,
            "source": d.source,
            "entity": d.entity,
            "confidence": d.confidence,
            "status": d.status,
            "detected_at": d.detected_at.isoformat(),
        }
        for d in detections
    ]
