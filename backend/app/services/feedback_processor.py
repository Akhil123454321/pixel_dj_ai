"""Convert raw feedback events into ML training pairs."""

import logging

from app.db.database import get_db
from app.services.transition import keys_compatible, camelot_distance
from app.services.set_generator import _phase_targets

logger = logging.getLogger(__name__)

# Label mapping
LABEL_MAP = {
    "thumbs_up": 1.0,
    "thumbs_down": 0.0,
}
CHIP_LABEL = 0.3


async def process_feedback_into_training(
    session_id: str,
    track_index: int,
    event_type: str,
    payload: dict,
    context: dict,
):
    """Look up full track data from generated_sets and create a training pair."""
    db = await get_db()
    try:
        # Look up the current track from generated_sets
        cursor = await db.execute(
            """SELECT spotify_id, name, artist, bpm, musical_key, energy, danceability, valence
               FROM generated_sets WHERE session_id = ? AND track_index = ?""",
            (session_id, track_index),
        )
        current = await cursor.fetchone()
        if not current:
            logger.debug(f"No generated_set data for session={session_id}, index={track_index}")
            return

        track_spotify_id = current[0]
        bpm = current[3]
        musical_key = current[4]
        energy = current[5]
        danceability = current[6]
        valence = current[7]

        # Look up predecessor track
        prev_spotify_id = None
        delta_bpm = 0.0
        delta_energy = 0.0
        key_compat = 0
        cam_distance = 99
        delta_danceability = 0.0
        delta_valence = 0.0

        if track_index > 0:
            cursor = await db.execute(
                """SELECT spotify_id, bpm, musical_key, energy, danceability, valence
                   FROM generated_sets WHERE session_id = ? AND track_index = ?""",
                (session_id, track_index - 1),
            )
            prev = await cursor.fetchone()
            if prev:
                prev_spotify_id = prev[0]
                delta_bpm = bpm - prev[1]
                delta_energy = energy - prev[3]
                key_compat = 1 if keys_compatible(musical_key, prev[2]) else 0
                cam_distance = camelot_distance(musical_key, prev[2])
                delta_danceability = danceability - prev[4]
                delta_valence = valence - prev[5]

        # Count total tracks in this session for phase calculation
        cursor = await db.execute(
            "SELECT COUNT(*) FROM generated_sets WHERE session_id = ?",
            (session_id,),
        )
        total_tracks = (await cursor.fetchone())[0]

        # Phase info
        phases = _phase_targets(total_tracks)
        position_ratio = track_index / max(total_tracks - 1, 1)
        if track_index < len(phases):
            phase_name, phase_target_energy = phases[track_index]
        else:
            phase_name = "cooldown"
            phase_target_energy = 0.5
        energy_vs_target = energy - phase_target_energy

        # Determine label
        if event_type in LABEL_MAP:
            label = LABEL_MAP[event_type]
        else:
            label = CHIP_LABEL

        chip_signal = payload.get("chip") if event_type not in LABEL_MAP else None

        await db.execute(
            """INSERT INTO training_pairs
               (session_id, track_position, track_spotify_id, prev_spotify_id,
                delta_bpm, delta_energy, key_compatible, camelot_distance,
                delta_danceability, delta_valence, position_ratio,
                phase_target_energy, energy_vs_target, phase_name,
                bpm, energy, danceability, valence, label, chip_signal)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                session_id, track_index, track_spotify_id, prev_spotify_id,
                delta_bpm, delta_energy, key_compat, cam_distance,
                delta_danceability, delta_valence, position_ratio,
                phase_target_energy, energy_vs_target, phase_name,
                bpm, energy, danceability, valence, label, chip_signal,
            ),
        )
        await db.commit()
        logger.info(f"Training pair created: session={session_id}, index={track_index}, label={label}")

    except Exception as e:
        logger.error(f"Failed to process feedback into training: {e}")
    finally:
        await db.close()
