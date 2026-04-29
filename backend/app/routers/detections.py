from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone

from ..database import get_db
from ..models import Detection
from ..schemas import DetectionReport, DetectionOut, DetectionStatusUpdate
from ..websocket_manager import manager as ws_manager
from ..services import brain_engine

router = APIRouter(prefix="/api/detections", tags=["detections"])


@router.get("", response_model=List[DetectionOut])
def list_detections(
    status: Optional[str] = None,
    detection_type: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Detection)
    if status:
        q = q.filter(Detection.status == status)
    if detection_type:
        q = q.filter(Detection.detection_type == detection_type)
    return q.order_by(Detection.detected_at.desc()).all()


@router.post("/report", response_model=DetectionOut, status_code=status.HTTP_201_CREATED)
async def report_detection(payload: DetectionReport, db: Session = Depends(get_db)):
    # Brain chain: Triage → Detection → (if high risk) Mitigation
    risk_assessment = dict(payload.risk_assessment)
    brain_result = await brain_engine.analyze_detection({
        "detection_type": payload.detection_type,
        "source":         payload.source,
        "entity":         payload.entity,
        "confidence":     payload.confidence,
    })
    if brain_result:
        risk_assessment["brain_analysis"] = brain_result

    detection = Detection(
        detection_type=payload.detection_type,
        source=payload.source,
        entity=payload.entity,
        confidence=payload.confidence,
        risk_assessment=risk_assessment,
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
    return detection


@router.get("/{detection_id}", response_model=DetectionOut)
def get_detection(detection_id: int, db: Session = Depends(get_db)):
    detection = db.query(Detection).filter(Detection.id == detection_id).first()
    if not detection:
        raise HTTPException(status_code=404, detail="Detection not found")
    return detection


@router.put("/{detection_id}/status", response_model=DetectionOut)
def update_detection_status(
    detection_id: int,
    payload: DetectionStatusUpdate,
    db: Session = Depends(get_db),
):
    detection = db.query(Detection).filter(Detection.id == detection_id).first()
    if not detection:
        raise HTTPException(status_code=404, detail="Detection not found")
    valid_statuses = {"new", "investigating", "confirmed", "resolved", "false_positive"}
    if payload.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
    detection.status = payload.status
    db.commit()
    db.refresh(detection)
    return detection
