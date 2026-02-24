"""Audio feature extraction using librosa (lazy-imported)."""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Krumhansl-Kessler key profiles for major and minor keys
_MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
_MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
_PITCH_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


def _detect_key(chroma) -> str:
    """Detect musical key from chroma features using Krumhansl-Kessler profiles."""
    try:
        import numpy as np
    except ImportError:
        return "C"

    chroma_avg = np.mean(chroma, axis=1)
    if np.sum(chroma_avg) == 0:
        return "C"

    chroma_avg = chroma_avg / np.sum(chroma_avg)

    best_corr = -2.0
    best_key = "C"

    major = np.array(_MAJOR_PROFILE)
    minor = np.array(_MINOR_PROFILE)

    for shift in range(12):
        rolled = np.roll(chroma_avg, -shift)
        # Major
        corr = np.corrcoef(rolled, major)[0, 1]
        if corr > best_corr:
            best_corr = corr
            best_key = _PITCH_NAMES[shift]
        # Minor
        corr = np.corrcoef(rolled, minor)[0, 1]
        if corr > best_corr:
            best_corr = corr
            best_key = f"{_PITCH_NAMES[shift]}m"

    return best_key


def analyze_audio_file(file_path: str | Path) -> dict | None:
    """Analyze an audio file for BPM, key, energy, danceability, valence.

    Returns dict with keys: bpm, musical_key, energy, danceability, valence.
    Returns None if librosa is not installed or analysis fails.
    """
    try:
        import librosa
        import numpy as np
    except ImportError:
        logger.warning("librosa/numpy not installed — skipping audio analysis")
        return None

    try:
        y, sr = librosa.load(str(file_path), sr=22050, mono=True)

        # BPM via beat tracking
        tempo, _beats = librosa.beat.beat_track(y=y, sr=sr)
        bpm = float(tempo[0]) if hasattr(tempo, '__len__') else float(tempo)

        # Key via chroma CQT
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        musical_key = _detect_key(chroma)

        # Energy via RMS (normalized to 0-1)
        rms = librosa.feature.rms(y=y)[0]
        energy = float(np.clip(np.mean(rms) / 0.15, 0.0, 1.0))

        # Danceability from onset regularity + tempo stability
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        onset_std = float(np.std(onset_env))
        # More regular onsets = higher danceability
        regularity = 1.0 - min(onset_std / (np.mean(onset_env) + 1e-6), 1.0)
        # Tempo in dance range (100-140) boosts danceability
        tempo_factor = 1.0 - min(abs(bpm - 120) / 60.0, 1.0)
        danceability = float(np.clip(0.4 * regularity + 0.6 * tempo_factor, 0.0, 1.0))

        # Valence from spectral brightness + major/minor key
        spectral_centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
        brightness = float(np.clip(np.mean(spectral_centroid) / 5000.0, 0.0, 1.0))
        is_major = "m" not in musical_key or musical_key.endswith("m") is False
        key_factor = 0.6 if is_major else 0.4
        valence = float(np.clip(0.5 * brightness + 0.5 * key_factor, 0.0, 1.0))

        return {
            "bpm": round(bpm, 1),
            "musical_key": musical_key,
            "energy": round(energy, 2),
            "danceability": round(danceability, 2),
            "valence": round(valence, 2),
        }

    except Exception as e:
        logger.error(f"Audio analysis failed for {file_path}: {e}")
        return None
