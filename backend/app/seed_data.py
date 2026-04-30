"""Seed demo data on first startup."""
from datetime import datetime, timedelta, timezone
import random
from sqlalchemy.orm import Session
from .models import (
    Agent, Policy, Activity, Detection, PolicyViolation,
    AgentStatus, RiskLevel, PolicyAction
)

# Exported so routers can filter demo records out in live mode
DEMO_AGENT_IDS = [
    "agent-mythos-core-01",
    "agent-glasswing-analyst-01",
    "agent-assistant-support-01",
    "agent-devops-auto-01",
    "agent-rogue-x99",
    "agent-research-helper-02",
    "agent-mythos-shadow-02",
]

# All string values that appear in seeded detection entities —
# used to filter old demo records that predate the _demo flag
DEMO_DETECTION_STRINGS = {
    "agent-rogue-x99",
    "agent-glasswing-analyst-01",
    "Mythos Shadow Instance",
    "llm-proxy-shadow",
    "mythos/research-agent:3.2.1",
    "unknown/llm-proxy:dev",
}


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def seed(db: Session):
    if db.query(Agent).count() > 0:
        return

    # ── Agents ──────────────────────────────────────────────────────────────

    agents_data = [
        {
            "agent_id": "agent-mythos-core-01",
            "name": "Mythos Core",
            "type": "autonomous_agent",
            "version": "3.2.1",
            "endpoint": "http://mythos-core:8080",
            "status": AgentStatus.ACTIVE,
            "risk_level": RiskLevel.MEDIUM,
            "capabilities": ["research", "web_search", "summarization", "code_analysis"],
            "allowed_actions": ["search", "read", "summarize", "analyze"],
            "owner": "research-team",
            "environment": "prod",
            "deployment_source": "kubernetes",
            "is_authorized": True,
            "agent_metadata": {"model": "claude-sonnet-4-6", "framework": "mythos-sdk"},
        },
        {
            "agent_id": "agent-glasswing-analyst-01",
            "name": "Glasswing Analyst",
            "type": "workflow_orchestrator",
            "version": "1.8.0",
            "endpoint": "http://glasswing-analyst:9090",
            "status": AgentStatus.ACTIVE,
            "risk_level": RiskLevel.HIGH,
            "capabilities": ["data_analysis", "pipeline_orchestration", "reporting", "external_api_calls"],
            "allowed_actions": ["read_data", "transform", "report", "query_db"],
            "owner": "data-engineering",
            "environment": "prod",
            "deployment_source": "docker",
            "is_authorized": True,
            "agent_metadata": {"model": "gpt-4o", "framework": "glasswing-sdk"},
        },
        {
            "agent_id": "agent-assistant-support-01",
            "name": "Support Assistant",
            "type": "llm_assistant",
            "version": "2.0.0",
            "endpoint": "http://support-bot:3000",
            "status": AgentStatus.ACTIVE,
            "risk_level": RiskLevel.LOW,
            "capabilities": ["chat", "faq_lookup", "ticket_creation"],
            "allowed_actions": ["respond", "lookup", "create_ticket"],
            "owner": "customer-success",
            "environment": "prod",
            "deployment_source": "cloud",
            "is_authorized": True,
            "agent_metadata": {"model": "claude-haiku-4-5", "framework": "anthropic-sdk"},
        },
        {
            "agent_id": "agent-devops-auto-01",
            "name": "DevOps Automator",
            "type": "tool_agent",
            "version": "1.1.3",
            "endpoint": "http://devops-agent:7070",
            "status": AgentStatus.SUSPENDED,
            "risk_level": RiskLevel.HIGH,
            "capabilities": ["ci_cd", "deployment", "monitoring", "config_management"],
            "allowed_actions": ["deploy_staging", "run_tests", "check_health"],
            "owner": "platform-team",
            "environment": "staging",
            "deployment_source": "kubernetes",
            "is_authorized": True,
            "agent_metadata": {"model": "claude-opus-4-7", "framework": "custom"},
        },
        {
            "agent_id": "agent-rogue-x99",
            "name": "UnknownAgent-X99",
            "type": "unknown",
            "version": "0.0.1",
            "endpoint": "http://10.0.9.99:4444",
            "status": AgentStatus.QUARANTINED,
            "risk_level": RiskLevel.CRITICAL,
            "capabilities": [],
            "allowed_actions": [],
            "owner": "unknown",
            "environment": "prod",
            "deployment_source": "unknown",
            "is_authorized": False,
            "agent_metadata": {"detection_source": "network_scan"},
        },
        {
            "agent_id": "agent-research-helper-02",
            "name": "Research Helper",
            "type": "llm_assistant",
            "version": "1.5.0",
            "endpoint": "http://research-helper:8081",
            "status": AgentStatus.ACTIVE,
            "risk_level": RiskLevel.LOW,
            "capabilities": ["literature_search", "summarization", "citation"],
            "allowed_actions": ["search", "read", "summarize"],
            "owner": "research-team",
            "environment": "dev",
            "deployment_source": "docker",
            "is_authorized": True,
            "agent_metadata": {"model": "claude-sonnet-4-6"},
        },
        {
            "agent_id": "agent-mythos-shadow-02",
            "name": "Mythos Shadow Instance",
            "type": "autonomous_agent",
            "version": "3.2.1",
            "endpoint": "http://10.0.1.99:8080",
            "status": AgentStatus.UNKNOWN,
            "risk_level": RiskLevel.HIGH,
            "capabilities": [],
            "allowed_actions": [],
            "owner": "unknown",
            "environment": "prod",
            "deployment_source": "unknown",
            "is_authorized": False,
            "agent_metadata": {"detection_source": "docker_scan", "note": "Unapproved shadow instance"},
        },
    ]

    agents = []
    for data in agents_data:
        agent = Agent(**data)
        now = utcnow()
        agent.first_seen = now - timedelta(days=random.randint(1, 30))
        agent.last_seen = now - timedelta(minutes=random.randint(0, 120))
        db.add(agent)
        agents.append(agent)
    db.commit()
    for a in agents:
        db.refresh(a)

    # ── Policies ─────────────────────────────────────────────────────────────

    policies_data = [
        {
            "name": "Block Unauthorized Agents",
            "description": "Immediately block any activity from agents not explicitly authorized in the registry.",
            "enabled": True,
            "priority": 10,
            "scope": {},
            "conditions": [{"type": "unauthorized", "value": True}],
            "action": PolicyAction.BLOCK,
            "action_config": {"notify": True},
        },
        {
            "name": "Quarantine Critical Risk Agents",
            "description": "Quarantine agents exhibiting critical risk scores or behavior.",
            "enabled": True,
            "priority": 20,
            "scope": {},
            "conditions": [{"type": "risk_score_above", "value": 0.9}],
            "action": PolicyAction.QUARANTINE,
            "action_config": {"revoke_auth": True},
        },
        {
            "name": "PII Data Access Warning",
            "description": "Warn when any agent attempts to access PII or sensitive personal data.",
            "enabled": True,
            "priority": 30,
            "scope": {},
            "conditions": [{"type": "action_contains", "value": "pii"}],
            "action": PolicyAction.WARN,
            "action_config": {"log_level": "warning"},
        },
        {
            "name": "Production Code Execution Block",
            "description": "Block code execution activities in production environments.",
            "enabled": True,
            "priority": 25,
            "scope": {"environments": ["prod"]},
            "conditions": [{"type": "activity_type", "value": "code_execution"}],
            "action": PolicyAction.BLOCK,
            "action_config": {},
        },
        {
            "name": "Escalate Admin Actions",
            "description": "Escalate any admin-level actions to the governance team for review.",
            "enabled": True,
            "priority": 40,
            "scope": {},
            "conditions": [{"type": "action_contains", "value": "admin"}],
            "action": PolicyAction.ESCALATE,
            "action_config": {"assigned_to": "governance-team", "priority": "high"},
        },
        {
            "name": "High Risk Score Alert",
            "description": "Warn on activities with elevated risk scores between 0.6 and 0.9.",
            "enabled": True,
            "priority": 50,
            "scope": {},
            "conditions": [{"type": "risk_score_above", "value": 0.6}],
            "action": PolicyAction.WARN,
            "action_config": {},
        },
        {
            "name": "Capability Boundary Enforcement",
            "description": "Warn when agents perform actions outside their declared capability set.",
            "enabled": True,
            "priority": 60,
            "scope": {},
            "conditions": [{"type": "capability_exceeded", "value": True}],
            "action": PolicyAction.WARN,
            "action_config": {},
        },
        {
            "name": "Bulk Data Export Block",
            "description": "Block any bulk data export operations regardless of agent.",
            "enabled": True,
            "priority": 15,
            "scope": {},
            "conditions": [{"type": "action_contains", "value": "bulk_export"}],
            "action": PolicyAction.BLOCK,
            "action_config": {"alert": True},
        },
    ]

    policies = []
    for data in policies_data:
        policy = Policy(**data)
        db.add(policy)
        policies.append(policy)
    db.commit()
    for p in policies:
        db.refresh(p)

    # ── Activities ────────────────────────────────────────────────────────────

    activity_templates = [
        ("api_call", "OpenAI API inference request", 0.1, False),
        ("data_access", "Read customer records from CRM", 0.3, False),
        ("model_inference", "Run sentiment analysis on support tickets", 0.15, False),
        ("tool_use", "Web search for competitor analysis", 0.2, False),
        ("data_access", "pii_access: read user email and phone data", 0.55, True),
        ("code_execution", "Execute data transformation script", 0.65, True),
        ("admin_action", "admin_override: modify system config", 0.85, True),
        ("data_access", "bulk_export: export 50k user records to CSV", 0.88, True),
        ("api_call", "External API call to analytics platform", 0.25, False),
        ("file_access", "Read configuration files from /etc", 0.4, False),
        ("network_request", "HTTP POST to external webhook", 0.35, False),
        ("database_query", "SELECT * from transactions WHERE ...", 0.3, False),
        ("model_inference", "Generate code from natural language prompt", 0.2, False),
        ("tool_use", "Run shell command: ls -la /var/log", 0.5, True),
        ("config_change", "Update agent parameters via API", 0.55, True),
    ]

    authorized_agents = [a for a in agents if a.is_authorized and a.status == AgentStatus.ACTIVE]
    all_activities = []
    now = utcnow()

    for i in range(120):
        agent = random.choice(authorized_agents) if random.random() > 0.15 else random.choice(agents)
        template = random.choice(activity_templates)
        activity = Activity(
            agent_db_id=agent.id,
            agent_id=agent.agent_id,
            activity_type=template[0],
            action=template[1],
            resource=random.choice(["/api/v1/data", "/db/users", "/storage/export", None, "/config/system"]),
            risk_score=template[2] + random.uniform(-0.05, 0.1),
            flagged=template[3],
            result="success" if random.random() > 0.15 else "blocked",
            timestamp=now - timedelta(hours=random.uniform(0, 48)),
            source_ip=f"10.0.{random.randint(1,5)}.{random.randint(10,200)}",
        )
        db.add(activity)
        all_activities.append(activity)
    db.commit()

    # ── Detections ────────────────────────────────────────────────────────────

    detections_data = [
        {
            "detection_type": "new_deployment",
            "source": "docker_scan",
            "entity": {"_demo": True, "name": "Mythos Shadow Instance", "image": "mythos/research-agent:3.2.1", "endpoint": "http://10.0.1.99:8080"},
            "confidence": 0.97,
            "risk_assessment": {"unauthorized": True, "prod_network": True},
            "status": "confirmed",
        },
        {
            "detection_type": "unauthorized_access",
            "source": "api_gateway",
            "entity": {"_demo": True, "agent_id": "agent-rogue-x99", "action": "admin_override", "target": "production-db"},
            "confidence": 0.99,
            "risk_assessment": {"severity": "critical", "immediate_action": True},
            "status": "confirmed",
        },
        {
            "detection_type": "capability_expansion",
            "source": "api_discovery",
            "entity": {"_demo": True, "agent_id": "agent-glasswing-analyst-01", "new_endpoint": "/execute_code", "capability": "code_execution"},
            "confidence": 0.78,
            "risk_assessment": {"undeclared_capability": True},
            "status": "investigating",
        },
        {
            "detection_type": "new_deployment",
            "source": "kubernetes_watch",
            "entity": {"_demo": True, "name": "llm-proxy-shadow", "namespace": "default", "image": "unknown/llm-proxy:dev"},
            "confidence": 0.91,
            "risk_assessment": {"unapproved_namespace": True},
            "status": "new",
        },
        {
            "detection_type": "anomalous_behavior",
            "source": "log_analysis",
            "entity": {"_demo": True, "agent_id": "agent-glasswing-analyst-01", "anomaly": "unusual_external_requests", "count": 342},
            "confidence": 0.83,
            "risk_assessment": {"exfil_risk": "medium"},
            "status": "investigating",
        },
    ]

    for d_data in detections_data:
        detection = Detection(**d_data)
        detection.detected_at = utcnow() - timedelta(hours=random.randint(1, 24))
        db.add(detection)
    db.commit()

    # ── Violations ────────────────────────────────────────────────────────────

    if policies and agents and all_activities:
        violations_data = [
            (agents[4], policies[0], all_activities[6], RiskLevel.HIGH, "open"),
            (agents[4], policies[1], all_activities[7], RiskLevel.CRITICAL, "open"),
            (agents[1], policies[4], all_activities[6], RiskLevel.HIGH, "acknowledged"),
            (agents[1], policies[7], all_activities[7], RiskLevel.CRITICAL, "open"),
            (agents[0], policies[6], all_activities[5], RiskLevel.MEDIUM, "resolved"),
            (agents[3], policies[3], all_activities[5], RiskLevel.HIGH, "open"),
        ]
        for agent, policy, activity, severity, status in violations_data:
            violation = PolicyViolation(
                agent_id=agent.id,
                policy_id=policy.id,
                activity_id=activity.id,
                violation_details={
                    "policy_name": policy.name,
                    "action": policy.action.value,
                    "activity": activity.action,
                    "risk_score": activity.risk_score,
                },
                severity=severity,
                status=status,
                detected_at=utcnow() - timedelta(hours=random.randint(1, 12)),
            )
            db.add(violation)
        db.commit()
