"""
Multi-Brain AI Engine
─────────────────────
Five specialized agents, each independently configurable per provider and model.
Supports: Claude (Anthropic), OpenAI, Google Gemini, Ollama (local), and None.

Brain roster:
  triage     Rapid router: classifies events and routes to specialist brains
  detection  Threat hunter: deep-analyzes new AI deployments / anomalies
  risk       Risk assessor: context-aware activity risk scoring
  policy     Governance advisor: identifies policy gaps, drafts new rules
  mitigation Response coordinator: proportional mitigation decisions

Environment variables (per-brain overrides, falls back to AI_PROVIDER/AI_MODEL):
  BRAIN_TRIAGE_PROVIDER     BRAIN_TRIAGE_MODEL
  BRAIN_DETECTION_PROVIDER  BRAIN_DETECTION_MODEL
  BRAIN_RISK_PROVIDER       BRAIN_RISK_MODEL
  BRAIN_POLICY_PROVIDER     BRAIN_POLICY_MODEL
  BRAIN_MITIGATION_PROVIDER BRAIN_MITIGATION_MODEL

Provider API keys (can also be set at runtime via /api/ai/provider-keys):
  ANTHROPIC_API_KEY   (claude provider)
  OPENAI_API_KEY      (openai provider)
  GEMINI_API_KEY      (gemini provider)
  OLLAMA_HOST         (ollama provider, default http://localhost:11434)
"""

import os, json, time, asyncio, logging
from dataclasses import dataclass, field, asdict
from typing import Optional
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

# ── Env-based keys / hosts ─────────────────────────────────────────────────
_ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")
_OPENAI_KEY    = os.getenv("OPENAI_API_KEY",    "")
_GEMINI_KEY    = os.getenv("GEMINI_API_KEY",    "")
_OLLAMA_HOST   = os.getenv("OLLAMA_HOST",       "http://localhost:11434")
_AI_PROVIDER   = os.getenv("AI_PROVIDER",       "none")
_AI_MODEL      = os.getenv("AI_MODEL",          "")

# ── Persistent key store ───────────────────────────────────────────────────
# Stored in the governance_data volume so keys survive container restarts.
_KEYS_FILE = "/app/data/.provider_keys.json"

# ── Runtime key store (set via UI, takes precedence over env) ──────────────
_RUNTIME_KEYS: dict[str, str] = {}
_RUNTIME_OLLAMA_HOST: str = ""


def _load_persisted_keys() -> None:
    """Load keys saved by the UI from disk into the runtime store."""
    global _RUNTIME_OLLAMA_HOST
    try:
        if os.path.exists(_KEYS_FILE):
            with open(_KEYS_FILE, "r") as f:
                data = json.load(f)
            for provider, key in data.items():
                if provider == "ollama_host":
                    _RUNTIME_OLLAMA_HOST = key
                elif key:
                    _RUNTIME_KEYS[provider] = key
            logger.info(f"Loaded persisted provider keys: {list(data.keys())}")
    except Exception as e:
        logger.warning(f"Could not load persisted keys: {e}")


def _save_persisted_keys() -> None:
    """Write the current runtime key store to disk."""
    try:
        os.makedirs(os.path.dirname(_KEYS_FILE), exist_ok=True)
        data = {**_RUNTIME_KEYS}
        if _RUNTIME_OLLAMA_HOST:
            data["ollama_host"] = _RUNTIME_OLLAMA_HOST
        with open(_KEYS_FILE, "w") as f:
            json.dump(data, f)
    except Exception as e:
        logger.warning(f"Could not persist provider keys: {e}")


# Load any previously saved keys at import time
_load_persisted_keys()

# ── Persistent brain config store ─────────────────────────────────────────
_BRAIN_CONFIGS_FILE = "/app/data/.brain_configs.json"

def _load_brain_configs() -> dict:
    """Load saved brain provider/model assignments from disk."""
    try:
        if os.path.exists(_BRAIN_CONFIGS_FILE):
            with open(_BRAIN_CONFIGS_FILE, "r") as f:
                data = json.load(f)
            logger.info(f"Loaded brain configs: {list(data.keys())}")
            return data
    except Exception as e:
        logger.warning(f"Could not load brain configs: {e}")
    return {}

def _save_brain_configs() -> None:
    """Write current brain provider/model assignments to disk."""
    try:
        data = {
            role: {"provider": b.provider, "model": b.model}
            for role, b in _BRAINS.items()
        }
        with open(_BRAIN_CONFIGS_FILE, "w") as f:
            json.dump(data, f)
    except Exception as e:
        logger.warning(f"Could not save brain configs: {e}")

_DEFAULT_MODELS = {
    "claude": "claude-sonnet-4-5",
    "ollama": "llama3.2",
    "openai": "gpt-4o",
    "gemini": "gemini-2.0-flash",
}


def _get_key(provider: str) -> str:
    """Return runtime key (UI-set) if available, else fall back to env var."""
    runtime = _RUNTIME_KEYS.get(provider, "")
    if runtime:
        return runtime
    env_map = {
        "anthropic": _ANTHROPIC_KEY,
        "claude":    _ANTHROPIC_KEY,
        "openai":    _OPENAI_KEY,
        "gemini":    _GEMINI_KEY,
    }
    return env_map.get(provider, "")


def _get_ollama_host() -> str:
    return _RUNTIME_OLLAMA_HOST or _OLLAMA_HOST


def set_provider_key(provider: str, api_key: str = "", base_url: str = ""):
    """Set a runtime API key / Ollama host. Takes effect immediately and persists to disk."""
    global _RUNTIME_OLLAMA_HOST
    if api_key:
        _RUNTIME_KEYS[provider] = api_key
    if base_url and provider == "ollama":
        _RUNTIME_OLLAMA_HOST = base_url
    _save_persisted_keys()
    logger.info(f"Provider key updated and persisted: {provider} ({'key set' if api_key else 'url set'})")


def get_provider_status() -> dict:
    """Return which providers have keys configured (never expose the actual key)."""
    def _src(provider: str, env_key: str) -> str:
        if _RUNTIME_KEYS.get(provider): return "runtime"
        if env_key: return "env"
        return "none"

    return {
        "anthropic": {
            "configured": bool(_get_key("anthropic")),
            "source": _src("anthropic", _ANTHROPIC_KEY),
        },
        "openai": {
            "configured": bool(_get_key("openai")),
            "source": _src("openai", _OPENAI_KEY),
        },
        "gemini": {
            "configured": bool(_get_key("gemini")),
            "source": _src("gemini", _GEMINI_KEY),
        },
        "ollama": {
            "configured": True,
            "host": _get_ollama_host(),
            "source": "runtime" if _RUNTIME_OLLAMA_HOST else "env",
        },
    }


# ── Brain definitions ──────────────────────────────────────────────────────
@dataclass
class BrainStats:
    total_calls:    int   = 0
    success_calls:  int   = 0
    failed_calls:   int   = 0
    total_ms:       float = 0.0
    last_used:      Optional[str] = None
    last_error:     Optional[str] = None

@dataclass
class BrainConfig:
    role:        str
    provider:    str
    model:       str
    label:       str
    description: str
    icon:        str
    system_prompt: str
    stats: BrainStats = field(default_factory=BrainStats)

    @property
    def enabled(self) -> bool:
        return self.provider != "none"

    @property
    def configured(self) -> bool:
        if self.provider == "claude":  return bool(_get_key("anthropic"))
        if self.provider == "openai":  return bool(_get_key("openai"))
        if self.provider == "gemini":  return bool(_get_key("gemini"))
        if self.provider == "ollama":  return True
        return False

    @property
    def avg_latency_ms(self) -> float:
        if self.stats.success_calls == 0:
            return 0.0
        return round(self.stats.total_ms / self.stats.success_calls, 1)

    def to_dict(self) -> dict:
        return {
            "role":          self.role,
            "provider":      self.provider,
            "model":         self.model,
            "label":         self.label,
            "description":   self.description,
            "icon":          self.icon,
            "enabled":       self.enabled,
            "configured":    self.configured,
            "stats": {
                "total_calls":    self.stats.total_calls,
                "success_calls":  self.stats.success_calls,
                "failed_calls":   self.stats.failed_calls,
                "avg_latency_ms": self.avg_latency_ms,
                "last_used":      self.stats.last_used,
                "last_error":     self.stats.last_error,
            },
        }


def _brain_provider(role: str) -> str:
    return os.getenv(f"BRAIN_{role.upper()}_PROVIDER", _AI_PROVIDER)

def _brain_model(role: str) -> str:
    env_model = os.getenv(f"BRAIN_{role.upper()}_MODEL", "")
    provider  = _brain_provider(role)
    return env_model or _AI_MODEL or _DEFAULT_MODELS.get(provider, "unknown")


# ── System prompts ─────────────────────────────────────────────────────────
_PROMPTS = {
    "triage": """\
You are an AI governance triage coordinator. You receive raw events and rapidly
classify them, then route them to the correct specialist brain.
Be concise. Your output drives automated pipelines — precision matters.
Respond ONLY with valid JSON, no prose.""",

    "detection": """\
You are an expert AI deployment threat analyst embedded in an enterprise governance
platform. You identify unauthorized AI systems, undeclared capabilities, data-exfil
risks, and shadow deployments.
Think like a red-teamer: look for what could go wrong, what's hidden, what violates
least-privilege. Be specific about indicators.
Respond ONLY with valid JSON, no prose.""",

    "risk": """\
You are a precise AI activity risk assessor. You assign risk scores from 0.0 to 1.0
based on: action sensitivity, agent authorization, environment (prod > staging > dev),
declared vs actual capabilities, and blast radius.
Scores must be calibrated: 0.0–0.3 = routine, 0.3–0.6 = elevated, 0.6–0.8 = high,
0.8–1.0 = critical. Do NOT over-score routine operations.
Respond ONLY with valid JSON, no prose.""",

    "policy": """\
You are an AI governance policy architect. You analyze violation patterns and existing
policies to identify coverage gaps, then draft precise new governance rules.
Rules must be actionable, specific, and avoid false-positive overreach.
Respond ONLY with valid JSON, no prose.""",

    "mitigation": """\
You are an AI incident response coordinator. You recommend proportional mitigation
actions for policy violations and detected threats.
Principle of proportionality: match response severity to threat severity.
Never recommend overkill (e.g. terminate for a low-risk warn event).
Available actions: alert | rate_limit | suspend | block_traffic | quarantine | terminate | escalate.
Respond ONLY with valid JSON, no prose.""",
}

# ── Brain registry (mutable at runtime) ──────────────────────────────────
def _build_registry() -> dict[str, BrainConfig]:
    specs = [
        ("triage",     "◇", "Triage",     "Routes events to specialist brains"),
        ("detection",  "◉", "Detection",  "Deep-analyzes new deployments & anomalies"),
        ("risk",       "△", "Risk",       "Context-aware activity risk scoring"),
        ("policy",     "▣", "Policy",     "Identifies governance gaps, drafts rules"),
        ("mitigation", "⊛", "Mitigation", "Decides proportional incident response"),
    ]
    return {
        role: BrainConfig(
            role=role,
            provider=_brain_provider(role),
            model=_brain_model(role),
            label=label,
            description=desc,
            icon=icon,
            system_prompt=_PROMPTS[role],
        )
        for role, icon, label, desc in specs
    }

_BRAINS: dict[str, BrainConfig] = _build_registry()

# Apply any previously saved brain configurations
_saved_configs = _load_brain_configs()
for _role, _cfg in _saved_configs.items():
    if _role in _BRAINS:
        _BRAINS[_role].provider = _cfg.get("provider", _BRAINS[_role].provider)
        _BRAINS[_role].model    = _cfg.get("model",    _BRAINS[_role].model)


def get_brain(role: str) -> BrainConfig:
    return _BRAINS[role]

def list_brains() -> list[dict]:
    return [b.to_dict() for b in _BRAINS.values()]

def reconfigure_brain(role: str, provider: str, model: str):
    if role not in _BRAINS:
        raise ValueError(f"Unknown brain role: {role}")
    brain = _BRAINS[role]
    brain.provider = provider
    brain.model    = model or _DEFAULT_MODELS.get(provider, "unknown")
    _save_brain_configs()  # persist immediately


# ── JSON extractor ─────────────────────────────────────────────────────────
def _extract_json(text: str) -> Optional[dict]:
    start = text.find("{")
    end   = text.rfind("}") + 1
    if start == -1 or end == 0:
        return None
    try:
        return json.loads(text[start:end])
    except json.JSONDecodeError:
        return None


# ── Core LLM caller ────────────────────────────────────────────────────────
async def _call_brain(brain: BrainConfig, user_prompt: str) -> Optional[dict]:
    if not brain.enabled or not brain.configured:
        return None

    t0 = time.monotonic()
    brain.stats.total_calls += 1
    try:
        if brain.provider == "claude":
            result = await _claude(brain.system_prompt, user_prompt, brain.model, _get_key("anthropic"))
        elif brain.provider == "ollama":
            result = await _ollama(brain.system_prompt, user_prompt, brain.model)
        elif brain.provider == "openai":
            result = await _openai(brain.system_prompt, user_prompt, brain.model, _get_key("openai"))
        elif brain.provider == "gemini":
            result = await _gemini(brain.system_prompt, user_prompt, brain.model, _get_key("gemini"))
        else:
            return None

        elapsed = (time.monotonic() - t0) * 1000
        brain.stats.success_calls += 1
        brain.stats.total_ms      += elapsed
        brain.stats.last_used      = datetime.now(timezone.utc).isoformat()
        brain.stats.last_error     = None
        return result

    except Exception as e:
        brain.stats.failed_calls += 1
        brain.stats.last_error    = str(e)[:200]
        logger.warning(f"Brain [{brain.role}/{brain.provider}/{brain.model}] failed: {e}")
        return None


# ── Provider call implementations ──────────────────────────────────────────

async def _claude(system: str, user: str, model: str, api_key: str) -> Optional[dict]:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 1024,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            },
        )
        r.raise_for_status()
        return _extract_json(r.json()["content"][0]["text"])


async def _openai(system: str, user: str, model: str, api_key: str) -> Optional[dict]:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "response_format": {"type": "json_object"},
                "max_tokens": 1024,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user",   "content": user},
                ],
            },
        )
        r.raise_for_status()
        return _extract_json(r.json()["choices"][0]["message"]["content"])


async def _gemini(system: str, user: str, model: str, api_key: str) -> Optional[dict]:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": api_key, "content-type": "application/json"},
            json={
                "system_instruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": user}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "maxOutputTokens": 1024,
                },
            },
        )
        if not r.is_success:
            body = r.text[:500]
            raise RuntimeError(f"Gemini HTTP {r.status_code}: {body}")
        data = r.json()
        # Surface finish_reason / safety blocks before trying to parse
        candidate = data.get("candidates", [{}])[0]
        finish = candidate.get("finishReason", "")
        if finish and finish not in ("STOP", "MAX_TOKENS"):
            raise RuntimeError(f"Gemini blocked — finishReason: {finish}")
        parts = candidate.get("content", {}).get("parts", [])
        if not parts:
            raise RuntimeError(f"Gemini returned no content parts. Response: {str(data)[:300]}")
        return _extract_json(parts[0]["text"])


async def _ollama(system: str, user: str, model: str) -> Optional[dict]:
    async with httpx.AsyncClient(timeout=90) as c:
        r = await c.post(
            f"{_get_ollama_host()}/api/chat",
            json={
                "model": model,
                "stream": False,
                "format": "json",
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user",   "content": user},
                ],
            },
        )
        r.raise_for_status()
        return _extract_json(r.json()["message"]["content"])


# ── Brain-chain helpers ────────────────────────────────────────────────────

async def analyze_detection(detection_data: dict) -> Optional[dict]:
    """Chain: Triage → Detection → (if high risk) Mitigation"""
    results: dict = {}

    triage_result = await _call_brain(
        _BRAINS["triage"],
        f"""Classify this detection event and decide which specialist brains should analyze it.

Event:
{json.dumps(detection_data, indent=2, default=str)}

Respond with:
{{
  "classification": "new_deployment|capability_expansion|unauthorized_access|anomalous_behavior|false_positive",
  "urgency": "low|medium|high|critical",
  "route_to": ["detection", "mitigation"],
  "triage_notes": "one sentence summary"
}}""",
    )
    if triage_result:
        results["triage"] = {**triage_result, "_brain": _BRAINS["triage"].model}

    route_to = (triage_result or {}).get("route_to", ["detection"])

    det_result = None
    if "detection" in route_to:
        det_result = await _call_brain(
            _BRAINS["detection"],
            f"""Perform a full threat analysis of this AI deployment detection.

Event:
{json.dumps(detection_data, indent=2, default=str)}

Respond with:
{{
  "risk_level": "low|medium|high|critical",
  "confidence": 0.0-1.0,
  "explanation": "2-3 sentence risk narrative",
  "indicators": ["specific indicator 1", "specific indicator 2"],
  "attack_surface": "what could go wrong if not addressed",
  "suggested_policy": "optional one-line rule to add"
}}""",
        )
        if det_result:
            results["detection"] = {**det_result, "_brain": _BRAINS["detection"].model}

    urgency  = (triage_result or {}).get("urgency",    "")
    risk_lvl = (det_result    or {}).get("risk_level", "")
    if "mitigation" in route_to or risk_lvl in ("high", "critical") or urgency in ("high", "critical"):
        mit_result = await _call_brain(
            _BRAINS["mitigation"],
            f"""Recommend a proportional mitigation for this detected threat.

Detection summary: {json.dumps(detection_data, indent=2, default=str)}
Risk assessment:   {json.dumps(results.get('detection', {}), indent=2)}

Respond with:
{{
  "recommended_action": "alert|rate_limit|suspend|block_traffic|quarantine|terminate|escalate",
  "urgency": "immediate|within_1h|within_24h|monitor",
  "rationale": "one sentence",
  "auto_execute": true|false
}}""",
        )
        if mit_result:
            results["mitigation"] = {**mit_result, "_brain": _BRAINS["mitigation"].model}

    return results if results else None


async def analyze_activity(
    agent_name: str, agent_type: str, authorized: bool,
    environment: str, activity_type: str, action: str, rule_score: float,
) -> Optional[dict]:
    """Risk brain only — fast path for every activity."""
    return await _call_brain(
        _BRAINS["risk"],
        f"""Assess risk for this AI agent activity.

Agent:  {agent_name} (type={agent_type}, authorized={authorized}, env={environment})
Action: [{activity_type}] {action}
Rule-based score: {rule_score:.3f}

Respond with:
{{
  "adjusted_risk_score": 0.0-1.0,
  "risk_rationale": "one sentence",
  "flag": true|false,
  "_brain": "{_BRAINS['risk'].model}"
}}""",
    )


async def recommend_mitigation(violation_data: dict) -> Optional[dict]:
    """Mitigation brain — called when policy engine fires a violation."""
    return await _call_brain(
        _BRAINS["mitigation"],
        f"""A policy violation just occurred. Recommend a proportional response.

Violation:
{json.dumps(violation_data, indent=2, default=str)}

Respond with:
{{
  "recommended_action": "alert|rate_limit|suspend|block_traffic|quarantine|terminate|escalate",
  "urgency": "immediate|within_1h|within_24h|monitor",
  "rationale": "one sentence",
  "auto_execute": true|false,
  "_brain": "{_BRAINS['mitigation'].model}"
}}""",
    )


async def suggest_policies(recent_violations: list) -> Optional[dict]:
    """Policy brain — run periodically to identify governance gaps."""
    return await _call_brain(
        _BRAINS["policy"],
        f"""Analyze recent policy violations and identify governance gaps.

Recent violations (last 20):
{json.dumps(recent_violations[:20], indent=2, default=str)}

Respond with:
{{
  "gap_summary": "one paragraph describing the main gap",
  "recommendations": [
    {{
      "name": "Policy name",
      "description": "what it governs",
      "conditions": [{{"type": "action_contains", "value": "example"}}],
      "action": "warn|block|quarantine|escalate",
      "priority": 1-100,
      "rationale": "why this is needed"
    }}
  ],
  "_brain": "{_BRAINS['policy'].model}"
}}""",
    )
