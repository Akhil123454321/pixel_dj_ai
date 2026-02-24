"""Audio file upload + analysis endpoint."""

import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File, Form

from app.services.audio_analysis import analyze_audio_file
from app.services.feature_provider import cache_features

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".ogg", ".flac"}


@router.post("/analyze-audio")
async def analyze_audio(
    file: UploadFile = File(...),
    spotify_id: str = Form(...),
):
    """Upload an audio file, analyze it with librosa, and cache the features."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format '{ext}'. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    # Save to temp file, analyze, delete
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        features = analyze_audio_file(tmp_path)

        if features is None:
            raise HTTPException(
                status_code=500,
                detail="Audio analysis failed — librosa may not be installed",
            )

        # Cache with librosa source
        cached_features = {
            "bpm": features["bpm"],
            "musicalKey": features["musical_key"],
            "energy": features["energy"],
            "danceability": features["danceability"],
            "valence": features["valence"],
        }
        await cache_features(spotify_id, cached_features, "librosa")

        return {
            "spotify_id": spotify_id,
            "features": features,
            "source": "librosa",
        }

    finally:
        # Clean up temp file
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except Exception:
            pass
