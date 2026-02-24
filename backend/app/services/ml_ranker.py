"""ML-powered track ordering using trained XGBoost model."""

import logging
from pathlib import Path

from app.config import settings
from app.db.database import get_db
from app.services.set_generator import _phase_targets
from app.services.transition import keys_compatible, camelot_distance

logger = logging.getLogger(__name__)

# Singleton model cache
_model = None
_model_version: int | None = None


async def load_latest_model():
    """Load the latest trained model from ml_model_meta."""
    global _model, _model_version

    try:
        from xgboost import XGBClassifier
    except ImportError:
        logger.debug("xgboost not installed — ML ranking unavailable")
        return

    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT model_version, model_path FROM ml_model_meta ORDER BY model_version DESC LIMIT 1"
        )
        row = await cursor.fetchone()
        if not row:
            return

        version, model_path = row
        if version == _model_version:
            return  # already loaded

        if not Path(model_path).exists():
            logger.warning(f"Model file not found: {model_path}")
            return

        model = XGBClassifier()
        model.load_model(model_path)
        _model = model
        _model_version = version
        logger.info(f"Loaded ML model v{version} from {model_path}")

    finally:
        await db.close()


def _extract_pair_features(
    candidate: dict,
    predecessor: dict | None,
    position: int,
    total: int,
    phases: list[tuple[str, float]],
) -> list[float]:
    """Extract the feature vector for a (candidate, predecessor, position) tuple."""
    bpm = candidate.get("bpm", 120.0)
    energy = candidate.get("energy", 0.5)
    danceability = candidate.get("danceability", 0.5)
    valence = candidate.get("valence", 0.5)
    key = candidate.get("musicalKey", "C")

    if predecessor:
        prev_bpm = predecessor.get("bpm", 120.0)
        prev_energy = predecessor.get("energy", 0.5)
        prev_danceability = predecessor.get("danceability", 0.5)
        prev_valence = predecessor.get("valence", 0.5)
        prev_key = predecessor.get("musicalKey", "C")

        delta_bpm = bpm - prev_bpm
        delta_energy = energy - prev_energy
        key_compat = 1.0 if keys_compatible(key, prev_key) else 0.0
        cam_dist = float(camelot_distance(key, prev_key))
        delta_danceability = danceability - prev_danceability
        delta_valence = valence - prev_valence
    else:
        delta_bpm = 0.0
        delta_energy = 0.0
        key_compat = 1.0
        cam_dist = 0.0
        delta_danceability = 0.0
        delta_valence = 0.0

    position_ratio = position / max(total - 1, 1)

    if position < len(phases):
        phase_name, phase_target = phases[position]
    else:
        phase_name = "cooldown"
        phase_target = 0.5

    energy_vs_target = energy - phase_target

    features = [
        delta_bpm, delta_energy, key_compat, cam_dist,
        delta_danceability, delta_valence, position_ratio,
        phase_target, energy_vs_target,
        bpm, energy, danceability, valence,
    ]
    # One-hot phase
    for p in ["warmup", "build", "peak", "cooldown"]:
        features.append(1.0 if phase_name == p else 0.0)

    return features


def ml_order_tracks(
    candidates: list[dict],
    track_count: int,
    seed_tracks: list[dict] | None = None,
) -> list[dict] | None:
    """Order tracks using ML model predictions. Returns None if no model available."""
    if _model is None:
        return None

    try:
        import numpy as np
    except ImportError:
        return None

    phases = _phase_targets(track_count)

    guaranteed = list(seed_tracks or [])
    guaranteed_ids = {t["spotify_id"] for t in guaranteed}
    available = [c for c in candidates if c["spotify_id"] not in guaranteed_ids]
    pool = guaranteed + available

    ordered: list[dict] = []

    for position in range(min(track_count, len(phases))):
        if not pool:
            break

        predecessor = ordered[-1] if ordered else None

        # Score all candidates
        feature_vectors = []
        for candidate in pool:
            features = _extract_pair_features(
                candidate, predecessor, position, track_count, phases
            )
            feature_vectors.append(features)

        X = np.array(feature_vectors, dtype=np.float32)
        probas = _model.predict_proba(X)[:, 1]

        # Bonus for seed tracks
        for i, candidate in enumerate(pool):
            if candidate["spotify_id"] in guaranteed_ids:
                probas[i] += 0.1

        best_idx = int(np.argmax(probas))
        best = pool[best_idx]
        pool.remove(best)
        ordered.append(best)

    logger.info(f"ML ordering complete: {len(ordered)} tracks (model v{_model_version})")
    return ordered
