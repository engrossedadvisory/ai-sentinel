from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional

from ..database import get_db
from ..models import Mitigation, Agent, PolicyViolation, MitigationStatus
from ..schemas import MitigationCreate, MitigationOut, ViolationOut
from ..services.mitigation_service import execute_mitigation

router = APIRouter(prefix="/api/mitigations", tags=["mitigations"])


@router.get("", response_model=List[MitigationOut])
def list_mitigations(
    agent_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Mitigation)
    if agent_id:
        q = q.filter(Mitigation.agent_id == agent_id)
    if status:
        q = q.filter(Mitigation.status == status)
    return q.order_by(Mitigation.created_at.desc()).all()


@router.post("", response_model=MitigationOut, status_code=status.HTTP_201_CREATED)
async def create_mitigation(
    payload: MitigationCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    agent = None
    if payload.agent_id:
        agent = db.query(Agent).filter(Agent.id == payload.agent_id).first()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")

    valid_actions = {"suspend", "quarantine", "terminate", "block_traffic", "rate_limit", "alert", "escalate"}
    if payload.action_type not in valid_actions:
        raise HTTPException(status_code=400, detail=f"Invalid action_type. Must be one of: {valid_actions}")

    mitigation = Mitigation(
        agent_id=payload.agent_id,
        violation_id=payload.violation_id,
        action_type=payload.action_type,
        action_config=payload.action_config,
        status=MitigationStatus.PENDING,
        initiated_by=payload.initiated_by,
    )
    db.add(mitigation)
    db.commit()
    db.refresh(mitigation)

    background_tasks.add_task(execute_mitigation, mitigation, agent, db)
    return mitigation


@router.get("/{mitigation_id}", response_model=MitigationOut)
def get_mitigation(mitigation_id: int, db: Session = Depends(get_db)):
    mitigation = db.query(Mitigation).filter(Mitigation.id == mitigation_id).first()
    if not mitigation:
        raise HTTPException(status_code=404, detail="Mitigation not found")
    return mitigation


# ── Violations ─────────────────────────────────────────────────────────────

@router.get("/violations/all", response_model=List[ViolationOut])
def list_violations(
    status: Optional[str] = None,
    severity: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(PolicyViolation)
    if status:
        q = q.filter(PolicyViolation.status == status)
    if severity:
        q = q.filter(PolicyViolation.severity == severity)
    return q.order_by(PolicyViolation.detected_at.desc()).all()


@router.put("/violations/{violation_id}/status")
def update_violation_status(
    violation_id: int,
    status: str,
    db: Session = Depends(get_db),
):
    from datetime import datetime, timezone
    violation = db.query(PolicyViolation).filter(PolicyViolation.id == violation_id).first()
    if not violation:
        raise HTTPException(status_code=404, detail="Violation not found")
    valid = {"open", "acknowledged", "resolved", "false_positive"}
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid}")
    violation.status = status
    if status == "resolved":
        violation.resolved_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    return {"id": violation.id, "status": violation.status}
