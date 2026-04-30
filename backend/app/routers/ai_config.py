from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import asyncio
import httpx
import logging

from ..database import get_db
from ..models import PolicyViolation, PolicyRecommendation
from ..services import brain_engine

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai", tags=["ai"])


# ── Provider key management ────────────────────────────────────────────────

class ProviderKeyUpdate(BaseModel):
    provider: str
    api_key:  Optional[str] = None
    base_url: Optional[str] = None

_VALID_PROVIDERS = {"anthropic", "openai", "gemini", "ollama"}

@router.get("/provider-keys")
def get_provider_keys():
    """Return which providers have keys configured (never exposes the actual key value)."""
    return brain_engine.get_provider_status()

@router.post("/provider-keys")
def set_provider_key(payload: ProviderKeyUpdate):
    """Set a runtime API key or Ollama host URL. Takes effect immediately, non-persistent."""
    if payload.provider not in _VALID_PROVIDERS:
        raise HTTPException(400, f"provider must be one of {_VALID_PROVIDERS}")
    brain_engine.set_provider_key(
        payload.provider,
        api_key=payload.api_key or "",
        base_url=payload.base_url or "",
    )
    return {"status": "ok", "provider": payload.provider, **brain_engine.get_provider_status()[payload.provider]}


# ── Ollama model management ───────────────────────────────────────────────

# In-memory pull status tracker: { model_name: {status, progress, error, pct} }
_pull_status: dict[str, dict] = {}

def _ollama_host() -> str:
    return brain_engine.get_provider_status()["ollama"]["host"]

@router.get("/ollama/models")
async def list_ollama_models():
    """List models currently installed in Ollama."""
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(f"{_ollama_host()}/api/tags")
            r.raise_for_status()
            data = r.json()
            models = data.get("models", [])
            return [
                {
                    "name":     m["name"],
                    "size_gb":  round(m.get("size", 0) / 1e9, 2),
                    "modified": m.get("modified_at", ""),
                }
                for m in models
            ]
    except Exception as e:
        raise HTTPException(503, f"Ollama unreachable: {e}")


class OllamaPullRequest(BaseModel):
    model: str

@router.post("/ollama/pull")
async def pull_ollama_model(payload: OllamaPullRequest, background_tasks: BackgroundTasks):
    """Start pulling an Ollama model in the background. Poll /ollama/pull/status/{model} for progress."""
    model = payload.model.strip()
    if not model:
        raise HTTPException(400, "model name required")
    if _pull_status.get(model, {}).get("status") == "pulling":
        return {"status": "already_pulling", "model": model}
    _pull_status[model] = {"status": "pulling", "progress": "Starting…", "pct": 0, "error": None}
    background_tasks.add_task(_do_pull, model)
    return {"status": "started", "model": model}


@router.get("/ollama/pull/status")
def pull_status_all():
    return _pull_status


@router.get("/ollama/pull/status/{model:path}")
def pull_status_model(model: str):
    status = _pull_status.get(model)
    if status is None:
        return {"status": "not_started", "model": model}
    return {"model": model, **status}


async def _do_pull(model: str):
    """Background task: stream pull progress from Ollama, update _pull_status."""
    try:
        async with httpx.AsyncClient(timeout=600) as c:
            async with c.stream(
                "POST",
                f"{_ollama_host()}/api/pull",
                json={"name": model, "stream": True},
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    import json as _json
                    try:
                        chunk = _json.loads(line)
                    except Exception:
                        continue

                    status_txt = chunk.get("status", "")
                    total      = chunk.get("total", 0)
                    completed  = chunk.get("completed", 0)
                    pct = round(completed / total * 100, 1) if total else 0

                    _pull_status[model] = {
                        "status":   "pulling",
                        "progress": status_txt,
                        "pct":      pct,
                        "error":    None,
                    }

                    if status_txt == "success":
                        _pull_status[model]["status"] = "done"
                        _pull_status[model]["pct"]    = 100
                        return

        # If stream ended without explicit success
        _pull_status[model]["status"] = "done"
        _pull_status[model]["pct"]    = 100

    except Exception as e:
        _pull_status[model] = {
            "status":   "error",
            "progress": str(e)[:200],
            "pct":      0,
            "error":    str(e)[:200],
        }
        logger.error(f"Ollama pull failed for {model}: {e}")


# ── Status ─────────────────────────────────────────────────────────────────

@router.get("/status")
def ai_status():
    """Legacy single-brain status — returns a summary for the sidebar widget."""
    brains = brain_engine.list_brains()
    enabled = [b for b in brains if b["enabled"] and b["configured"]]
    return {
        "provider": "multi-brain",
        "model":    f"{len(enabled)}/{len(brains)} brains active",
        "enabled":  len(enabled) > 0,
        "configured": len(enabled) > 0,
        "brains_active": len(enabled),
        "brains_total":  len(brains),
    }


# ── Brain management ────────────────────────────────────────────────────────

@router.get("/brains")
def list_brains():
    """Return config + stats for all brains."""
    return brain_engine.list_brains()


@router.get("/brains/{role}")
def get_brain(role: str):
    try:
        return brain_engine.get_brain(role).to_dict()
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown brain role: {role}")


class BrainUpdate(BaseModel):
    provider: str
    model:    Optional[str] = None


@router.post("/brains/{role}/configure")
def configure_brain(role: str, payload: BrainUpdate):
    """Reconfigure a brain at runtime (takes effect immediately, non-persistent)."""
    valid_providers = {"claude", "ollama", "openai", "gemini", "none"}
    if payload.provider not in valid_providers:
        raise HTTPException(400, f"provider must be one of {valid_providers}")
    try:
        brain_engine.reconfigure_brain(role, payload.provider, payload.model or "")
        return brain_engine.get_brain(role).to_dict()
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/brains/{role}/test")
async def test_brain(role: str):
    """Send a minimal test prompt to verify the brain is reachable."""
    try:
        brain = brain_engine.get_brain(role)
    except KeyError:
        raise HTTPException(404, f"Unknown brain role: {role}")

    if not brain.enabled:
        return {"ok": False, "reason": "Brain provider is 'none'"}
    if not brain.configured:
        return {"ok": False, "reason": f"No API key for provider '{brain.provider}'"}

    result = await brain_engine._call_brain(
        brain,
        'Respond with exactly: {"ok": true, "message": "Brain online"}',
    )
    if result:
        return {"ok": True, "brain": role, "model": brain.model, "result": result}
    # Surface the actual error from the last call so the UI can show it
    last_err = brain.stats.last_error or "No response from model — check server logs"
    return {"ok": False, "reason": last_err}


# ── On-demand analysis ─────────────────────────────────────────────────────

@router.post("/analyze/detection")
async def analyze_detection(payload: dict):
    result = await brain_engine.analyze_detection(payload)
    if result is None:
        raise HTTPException(503, "No brains are configured. Set BRAIN_*_PROVIDER env vars.")
    return result


# ── Policy Brain: recommendations ─────────────────────────────────────────

@router.post("/brains/policy/run")
async def run_policy_brain(background_tasks: BackgroundTasks):
    """Trigger the Policy Brain to analyze recent violations and draft policy recommendations."""
    background_tasks.add_task(_policy_brain_task, None)
    return {"status": "Policy Brain triggered — check /api/ai/recommendations shortly"}


@router.get("/recommendations")
def list_recommendations(status: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(PolicyRecommendation)
    if status:
        q = q.filter(PolicyRecommendation.status == status)
    recs = q.order_by(PolicyRecommendation.created_at.desc()).limit(50).all()
    return [
        {
            "id":          r.id,
            "name":        r.name,
            "description": r.description,
            "conditions":  r.conditions,
            "action":      r.action,
            "priority":    r.priority,
            "rationale":   r.rationale,
            "gap_summary": r.gap_summary,
            "brain_model": r.brain_model,
            "status":      r.status,
            "created_at":  r.created_at.isoformat(),
        }
        for r in recs
    ]


@router.post("/recommendations/{rec_id}/accept")
def accept_recommendation(rec_id: int, db: Session = Depends(get_db)):
    """Accept a recommendation — promotes it to an actual Policy."""
    from ..models import Policy, PolicyAction
    rec = db.query(PolicyRecommendation).filter(PolicyRecommendation.id == rec_id).first()
    if not rec:
        raise HTTPException(404, "Recommendation not found")

    policy = Policy(
        name=rec.name,
        description=f"{rec.description}\n\n[Promoted from AI recommendation #{rec.id}]",
        enabled=True,
        priority=rec.priority,
        conditions=rec.conditions,
        action=rec.action,
        action_config={},
        updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(policy)
    rec.status = "accepted"
    db.commit()
    return {"status": "accepted", "policy_created": True}


@router.post("/recommendations/{rec_id}/reject")
def reject_recommendation(rec_id: int, db: Session = Depends(get_db)):
    rec = db.query(PolicyRecommendation).filter(PolicyRecommendation.id == rec_id).first()
    if not rec:
        raise HTTPException(404, "Recommendation not found")
    rec.status = "rejected"
    db.commit()
    return {"status": "rejected"}


# ── Background task ────────────────────────────────────────────────────────

async def _policy_brain_task(db: Session):
    from ..database import SessionLocal
    db2 = SessionLocal()
    try:
        violations = db2.query(PolicyViolation).order_by(
            PolicyViolation.detected_at.desc()
        ).limit(30).all()

        violation_data = [
            {
                "id": v.id,
                "severity": v.severity.value,
                "status": v.status,
                "details": v.violation_details,
                "detected_at": v.detected_at.isoformat(),
            }
            for v in violations
        ]

        result = await brain_engine.suggest_policies(violation_data)
        if not result or "recommendations" not in result:
            return

        gap_summary = result.get("gap_summary", "")
        brain_model = result.get("_brain", brain_engine.get_brain("policy").model)

        for rec in result.get("recommendations", []):
            exists = db2.query(PolicyRecommendation).filter(
                PolicyRecommendation.name == rec.get("name"),
                PolicyRecommendation.status == "pending",
            ).first()
            if exists:
                continue
            db2.add(PolicyRecommendation(
                name=rec.get("name", "Unnamed Policy"),
                description=rec.get("description", ""),
                conditions=rec.get("conditions", []),
                action=rec.get("action", "warn"),
                priority=rec.get("priority", 50),
                rationale=rec.get("rationale", ""),
                gap_summary=gap_summary,
                brain_model=brain_model,
                status="pending",
            ))
        db2.commit()
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Policy brain task failed: {e}")
    finally:
        db2.close()
