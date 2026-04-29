from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid
from datetime import datetime, timezone

from ..database import get_db
from ..models import Agent, AgentStatus, RiskLevel
from ..schemas import AgentCreate, AgentUpdate, AgentOut
from ..websocket_manager import manager as ws_manager

router = APIRouter(prefix="/api/agents", tags=["agents"])


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


@router.get("", response_model=List[AgentOut])
def list_agents(
    status: Optional[str] = None,
    environment: Optional[str] = None,
    risk_level: Optional[str] = None,
    authorized: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Agent)
    if status:
        q = q.filter(Agent.status == status)
    if environment:
        q = q.filter(Agent.environment == environment)
    if risk_level:
        q = q.filter(Agent.risk_level == risk_level)
    if authorized is not None:
        q = q.filter(Agent.is_authorized == authorized)
    return q.order_by(Agent.last_seen.desc()).all()


@router.post("", response_model=AgentOut, status_code=status.HTTP_201_CREATED)
async def register_agent(payload: AgentCreate, db: Session = Depends(get_db)):
    agent_id = payload.agent_id or f"agent-{uuid.uuid4().hex[:12]}"
    existing = db.query(Agent).filter(Agent.agent_id == agent_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Agent ID already registered")

    agent = Agent(
        agent_id=agent_id,
        name=payload.name,
        type=payload.type,
        version=payload.version,
        endpoint=payload.endpoint,
        capabilities=payload.capabilities,
        allowed_actions=payload.allowed_actions,
        owner=payload.owner,
        environment=payload.environment,
        deployment_source=payload.deployment_source,
        agent_metadata=payload.agent_metadata,
        is_authorized=payload.is_authorized,
        status=AgentStatus.ACTIVE if payload.is_authorized else AgentStatus.UNKNOWN,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)

    await ws_manager.broadcast("agent_registered", {
        "agent_id": agent.agent_id,
        "name": agent.name,
        "status": agent.status.value,
        "is_authorized": agent.is_authorized,
    })
    return agent


@router.get("/{agent_id}", response_model=AgentOut)
def get_agent(agent_id: str, db: Session = Depends(get_db)):
    agent = db.query(Agent).filter(Agent.agent_id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.put("/{agent_id}", response_model=AgentOut)
async def update_agent(agent_id: str, payload: AgentUpdate, db: Session = Depends(get_db)):
    agent = db.query(Agent).filter(Agent.agent_id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(agent, field, value)
    agent.last_seen = utcnow()
    db.commit()
    db.refresh(agent)

    await ws_manager.broadcast("agent_updated", {"agent_id": agent.agent_id, "name": agent.name})
    return agent


@router.post("/{agent_id}/authorize", response_model=AgentOut)
async def authorize_agent(agent_id: str, db: Session = Depends(get_db)):
    agent = db.query(Agent).filter(Agent.agent_id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent.is_authorized = True
    agent.status = AgentStatus.ACTIVE
    db.commit()
    db.refresh(agent)
    await ws_manager.broadcast("agent_status_change", {
        "agent_id": agent.agent_id,
        "name": agent.name,
        "status": "authorized",
    })
    return agent


@router.post("/{agent_id}/quarantine", response_model=AgentOut)
async def quarantine_agent(agent_id: str, db: Session = Depends(get_db)):
    agent = db.query(Agent).filter(Agent.agent_id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent.status = AgentStatus.QUARANTINED
    agent.is_authorized = False
    agent.risk_level = RiskLevel.HIGH
    db.commit()
    db.refresh(agent)
    await ws_manager.broadcast("agent_status_change", {
        "agent_id": agent.agent_id,
        "name": agent.name,
        "status": "quarantined",
    })
    return agent


@router.post("/{agent_id}/suspend", response_model=AgentOut)
async def suspend_agent(agent_id: str, db: Session = Depends(get_db)):
    agent = db.query(Agent).filter(Agent.agent_id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent.status = AgentStatus.SUSPENDED
    db.commit()
    db.refresh(agent)
    await ws_manager.broadcast("agent_status_change", {
        "agent_id": agent.agent_id,
        "name": agent.name,
        "status": "suspended",
    })
    return agent


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_agent(agent_id: str, db: Session = Depends(get_db)):
    agent = db.query(Agent).filter(Agent.agent_id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    db.delete(agent)
    db.commit()
