import logging
import uuid

import httpx
from fastapi import APIRouter, Header, HTTPException

from app.db.database import get_db
from app.models.schemas import GenerateSetRequest, GenerateSetResponse
from app.services import spotify
from app.services.discovery import discover_tracks_expanded
from app.services.feature_provider import get_features
from app.services.set_generator import generate_set

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/generate-set", response_model=GenerateSetResponse)
async def generate_set_endpoint(
    body: GenerateSetRequest,
    authorization: str = Header(default=""),
):
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing Spotify token")

    try:
        # 1. Resolve seed tracks — search for each and get full track data
        logger.info(f"Generating set: prompt='{body.prompt}', seeds={body.seeds}")
        seed_tracks_raw: list[dict] = []
        for seed in body.seeds[:5]:
            result = await spotify.search_track(token, seed)
            if result:
                logger.info(f"Seed found: {result['name']} by {result['artists'][0]['name']}")
                seed_tracks_raw.append(result)

        # 2. Discover additional tracks via expanded strategies
        raw_tracks = await discover_tracks_expanded(
            token=token,
            seed_names=body.seeds,
            seed_tracks_raw=seed_tracks_raw,
            vibe_query=body.prompt,
            limit=body.track_count * 4,
        )

        # Merge seeds into raw_tracks (dedup)
        seen_ids = {t["id"] for t in raw_tracks}
        for st in seed_tracks_raw:
            if st["id"] not in seen_ids:
                raw_tracks.insert(0, st)
                seen_ids.add(st["id"])

        if not raw_tracks:
            raise HTTPException(status_code=404, detail="No tracks found — try different seeds or prompt")

        # 3. Get artist genres for feature estimation
        artist_ids: list[str] = []
        for t in raw_tracks:
            for a in t.get("artists", []):
                artist_ids.append(a["id"])

        artist_genre_map = await spotify.get_artist_genres_batch(token, artist_ids)

        # 4. Estimate features and build candidates
        candidates = []
        seed_track_parsed: list[dict] = []
        seed_spotify_ids = {t["id"] for t in seed_tracks_raw}

        for i, track in enumerate(raw_tracks):
            genres: list[str] = []
            for a in track.get("artists", []):
                genres.extend(artist_genre_map.get(a["id"], []))

            features = await get_features(track["id"], track, genres, i)
            parsed = spotify.parse_track_with_features(track, features, i)
            candidates.append(parsed)

            if track["id"] in seed_spotify_ids:
                seed_track_parsed.append(parsed)

        logger.info(f"Built {len(candidates)} candidates ({len(seed_track_parsed)} seeds)")

        # 5. Run set generator with seed tracks guaranteed
        result = await generate_set(
            candidates,
            body.prompt,
            body.track_count,
            seed_tracks=seed_track_parsed,
        )

        # 6. Store generated set for ML feedback processing
        session_id = body.session_id or str(uuid.uuid4())
        result.session_id = session_id

        db = await get_db()
        try:
            for i, track in enumerate(result.tracks):
                # Look up danceability/valence from candidates
                cand = next((c for c in candidates if c["spotify_id"] == track.spotifyUri.replace("spotify:track:", "")), None)
                await db.execute(
                    """INSERT OR REPLACE INTO generated_sets
                       (session_id, track_index, spotify_id, name, artist, bpm, musical_key, energy, danceability, valence)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        session_id, i,
                        track.spotifyUri.replace("spotify:track:", ""),
                        track.name, track.artist, track.bpm, track.musicalKey, track.energy,
                        cand.get("danceability", 0.5) if cand else 0.5,
                        cand.get("valence", 0.5) if cand else 0.5,
                    ),
                )
            await db.commit()
        finally:
            await db.close()

        return result

    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        logger.error(f"Spotify API error {e.response.status_code}: {e.response.text}")
        if e.response.status_code == 401:
            raise HTTPException(status_code=401, detail="Spotify token expired or invalid — please re-login")
        raise HTTPException(status_code=502, detail=f"Spotify API error ({e.response.status_code})")
