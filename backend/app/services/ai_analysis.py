"""
AI Analysis Service — pluggable agentic engine for intelligent detection analysis,
risk assessment, and mitigation recommendations.

Configure via environment variables:

  AI_PROVIDER      = none | claude | ollama | openai   (default: none)
  AI_MODEL         = model name override (optional — defaults shown below)
  ANTHROPIC_API_KEY= your Anthropic key  (required when AI_PROVIDER=claude)
  OPENAI_API_KEY   = your OpenAI key     (required when AI_PROVIDER=openai)
  OLLAMA_HOST      = http://host:11434   (required when AI_PROVIDER=ollama)

Default models per provider:
  claude  → claude-sonnet-4-6
  ollama  → llama3.2
  openai  → gpt-4o
"""

import os
import json
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

AI_PROVIDER      = os.getenv("AI_PROVIDER", "none").lower()
AI_MODEL         = os.getenv("AI_MODEL", "")
ANTHROPIC_API_KEY= os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY   = os.getenv("OPENAI_API_KEY", "")
OLLAMA_HOST      = os.getenv("OLLAMA_HOST", "http://localhost:11434")

_DEFAULT_MODELS = {
    "claude": "claude-sonnet-4-6",
    "ollama": "llama3.2",
    "openai": "gpt-4o",
}


def get_active_model() -> str:
    return AI_MODEL or _DEFAULT_MODELS.get(AI_PROVIDER, "none")


def is_enabled() -> bool:
    return AI_PROVIDER != "none"


def get_status() -> dict:
    return {
        "provider": AI_PROVIDER,
        "model": get_active_model(),
        "enabled": is_enabled(),
        "configured": _is_configured(),
    }


def _is_configured() -> bool:
    if AI_PROVIDER == "claude":
        return bool(ANTHROPIC_API_KEY)
    if AI_PROVIDER == "openai":
        return bool(OPENAI_API_KEY)
    if AI_PROVIDER == "ollama":
        return True  # no key required, just host reachability
    return False


# ── Prompts ────────────────────────────────────────────────────────────────

_DETECTION_PROMPT = """\
You are an AI governance security analyst. Analyze this AI deployment detection event and respond ONLY with valid JSON.

Detection:
{detection_json}

Respond with this exact JSON structure:
{{
  "risk_level": "low|medium|high|critical",
  "recommended_action": "allow|warn|block|quarantine|escalate",
  "confidence": 0.0-1.0,
  "explanation": "2-3 sentence plain-English risk analysis",
  "indicators": ["list", "of", "specific", "risk", "indicators"],
  "suggested_policy": "optional: one-line policy rule to add"
}}"""

_ACTIVITY_PROMPT = """\
You are an AI governance analyst. Assess the risk of this AI agent activity.

Agent: {agent_name} (type: {agent_type}, authorized: {authorized}, env: {environment})
Activity type: {activity_type}
Action: {action}
Current rule-based risk score: {rule_score}

Respond ONLY with valid JSON:
{{
  "adjusted_risk_score": 0.0-1.0,
  "risk_rationale": "one sentence explanation",
  "flag": true|false
}}"""


# ── Public API ─────────────────────────────────────────────────────────────

async def analyze_detection(detection_data: dict) -> Optional[dict]:
    """
    AI analysis of a new deployment detection.
    Returns structured analysis or None if AI is not configured.
    """
    if not is_enabled() or not _is_configured():
        return None

    prompt = _DETECTION_PROMPT.format(
        detection_json=json.dumps(detection_data, indent=2, default=str)
    )
    return await _call(prompt)


async def analyze_activity(
    agent_name: str,
    agent_type: str,
    authorized: bool,
    environment: str,
    activity_type: str,
    action: str,
    rule_score: float,
) -> Optional[dict]:
    """
    AI-enhanced risk scoring for an agent activity.
    Returns adjusted score and rationale, or None if AI is not configured.
    """
    if not is_enabled() or not _is_configured():
        return None

    prompt = _ACTIVITY_PROMPT.format(
        agent_name=agent_name,
        agent_type=agent_type,
        authorized=authorized,
        environment=environment,
        activity_type=activity_type,
        action=action,
        rule_score=rule_score,
    )
    return await _call(prompt)


# ── Dispatch ───────────────────────────────────────────────────────────────

async def _call(prompt: str) -> Optional[dict]:
    try:
        if AI_PROVIDER == "claude":
            return await _claude(prompt)
        if AI_PROVIDER == "ollama":
            return await _ollama(prompt)
        if AI_PROVIDER == "openai":
            return await _openai(prompt)
    except Exception as e:
        logger.warning(f"AI analysis call failed ({AI_PROVIDER}/{get_active_model()}): {e}")
    return None


def _extract_json(text: str) -> Optional[dict]:
    """Extract the first valid JSON object from a model response."""
    start = text.find("{")
    end = text.rfind("}") + 1
    if start == -1 or end == 0:
        return None
    try:
        return json.loads(text[start:end])
    except json.JSONDecodeError:
        return None


async def _claude(prompt: str) -> Optional[dict]:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": get_active_model(),
                "max_tokens": 512,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        resp.raise_for_status()
        text = resp.json()["content"][0]["text"]
        return _extract_json(text)


async def _ollama(prompt: str) -> Optional[dict]:
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{OLLAMA_HOST}/api/generate",
            json={
                "model": get_active_model(),
                "prompt": prompt,
                "stream": False,
                "format": "json",
            },
        )
        resp.raise_for_status()
        text = resp.json().get("response", "{}")
        return _extract_json(text)


async def _openai(prompt: str) -> Optional[dict]:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={
                "model": get_active_model(),
                "messages": [{"role": "user", "content": prompt}],
                "response_format": {"type": "json_object"},
                "max_tokens": 512,
            },
        )
        resp.raise_for_status()
        text = resp.json()["choices"][0]["message"]["content"]
        return _extract_json(text)
