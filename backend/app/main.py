from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.database import init_db
from app.routers import analysis, feedback, ml, sets, tracks


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Pre-load ML model if available
    try:
        from app.services.ml_ranker import load_latest_model
        await load_latest_model()
    except Exception:
        pass  # ML model not available yet, that's fine
    yield


app = FastAPI(title="AI DJ Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sets.router, prefix="/api")
app.include_router(tracks.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(analysis.router, prefix="/api")
app.include_router(ml.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
