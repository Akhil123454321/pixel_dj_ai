import aiosqlite

from app.config import settings

DB_PATH = settings.database_url.replace("sqlite:///", "")


async def get_db() -> aiosqlite.Connection:
    return await aiosqlite.connect(DB_PATH)


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                track_index INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL DEFAULT '{}',
                context TEXT NOT NULL DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS audio_features_cache (
                spotify_id TEXT PRIMARY KEY,
                bpm REAL NOT NULL,
                musical_key TEXT NOT NULL,
                energy REAL NOT NULL,
                danceability REAL NOT NULL,
                valence REAL NOT NULL,
                analysis_source TEXT NOT NULL,
                analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS generated_sets (
                session_id TEXT NOT NULL,
                track_index INTEGER NOT NULL,
                spotify_id TEXT NOT NULL,
                name TEXT,
                artist TEXT,
                bpm REAL,
                musical_key TEXT,
                energy REAL,
                danceability REAL,
                valence REAL,
                PRIMARY KEY (session_id, track_index)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS training_pairs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                track_position INTEGER NOT NULL,
                track_spotify_id TEXT NOT NULL,
                prev_spotify_id TEXT,
                delta_bpm REAL,
                delta_energy REAL,
                key_compatible INTEGER,
                camelot_distance INTEGER,
                delta_danceability REAL,
                delta_valence REAL,
                position_ratio REAL,
                phase_target_energy REAL,
                energy_vs_target REAL,
                phase_name TEXT,
                bpm REAL,
                energy REAL,
                danceability REAL,
                valence REAL,
                label REAL NOT NULL,
                chip_signal TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS ml_model_meta (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                model_version INTEGER NOT NULL,
                training_samples INTEGER NOT NULL,
                accuracy REAL,
                model_path TEXT NOT NULL,
                trained_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.commit()
