"""Unified feature resolution: cache → librosa → genre estimation fallback."""

import logging

import aiosqlite

from app.db.database import get_db
from app.services.audio_analysis import analyze_audio_file
from app.services.spotify import _estimate_features_from_metadata

logger = logging.getLogger(__name__)


async def get_features(
    spotify_id: str,
    track: dict,
    artist_genres: list[str],
    index: int,
    audio_path: str | None = None,
) -> dict:
    """Resolve features for a track using 3-tier strategy.

    1. Check audio_features_cache → return if hit
    2. If audio_path provided → run librosa analysis → cache → return
    3. Fall back to genre estimation → cache → return
    """
    # Tier 1: Cache lookup
    cached = await _get_cached_features(spotify_id)
    if cached:
        return cached

    # Tier 2: librosa analysis (if audio file available)
    if audio_path:
        analyzed = analyze_audio_file(audio_path)
        if analyzed:
            features = {
                "bpm": analyzed["bpm"],
                "energy": analyzed["energy"],
                "danceability": analyzed["danceability"],
                "valence": analyzed["valence"],
                "musicalKey": analyzed["musical_key"],
            }
            await cache_features(spotify_id, features, "librosa")
            return features

    # Tier 3: Genre-based estimation
    features = _estimate_features_from_metadata(track, artist_genres, index)
    await cache_features(spotify_id, features, "genre_estimate")
    return features


async def _get_cached_features(spotify_id: str) -> dict | None:
    """Look up cached features by Spotify ID."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT bpm, musical_key, energy, danceability, valence FROM audio_features_cache WHERE spotify_id = ?",
            (spotify_id,),
        )
        row = await cursor.fetchone()
        if row:
            return {
                "bpm": row[0],
                "musicalKey": row[1],
                "energy": row[2],
                "danceability": row[3],
                "valence": row[4],
            }
        return None
    finally:
        await db.close()


async def cache_features(spotify_id: str, features: dict, source: str):
    """Insert or replace features in the cache."""
    db = await get_db()
    try:
        await db.execute(
            """INSERT OR REPLACE INTO audio_features_cache
               (spotify_id, bpm, musical_key, energy, danceability, valence, analysis_source)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                spotify_id,
                features["bpm"],
                features.get("musicalKey", features.get("musical_key", "C")),
                features["energy"],
                features["danceability"],
                features["valence"],
                source,
            ),
        )
        await db.commit()
    finally:
        await db.close()
