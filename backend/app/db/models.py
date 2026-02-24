import json

import aiosqlite

from app.db.database import get_db


async def insert_feedback(
    session_id: str,
    track_index: int,
    event_type: str,
    payload: dict,
    context: dict,
) -> int:
    db = await get_db()
    try:
        cursor = await db.execute(
            """
            INSERT INTO feedback (session_id, track_index, event_type, payload, context)
            VALUES (?, ?, ?, ?, ?)
            """,
            (session_id, track_index, event_type, json.dumps(payload), json.dumps(context)),
        )
        await db.commit()
        return cursor.lastrowid or 0
    finally:
        await db.close()
