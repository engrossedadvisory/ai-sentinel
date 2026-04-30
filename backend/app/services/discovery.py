"""
Automatic Agent Discovery Service
──────────────────────────────────
Scans the environment for running AI workloads and auto-registers
unknown agents for governance review.

Sources:
  1. Docker socket — containers on the same host
  2. Ollama API   — locally running models
  3. Background   — repeats every DISCOVERY_INTERVAL_SECONDS
"""

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import httpx

from ..database import SessionLocal
from ..models import Agent, AgentStatus, RiskLevel
from ..websocket_manager import manager as ws_manager

logger = logging.getLogger(__name__)

DISCOVERY_INTERVAL_SECONDS = int(os.getenv("DISCOVERY_INTERVAL", "300"))  # 5 min default

# Keywords that suggest a container is AI-related
_AI_KEYWORDS = [
    "ollama", "llm", "gpt", "claude", "gemini", "mistral", "llama",
    "hugging", "transformers", "vllm", "localai", "openwebui", "langchain",
    "langserve", "flowise", "litellm", "openai", "anthropic", "inference",
    "model", "embedding", "whisper", "stable-diffusion", "comfyui", "auto-gpt",
]

_DOCKER_SOCK = "/var/run/docker.sock"


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _is_ai_related(name: str, image: str, labels: dict) -> bool:
    text = f"{name} {image} {' '.join(labels.values())}".lower()
    return any(kw in text for kw in _AI_KEYWORDS)


async def _fetch_docker_containers() -> list[dict]:
    """Query Docker socket REST API for running containers."""
    if not os.path.exists(_DOCKER_SOCK):
        logger.debug("Docker socket not available — skipping Docker discovery")
        return []
    try:
        transport = httpx.AsyncHTTPTransport(uds=_DOCKER_SOCK)
        async with httpx.AsyncClient(transport=transport, base_url="http://localhost", timeout=5) as c:
            r = await c.get("/containers/json?all=false")
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.warning(f"Docker discovery error: {e}")
        return []


async def _fetch_ollama_models(ollama_host: str) -> list[dict]:
    """Fetch running/available models from Ollama."""
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{ollama_host}/api/tags")
            if r.is_success:
                return r.json().get("models", [])
    except Exception as e:
        logger.debug(f"Ollama discovery error: {e}")
    return []


def _register_agent(db, agent_id: str, name: str, agent_type: str,
                    endpoint: str, capabilities: list, metadata: dict) -> Optional[Agent]:
    """Register agent if not already known. Returns the agent if newly registered."""
    existing = db.query(Agent).filter(Agent.agent_id == agent_id).first()
    if existing:
        # Update last_seen for known agents
        existing.last_seen = _utcnow()
        db.commit()
        return None

    agent = Agent(
        agent_id=agent_id,
        name=name,
        type=agent_type,
        version="detected",
        endpoint=endpoint,
        status=AgentStatus.UNKNOWN,
        risk_level=RiskLevel.MEDIUM,
        capabilities=capabilities,
        allowed_actions=[],
        owner="auto-discovered",
        environment="unknown",
        deployment_source="discovery",
        is_authorized=False,
        agent_metadata=metadata,
        first_seen=_utcnow(),
        last_seen=_utcnow(),
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    logger.info(f"Auto-discovered agent: {name} ({agent_id})")
    return agent


async def run_discovery(ollama_host: str = "") -> dict:
    """
    Run a full discovery scan. Returns a summary dict with counts.
    Can be called from the API endpoint or the background loop.
    """
    if not ollama_host:
        ollama_host = os.getenv("OLLAMA_HOST", "http://localhost:11434")

    new_agents = []
    db = SessionLocal()

    try:
        # ── 1. Docker containers ──────────────────────────────────────────
        containers = await _fetch_docker_containers()
        for c in containers:
            name   = c.get("Names", ["unknown"])[0].lstrip("/")
            image  = c.get("Image", "")
            labels = c.get("Labels") or {}
            ports  = c.get("Ports", [])
            cid    = c.get("Id", "")[:12]

            # Skip our own containers
            if any(n in name for n in ["ai-sentinel-backend", "ai-sentinel-frontend"]):
                continue

            if not _is_ai_related(name, image, labels):
                continue

            # Build endpoint from first exposed port
            endpoint = ""
            for p in ports:
                public = p.get("PublicPort")
                if public:
                    endpoint = f"http://localhost:{public}"
                    break

            agent_id = f"docker-{cid}"
            capabilities = ["inference"]
            if "ollama" in image.lower():
                capabilities = ["inference", "model_serving", "local_llm"]

            agent = _register_agent(
                db, agent_id, name, "container",
                endpoint=endpoint or f"docker://{name}",
                capabilities=capabilities,
                metadata={"image": image, "container_id": cid, "labels": labels},
            )
            if agent:
                new_agents.append(agent)

        # ── 2. Ollama models ──────────────────────────────────────────────
        models = await _fetch_ollama_models(ollama_host)
        for m in models:
            model_name = m.get("name", "unknown")
            safe_id    = model_name.replace(":", "-").replace("/", "-")
            agent_id   = f"ollama-{safe_id}"
            agent = _register_agent(
                db, agent_id,
                name=f"Ollama / {model_name}",
                agent_type="local_llm",
                endpoint=f"{ollama_host}/api/generate",
                capabilities=["inference", "local_llm", "text_generation"],
                metadata={"model": model_name, "size": m.get("size"), "source": "ollama"},
            )
            if agent:
                new_agents.append(agent)

    finally:
        db.close()

    # Broadcast new-agent events over WebSocket
    for agent in new_agents:
        try:
            await ws_manager.broadcast({
                "type": "agent_registered",
                "data": {
                    "agent_id": agent.agent_id,
                    "name": agent.name,
                    "source": "auto-discovery",
                },
            })
        except Exception:
            pass

    return {
        "scanned": {
            "docker_containers": len(containers) if 'containers' in dir() else 0,
            "ollama_models":     len(models)     if 'models'     in dir() else 0,
        },
        "new_agents": len(new_agents),
        "agents": [{"agent_id": a.agent_id, "name": a.name} for a in new_agents],
    }


# ── Background loop ────────────────────────────────────────────────────────

_discovery_task: Optional[asyncio.Task] = None


async def _discovery_loop():
    """Runs run_discovery() on a fixed interval."""
    logger.info(f"Discovery loop started — interval {DISCOVERY_INTERVAL_SECONDS}s")
    while True:
        try:
            result = await run_discovery()
            if result["new_agents"] > 0:
                logger.info(f"Discovery found {result['new_agents']} new agent(s): {result['agents']}")
        except Exception as e:
            logger.warning(f"Discovery loop error: {e}")
        await asyncio.sleep(DISCOVERY_INTERVAL_SECONDS)


def start_discovery_loop():
    """Called once at app startup to begin background discovery."""
    global _discovery_task
    if _discovery_task is None or _discovery_task.done():
        _discovery_task = asyncio.create_task(_discovery_loop())
        logger.info("Agent discovery background task started")
