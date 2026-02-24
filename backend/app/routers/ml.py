"""ML training and status endpoints."""

import logging

from fastapi import APIRouter

from app.config import settings
from app.db.database import get_db
from app.services.ml_training import train_model

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/ml/train")
async def trigger_training():
    """Manually trigger ML model training."""
    result = await train_model()

    if result is None:
        # Check how much data we have
        db = await get_db()
        try:
            cursor = await db.execute("SELECT COUNT(*) FROM training_pairs")
            count = (await cursor.fetchone())[0]
        finally:
            await db.close()

        return {
            "status": "insufficient_data",
            "training_samples": count,
            "required": settings.ml_min_training_samples,
            "message": f"Need at least {settings.ml_min_training_samples} training samples, have {count}",
        }

    return {
        "status": "trained",
        **result,
    }


@router.get("/ml/status")
async def ml_status():
    """Get current ML model info and training data counts."""
    db = await get_db()
    try:
        # Training data count
        cursor = await db.execute("SELECT COUNT(*) FROM training_pairs")
        total_pairs = (await cursor.fetchone())[0]

        # Positive/negative split
        cursor = await db.execute("SELECT COUNT(*) FROM training_pairs WHERE label >= 0.5")
        positive = (await cursor.fetchone())[0]
        negative = total_pairs - positive

        # Latest model info
        cursor = await db.execute(
            "SELECT model_version, training_samples, accuracy, trained_at FROM ml_model_meta ORDER BY model_version DESC LIMIT 1"
        )
        model_row = await cursor.fetchone()

        model_info = None
        if model_row:
            model_info = {
                "version": model_row[0],
                "training_samples": model_row[1],
                "accuracy": model_row[2],
                "trained_at": model_row[3],
            }

        return {
            "training_data": {
                "total": total_pairs,
                "positive": positive,
                "negative": negative,
            },
            "ready_to_train": total_pairs >= settings.ml_min_training_samples,
            "min_samples_required": settings.ml_min_training_samples,
            "current_model": model_info,
        }

    finally:
        await db.close()
