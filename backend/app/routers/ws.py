from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..websocket_manager import manager
import logging

router = APIRouter(tags=["websocket"])
logger = logging.getLogger(__name__)


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Client can send pings; echo back as pong
            if data == "ping":
                await manager.send_personal(websocket, "pong", {})
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)
