import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import engine, SessionLocal
from .models import Base
from .seed_data import seed
from .routers import agents, policies, activities, detections, mitigations, ws, dashboard, ai_config
from .services.detection_engine import run_detection_scanner
from .services.discovery import start_discovery_loop
from .routers.ai_config import _policy_brain_task

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        seed(db)
        logger.info("Database initialized and seeded")
    finally:
        db.close()

    scanner_task = asyncio.create_task(run_detection_scanner())
    logger.info("Detection scanner started")

    start_discovery_loop()
    logger.info("Agent discovery loop started")

    async def _policy_brain_loop():
        await asyncio.sleep(120)
        while True:
            try:
                await _policy_brain_task(None)
            except Exception as e:
                logger.warning(f"Policy Brain loop error: {e}")
            await asyncio.sleep(1800)

    policy_task = asyncio.create_task(_policy_brain_loop())
    logger.info("Policy Brain loop started")

    yield

    scanner_task.cancel()
    policy_task.cancel()
    try:
        await asyncio.gather(scanner_task, policy_task, return_exceptions=True)
    except Exception:
        pass


app = FastAPI(
    title="AI SENTINEL",
    description="AI acts. SENTINEL answers. — Monitor, detect, and govern AI agent deployments.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agents.router)
app.include_router(policies.router)
app.include_router(activities.router)
app.include_router(detections.router)
app.include_router(mitigations.router)
app.include_router(ws.router)
app.include_router(dashboard.router)
app.include_router(ai_config.router)


@app.get("/health")
def health():
    return {"status": "healthy", "service": "ai-governance-platform"}


@app.get("/")
def root():
    return {"service": "AI SENTINEL", "tagline": "AI acts. SENTINEL answers.", "version": "1.0.0", "docs": "/docs"}
