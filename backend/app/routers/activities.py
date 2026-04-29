from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone

from ..database import get_db
from ..models import Agent, Activity, AgentStatus
from ..schemas import ActivityReport, ActivityOut
from ..services.policy_engine import compute_risk_score, evaluate_activity, record_violation
from ..services.mitigation_service import execute_mitigation
from ..services import brain_engine
from ..models import Mitigation, MitigationStatus, PolicyAction
from ..websocket_manager import manager as ws_manager

router = APIRouter(prefix="/api/activities", tags=["activities"])


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


@router.get("", response_model=List[ActivityOut])
def list_activities(
    agent_id: Optional[str] = None,
    flagged: Optional[bool] = None,
    limit: int = Query(default=100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    q = db.query(Activity)
    if agent_id:
        q = q.filter(Activity.agent_id == agent_id)
    if flagged is not None:
        q = q.filter(Activity.flagged == flagged)
    return q.order_by(Activity.timestamp.desc()).offset(offset).limit(limit).all()


@router.post("", response_model=ActivityOut)
async def report_activity(payload: ActivityReport, db: Session = Depends(get_db)):
    agent = db.query(Agent).filter(Agent.agent_id == payload.agent_id).first()

    risk_score = compute_risk_score(agent, payload.activity_type, payload.action)

    # Risk Brain: optionally refine the rule-based score with contextual analysis
    if agent:
        risk_result = await brain_engine.analyze_activity(
            agent_name=agent.name,
            agent_type=agent.type,
            authorized=agent.is_authorized,
            environment=agent.environment,
            activity_type=payload.activity_type,
            action=payload.action,
            rule_score=risk_score,
        )
        if risk_result and "adjusted_risk_score" in risk_result:
            risk_score = float(risk_result["adjusted_risk_score"])

    activity = Activity(
        agent_db_id=agent.id if agent else None,
        agent_id=payload.agent_id,
        activity_type=payload.activity_type,
        action=payload.action,
        resource=payload.resource,
        payload=payload.payload,
        risk_score=min(risk_score, 1.0),
        flagged=risk_score > 0.5,
        timestamp=utcnow(),
        source_ip=payload.source_ip,
        result="pending",
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)

    # Update agent last_seen
    if agent:
        agent.last_seen = utcnow()
        db.commit()

    # Evaluate against policies
    activity_data = {
        "activity_type": payload.activity_type,
        "action": payload.action,
        "risk_score": activity.risk_score,
    }
    policy_action, matched_policy = evaluate_activity(db, agent, activity_data)

    result = "allowed"
    if matched_policy and policy_action != PolicyAction.ALLOW:
        violation = record_violation(db, agent, matched_policy, activity, policy_action)
        activity.flagged = True
        activity.policy_violation_id = violation.id

        if policy_action in (PolicyAction.BLOCK, PolicyAction.QUARANTINE, PolicyAction.TERMINATE):
            result = "blocked"
            mitigation = Mitigation(
                agent_id=agent.id if agent else None,
                violation_id=violation.id,
                action_type=policy_action.value if policy_action != PolicyAction.BLOCK else "alert",
                action_config=matched_policy.action_config or {},
                status=MitigationStatus.PENDING,
                initiated_by="auto",
            )
            db.add(mitigation)
            db.commit()
            db.refresh(mitigation)

            import asyncio
            asyncio.create_task(execute_mitigation(mitigation, agent, db))
        elif policy_action == PolicyAction.WARN:
            result = "warned"
        elif policy_action == PolicyAction.ESCALATE:
            result = "escalated"

        db.commit()

        await ws_manager.broadcast("policy_violation", {
            "violation_id": violation.id,
            "agent_id": payload.agent_id,
            "policy": matched_policy.name,
            "action": policy_action.value,
            "activity": payload.action,
            "risk_score": activity.risk_score,
        })

    activity.result = result
    db.commit()
    db.refresh(activity)

    await ws_manager.broadcast("new_activity", {
        "id": activity.id,
        "agent_id": payload.agent_id,
        "activity_type": payload.activity_type,
        "action": payload.action,
        "risk_score": activity.risk_score,
        "flagged": activity.flagged,
        "result": activity.result,
        "timestamp": activity.timestamp.isoformat(),
    })

    return activity


@router.get("/{activity_id}", response_model=ActivityOut)
def get_activity(activity_id: int, db: Session = Depends(get_db)):
    from fastapi import HTTPException
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    return activity
