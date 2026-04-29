from typing import Optional, Tuple
from sqlalchemy.orm import Session
from ..models import Policy, Agent, Activity, PolicyViolation, RiskLevel, PolicyAction
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)

RISK_KEYWORDS = {
    "critical": ["delete_all", "drop_database", "system_exec", "exfiltrate", "bypass_auth", "privilege_escalate"],
    "high": ["pii_access", "bulk_export", "admin_override", "unrestricted_access", "mass_delete"],
    "medium": ["sensitive_read", "config_write", "user_data", "credential_access", "external_call"],
    "low": ["read", "query", "inference", "log_write"],
}

ACTIVITY_RISK_BASE = {
    "api_call": 0.1,
    "data_access": 0.3,
    "model_inference": 0.1,
    "tool_use": 0.2,
    "file_access": 0.25,
    "network_request": 0.2,
    "code_execution": 0.6,
    "database_query": 0.3,
    "config_change": 0.5,
    "admin_action": 0.7,
}


def compute_risk_score(agent: Optional[Agent], activity_type: str, action: str) -> float:
    base = ACTIVITY_RISK_BASE.get(activity_type, 0.2)

    action_lower = action.lower()
    for keyword in RISK_KEYWORDS["critical"]:
        if keyword in action_lower:
            base = max(base, 0.95)
    for keyword in RISK_KEYWORDS["high"]:
        if keyword in action_lower:
            base = max(base, 0.75)
    for keyword in RISK_KEYWORDS["medium"]:
        if keyword in action_lower:
            base = max(base, 0.45)

    if agent:
        if not agent.is_authorized:
            base = min(base + 0.3, 1.0)
        if agent.environment == "prod":
            base = min(base + 0.1, 1.0)
        if agent.risk_level == RiskLevel.CRITICAL:
            base = min(base + 0.2, 1.0)
        elif agent.risk_level == RiskLevel.HIGH:
            base = min(base + 0.1, 1.0)

    return round(base, 3)


def _condition_matches(condition: dict, agent: Optional[Agent], activity: dict) -> bool:
    ctype = condition.get("type", "")
    value = condition.get("value")
    op = condition.get("operator", "equals")

    if ctype == "unauthorized":
        return (agent is None or not agent.is_authorized) == bool(value)

    if ctype == "activity_type":
        actual = activity.get("activity_type", "")
        return (actual == value) if op == "equals" else (value in actual)

    if ctype == "action_contains":
        return str(value).lower() in activity.get("action", "").lower()

    if ctype == "risk_score_above":
        return activity.get("risk_score", 0.0) > float(value)

    if ctype == "agent_type":
        if agent is None:
            return False
        return (agent.type == value) if op == "equals" else (value in agent.type)

    if ctype == "environment":
        if agent is None:
            return False
        return agent.environment == value

    if ctype == "capability_exceeded":
        if agent is None:
            return True
        action = activity.get("action", "")
        return not any(cap.lower() in action.lower() for cap in (agent.allowed_actions or []))

    if ctype == "agent_status":
        if agent is None:
            return False
        return agent.status.value == value

    return False


def _scope_matches(scope: dict, agent: Optional[Agent]) -> bool:
    if not scope:
        return True
    if agent is None:
        return True

    if "environments" in scope and scope["environments"]:
        if agent.environment not in scope["environments"]:
            return False
    if "agent_types" in scope and scope["agent_types"]:
        if agent.type not in scope["agent_types"]:
            return False
    if "risk_levels" in scope and scope["risk_levels"]:
        if agent.risk_level.value not in scope["risk_levels"]:
            return False
    return True


def evaluate_activity(
    db: Session,
    agent: Optional[Agent],
    activity_data: dict,
) -> Tuple[PolicyAction, Optional[Policy]]:
    """
    Returns the most restrictive matching policy action and the triggering policy.
    Falls through to ALLOW if no policy matches.
    """
    policies = (
        db.query(Policy)
        .filter(Policy.enabled == True)
        .order_by(Policy.priority.asc())
        .all()
    )

    action_severity = {
        PolicyAction.ALLOW: 0,
        PolicyAction.WARN: 1,
        PolicyAction.BLOCK: 2,
        PolicyAction.ESCALATE: 3,
        PolicyAction.QUARANTINE: 4,
        PolicyAction.TERMINATE: 5,
    }

    best_action = PolicyAction.ALLOW
    best_policy = None

    for policy in policies:
        if not _scope_matches(policy.scope or {}, agent):
            continue

        conditions = policy.conditions or []
        if not conditions:
            continue

        all_match = all(_condition_matches(c, agent, activity_data) for c in conditions)
        if all_match:
            if action_severity.get(policy.action, 0) > action_severity.get(best_action, 0):
                best_action = policy.action
                best_policy = policy

    return best_action, best_policy


def record_violation(
    db: Session,
    agent: Optional[Agent],
    policy: Policy,
    activity: Activity,
    action: PolicyAction,
) -> PolicyViolation:
    severity_map = {
        PolicyAction.WARN: RiskLevel.LOW,
        PolicyAction.BLOCK: RiskLevel.MEDIUM,
        PolicyAction.ESCALATE: RiskLevel.HIGH,
        PolicyAction.QUARANTINE: RiskLevel.HIGH,
        PolicyAction.TERMINATE: RiskLevel.CRITICAL,
    }
    violation = PolicyViolation(
        agent_id=agent.id if agent else None,
        policy_id=policy.id,
        activity_id=activity.id,
        violation_details={
            "policy_name": policy.name,
            "policy_action": action.value,
            "activity_type": activity.activity_type,
            "action": activity.action,
            "risk_score": activity.risk_score,
        },
        severity=severity_map.get(action, RiskLevel.MEDIUM),
        status="open",
        detected_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(violation)
    db.commit()
    db.refresh(violation)
    return violation
