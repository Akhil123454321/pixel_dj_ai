from fastapi import APIRouter

from app.db.models import insert_feedback
from app.models.schemas import FeedbackRequest
from app.services.feedback_processor import process_feedback_into_training

router = APIRouter()


@router.post("/feedback")
async def submit_feedback(body: FeedbackRequest):
    await insert_feedback(
        session_id=body.session_id,
        track_index=body.track_index,
        event_type=body.event_type,
        payload=body.payload,
        context=body.context,
    )

    # Process into ML training pairs (non-blocking, errors logged internally)
    await process_feedback_into_training(
        session_id=body.session_id,
        track_index=body.track_index,
        event_type=body.event_type,
        payload=body.payload,
        context=body.context,
    )

    return {"status": "ok"}
