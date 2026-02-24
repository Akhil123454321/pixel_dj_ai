"""XGBoost model training pipeline for track ordering."""

import logging
from pathlib import Path

import aiosqlite

from app.config import settings
from app.db.database import get_db

logger = logging.getLogger(__name__)

FEATURE_COLUMNS = [
    "delta_bpm", "delta_energy", "key_compatible", "camelot_distance",
    "delta_danceability", "delta_valence", "position_ratio",
    "phase_target_energy", "energy_vs_target",
    "bpm", "energy", "danceability", "valence",
]

PHASE_COLUMNS = ["warmup", "build", "peak", "cooldown"]


async def build_training_data():
    """Extract feature matrix and labels from training_pairs table.

    Returns (X, y) as lists, or None if insufficient data.
    """
    db = await get_db()
    try:
        cursor = await db.execute(
            f"""SELECT {', '.join(FEATURE_COLUMNS)}, phase_name, label
                FROM training_pairs
                ORDER BY created_at"""
        )
        rows = await cursor.fetchall()

        if len(rows) < settings.ml_min_training_samples:
            logger.info(f"Only {len(rows)} training samples (need {settings.ml_min_training_samples})")
            return None

        X = []
        y = []
        for row in rows:
            features = list(row[:len(FEATURE_COLUMNS)])
            # One-hot encode phase
            phase = row[len(FEATURE_COLUMNS)]
            for p in PHASE_COLUMNS:
                features.append(1.0 if phase == p else 0.0)
            X.append(features)
            y.append(row[-1])

        return X, y

    finally:
        await db.close()


async def train_model() -> dict | None:
    """Train an XGBoost binary classifier on accumulated feedback data.

    Returns training metrics dict, or None if insufficient data.
    """
    try:
        from xgboost import XGBClassifier
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import accuracy_score
        import numpy as np
    except ImportError:
        logger.warning("xgboost/scikit-learn not installed — skipping ML training")
        return None

    data = await build_training_data()
    if data is None:
        return None

    X, y = data
    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.float32)

    # Binary labels for XGBoost: round to 0 or 1
    y_binary = (y >= 0.5).astype(np.float32)

    # Train/test split
    if len(X) >= 50:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y_binary, test_size=0.2, random_state=42
        )
    else:
        X_train, X_test, y_train, y_test = X, X, y_binary, y_binary

    model = XGBClassifier(
        n_estimators=100,
        max_depth=4,
        learning_rate=0.1,
        eval_metric="logloss",
        use_label_encoder=False,
    )
    model.fit(X_train, y_train)

    # Evaluate
    y_pred = model.predict(X_test)
    accuracy = float(accuracy_score(y_test, y_pred))

    # Determine version
    db = await get_db()
    try:
        cursor = await db.execute("SELECT MAX(model_version) FROM ml_model_meta")
        row = await cursor.fetchone()
        version = (row[0] or 0) + 1

        # Save model
        model_dir = Path(settings.ml_model_dir)
        model_dir.mkdir(parents=True, exist_ok=True)
        model_path = model_dir / f"ranker_v{version}.json"
        model.save_model(str(model_path))

        # Record in meta table
        await db.execute(
            """INSERT INTO ml_model_meta (model_version, training_samples, accuracy, model_path)
               VALUES (?, ?, ?, ?)""",
            (version, len(X), accuracy, str(model_path)),
        )
        await db.commit()

        logger.info(f"Trained ML model v{version}: {len(X)} samples, accuracy={accuracy:.3f}")
        return {
            "model_version": version,
            "training_samples": len(X),
            "accuracy": accuracy,
            "model_path": str(model_path),
        }

    finally:
        await db.close()
