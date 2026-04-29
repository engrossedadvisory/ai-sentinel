"""
Mitigation service — executes governance responses when policy violations occur.

Supported actions:
  suspend        — mark agent as inactive
  quarantine     — isolate agent, flag all future activity
  block_traffic  — (stub) signal network layer to drop agent traffic
  rate_limit     — record rate-limit in-memory (enforced by activity router)
  alert          — broadcast alert via WebSocket + log
  escalate       — create escalation record for human review
  terminate      — mark agent as terminated, revoke authorization
"""
import asyncio
import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from ..models import (
    Mitigation, Agent, PolicyViolation,
    MitigationStatus, AgentStatus, RiskLevel
)
from ..websocket_manager import manager as ws_manager

logger = logging.getLogger(__name__)

# Import lazily to avoid circular init issues
def _brain():
    from . import brain_engine
    return brain_engine

# In-memory rate-limit registry: {agent_id: {"limit": int, "window": int}}
_rate_limits: dict = {}


def get_rate_limit(agent_id: str) -> dict | None:
    return _rate_limits.get(agent_id)


async def execute_mitigation(
    mitigation: Mitigation,
    agent: Agent | None,
    db: Session,
    violation_data: dict | None = None,
) -> None:
    mitigation.status = MitigationStatus.IN_PROGRESS
    db.commit()

    # Mitigation Brain: optionally enrich or override the action for auto-triggered events
    if violation_data and mitigation.initiated_by == "auto":
        try:
            brain_advice = await _brain().recommend_mitigation(violation_data)
            if brain_advice and brain_advice.get("recommended_action"):
                advised = brain_advice["recommended_action"]
                # Only upgrade severity, never downgrade an explicit auto action
                _severity = {"alert": 0, "rate_limit": 1, "suspend": 2,
                             "block_traffic": 3, "quarantine": 4,
                             "terminate": 5, "escalate": 3}
                current_sev = _severity.get(mitigation.action_type, 0)
                advised_sev = _severity.get(advised, 0)
                if advised_sev > current_sev:
                    logger.info(f"Mitigation Brain upgraded action: {mitigation.action_type} → {advised}")
                    mitigation.action_type = advised
                if brain_advice.get("auto_execute") is False:
                    # Brain says human review needed — escalate instead
                    mitigation.action_type = "escalate"
                    mitigation.action_config = {
                        **mitigation.action_config,
                        "reason": brain_advice.get("rationale", "Brain recommends human review"),
                    }
                db.commit()
        except Exception as e:
            logger.warning(f"Mitigation Brain advice failed (continuing): {e}")

    try:
        result = await _dispatch(mitigation.action_type, mitigation.action_config, agent, db)
        mitigation.status = MitigationStatus.COMPLETED
        mitigation.result = result
    except Exception as e:
        mitigation.status = MitigationStatus.FAILED
        mitigation.result = f"Error: {e}"
        logger.error(f"Mitigation {mitigation.id} failed: {e}")

    mitigation.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()

    await ws_manager.broadcast("mitigation_update", {
        "id": mitigation.id,
        "action_type": mitigation.action_type,
        "status": mitigation.status.value,
        "agent_id": agent.agent_id if agent else None,
        "result": mitigation.result,
    })


async def _dispatch(action_type: str, config: dict, agent: Agent | None, db: Session) -> str:
    if action_type == "suspend":
        return await _suspend(agent, db)
    if action_type == "quarantine":
        return await _quarantine(agent, db)
    if action_type == "terminate":
        return await _terminate(agent, db)
    if action_type == "block_traffic":
        return await _block_traffic(agent, config)
    if action_type == "rate_limit":
        return await _apply_rate_limit(agent, config)
    if action_type == "alert":
        return await _send_alert(agent, config)
    if action_type == "escalate":
        return await _escalate(agent, config)
    raise ValueError(f"Unknown mitigation action: {action_type}")


async def _suspend(agent: Agent | None, db: Session) -> str:
    if agent is None:
        return "No agent to suspend"
    agent.status = AgentStatus.SUSPENDED
    db.commit()
    logger.warning(f"Agent {agent.agent_id} SUSPENDED")
    await ws_manager.broadcast("agent_status_change", {
        "agent_id": agent.agent_id,
        "name": agent.name,
        "status": "suspended",
    })
    return f"Agent {agent.name} suspended successfully"


async def _quarantine(agent: Agent | None, db: Session) -> str:
    if agent is None:
        return "No agent to quarantine"
    agent.status = AgentStatus.QUARANTINED
    agent.risk_level = RiskLevel.HIGH
    agent.is_authorized = False
    db.commit()
    logger.warning(f"Agent {agent.agent_id} QUARANTINED")
    await ws_manager.broadcast("agent_status_change", {
        "agent_id": agent.agent_id,
        "name": agent.name,
        "status": "quarantined",
    })
    return f"Agent {agent.name} quarantined and authorization revoked"


async def _terminate(agent: Agent | None, db: Session) -> str:
    if agent is None:
        return "No agent to terminate"
    agent.status = AgentStatus.INACTIVE
    agent.is_authorized = False
    agent.risk_level = RiskLevel.CRITICAL
    db.commit()
    logger.critical(f"Agent {agent.agent_id} TERMINATED")
    await ws_manager.broadcast("agent_status_change", {
        "agent_id": agent.agent_id,
        "name": agent.name,
        "status": "terminated",
    })
    return f"Agent {agent.name} terminated and deauthorized"


async def _block_traffic(agent: Agent | None, config: dict) -> str:
    target = agent.endpoint if agent else config.get("target", "unknown")
    logger.warning(f"[BLOCK_TRAFFIC] Signaling network layer to block: {target}")
    # In production: call iptables/firewall API / service mesh policy
    await asyncio.sleep(0.1)
    return f"Traffic block signal sent for {target}"


async def _apply_rate_limit(agent: Agent | None, config: dict) -> str:
    if agent is None:
        return "No agent to rate-limit"
    limit = config.get("requests_per_minute", 10)
    window = config.get("window_seconds", 60)
    _rate_limits[agent.agent_id] = {"limit": limit, "window": window, "applied_at": datetime.utcnow().isoformat()}
    logger.info(f"Rate limit applied to {agent.agent_id}: {limit} req/{window}s")
    return f"Rate limit applied: {limit} requests per {window}s"


async def _send_alert(agent: Agent | None, config: dict) -> str:
    message = config.get("message", "Governance alert triggered")
    severity = config.get("severity", "high")
    agent_name = agent.name if agent else "unknown"
    logger.warning(f"[ALERT] {severity.upper()} — {agent_name}: {message}")
    await ws_manager.broadcast("governance_alert", {
        "severity": severity,
        "agent": agent_name,
        "message": message,
        "timestamp": datetime.utcnow().isoformat(),
    })
    return f"Alert broadcast: {message}"


async def _escalate(agent: Agent | None, config: dict) -> str:
    ticket_details = {
        "agent": agent.name if agent else "unknown",
        "reason": config.get("reason", "Policy violation requiring human review"),
        "priority": config.get("priority", "high"),
        "assigned_to": config.get("assigned_to", "governance-team"),
        "created_at": datetime.utcnow().isoformat(),
    }
    logger.warning(f"[ESCALATION] {ticket_details}")
    await ws_manager.broadcast("escalation_created", ticket_details)
    return f"Escalated to {ticket_details['assigned_to']}: {ticket_details['reason']}"
