"""
Detection engine — discovers new AI deployments via:
  1. Self-registration beacon (POST /api/detections/report)
  2. Background simulated scanner (mimics Docker/K8s/network probes)
  3. Anomaly signals forwarded from the activity stream
"""
import asyncio
import random
import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from ..database import SessionLocal
from ..models import Detection, Agent, AgentStatus, RiskLevel
from ..websocket_manager import manager as ws_manager
from ..seed_data import DEMO_AGENT_IDS

logger = logging.getLogger(__name__)

SIMULATED_DISCOVERIES = [
    {
        "detection_type": "new_deployment",
        "source": "docker_scan",
        "entity": {
            "name": "Mythos-ResearchAgent-v2",
            "image": "mythos/research-agent:2.1.0",
            "endpoint": "http://10.0.1.42:8080",
            "type": "autonomous_agent",
            "owner": "research-team",
        },
        "confidence": 0.94,
        "risk_assessment": {"unauthorized": True, "capability_unknown": True, "network_exposure": "internal"},
    },
    {
        "detection_type": "new_deployment",
        "source": "network_scan",
        "entity": {
            "name": "Glasswing-DataPipeline",
            "endpoint": "http://10.0.2.17:9090",
            "type": "workflow_orchestrator",
            "api_signature": "openai-compatible",
        },
        "confidence": 0.88,
        "risk_assessment": {"data_exfil_risk": "medium", "production_facing": True},
    },
    {
        "detection_type": "capability_expansion",
        "source": "api_discovery",
        "entity": {
            "agent_id": "unknown",
            "new_capability": "code_execution",
            "endpoint": "http://10.0.3.55:3001/execute",
        },
        "confidence": 0.76,
        "risk_assessment": {"severity": "high", "unauthorized_capability": True},
    },
    {
        "detection_type": "new_deployment",
        "source": "kubernetes_watch",
        "entity": {
            "name": "llm-proxy-service",
            "namespace": "ai-prod",
            "image": "internal/llm-proxy:latest",
            "replicas": 3,
        },
        "confidence": 0.99,
        "risk_assessment": {"scale": "high", "prod_namespace": True},
    },
    {
        "detection_type": "anomalous_behavior",
        "source": "log_analysis",
        "entity": {
            "agent_id": "agent-glasswing-01",
            "anomaly": "unexpected_external_requests",
            "destination": "api.external-service.io",
            "request_count": 847,
        },
        "confidence": 0.82,
        "risk_assessment": {"exfiltration_probability": 0.65, "data_volume": "high"},
    },
    {
        "detection_type": "unauthorized_access",
        "source": "api_gateway",
        "entity": {
            "name": "rogue-agent-x",
            "endpoint": "http://10.0.9.99:4444",
            "action_attempted": "admin_override",
            "target": "production-database",
        },
        "confidence": 0.97,
        "risk_assessment": {"severity": "critical", "immediate_action_required": True},
    },
]


async def run_detection_scanner():
    """
    Background task: periodically "discovers" new AI deployments.
    In production this would hook into Docker API, Kubernetes watch API,
    network tap, cloud provider APIs, etc.
    """
    await asyncio.sleep(15)
    while True:
        try:
            interval = random.randint(45, 120)
            await asyncio.sleep(interval)

            if random.random() < 0.6:
                template = random.choice(SIMULATED_DISCOVERIES)
                db: Session = SessionLocal()
                try:
                    # All scanner detections are simulated — mark as demo so
                    # they are hidden when the UI is in Live mode.
                    entity = {**template["entity"], "_demo": True}
                    detection = Detection(
                        detection_type=template["detection_type"],
                        source=template["source"],
                        entity=entity,
                        confidence=template["confidence"] + random.uniform(-0.05, 0.05),
                        risk_assessment=template["risk_assessment"],
                        status="new",
                        detected_at=datetime.now(timezone.utc).replace(tzinfo=None),
                    )
                    db.add(detection)
                    db.commit()
                    db.refresh(detection)

                    await ws_manager.broadcast("new_detection", {
                        "id": detection.id,
                        "detection_type": detection.detection_type,
                        "source": detection.source,
                        "entity": detection.entity,
                        "confidence": detection.confidence,
                        "status": detection.status,
                        "detected_at": detection.detected_at.isoformat(),
                    })
                    logger.info(f"Detection scanner found: {detection.detection_type} via {detection.source}")
                finally:
                    db.close()
        except Exception as e:
            logger.error(f"Detection scanner error: {e}")
            await asyncio.sleep(30)


async def flag_anomalous_agent(agent: Agent, reason: str, db: Session):
    """Called by the activity pipeline when risk score exceeds threshold."""
    entity = {
        "agent_id": agent.agent_id,
        "name": agent.name,
        "reason": reason,
    }
    if agent.agent_id in DEMO_AGENT_IDS:
        entity["_demo"] = True
    detection = Detection(
        detection_type="anomalous_behavior",
        source="activity_monitor",
        entity=entity,
        confidence=0.85,
        risk_assessment={"agent_risk_level": agent.risk_level.value, "trigger": reason},
        status="new",
        agent_id=agent.id,
        detected_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(detection)
    db.commit()
    db.refresh(detection)

    await ws_manager.broadcast("new_detection", {
        "id": detection.id,
        "detection_type": detection.detection_type,
        "source": detection.source,
        "entity": detection.entity,
        "confidence": detection.confidence,
        "status": detection.status,
        "detected_at": detection.detected_at.isoformat(),
    })
