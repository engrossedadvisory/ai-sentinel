from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, timezone

from ..database import get_db
from ..models import Policy
from ..schemas import PolicyCreate, PolicyUpdate, PolicyOut

router = APIRouter(prefix="/api/policies", tags=["policies"])


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


@router.get("", response_model=List[PolicyOut])
def list_policies(db: Session = Depends(get_db)):
    return db.query(Policy).order_by(Policy.priority.asc()).all()


@router.post("", response_model=PolicyOut, status_code=status.HTTP_201_CREATED)
def create_policy(payload: PolicyCreate, db: Session = Depends(get_db)):
    existing = db.query(Policy).filter(Policy.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Policy name already exists")
    policy = Policy(**payload.model_dump())
    db.add(policy)
    db.commit()
    db.refresh(policy)
    return policy


@router.get("/{policy_id}", response_model=PolicyOut)
def get_policy(policy_id: int, db: Session = Depends(get_db)):
    policy = db.query(Policy).filter(Policy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    return policy


@router.put("/{policy_id}", response_model=PolicyOut)
def update_policy(policy_id: int, payload: PolicyUpdate, db: Session = Depends(get_db)):
    policy = db.query(Policy).filter(Policy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(policy, field, value)
    policy.updated_at = utcnow()
    db.commit()
    db.refresh(policy)
    return policy


@router.post("/{policy_id}/toggle", response_model=PolicyOut)
def toggle_policy(policy_id: int, db: Session = Depends(get_db)):
    policy = db.query(Policy).filter(Policy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    policy.enabled = not policy.enabled
    policy.updated_at = utcnow()
    db.commit()
    db.refresh(policy)
    return policy


@router.delete("/{policy_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_policy(policy_id: int, db: Session = Depends(get_db)):
    policy = db.query(Policy).filter(Policy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    db.delete(policy)
    db.commit()
