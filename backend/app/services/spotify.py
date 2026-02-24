import asyncio
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

BASE = settings.spotify_api_base

# Module-level semaphore to limit concurrent Spotify API requests
_spotify_semaphore = asyncio.Semaphore(5)

PITCH_CLASSES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


def _key_name(key: int, mode: int) -> str:
    if key < 0:
        return "Unknown"
    name = PITCH_CLASSES[key]
    return name if mode == 1 else f"{name}m"


def _format_duration(ms: int) -> str:
    total_seconds = ms // 1000
    minutes = total_seconds // 60
    seconds = total_seconds % 60
    return f"{minutes}:{seconds:02d}"


# --- Genre-based feature estimation ---
# Spotify deprecated /audio-features, /recommendations, and bulk /artists
# We estimate from genre + popularity heuristics

GENRE_ESTIMATES: dict[str, dict[str, float]] = {
    "techno": {"bpm": 130, "energy": 0.8, "danceability": 0.75},
    "house": {"bpm": 124, "energy": 0.7, "danceability": 0.8},
    "deep house": {"bpm": 122, "energy": 0.6, "danceability": 0.75},
    "trance": {"bpm": 138, "energy": 0.75, "danceability": 0.7},
    "drum and bass": {"bpm": 174, "energy": 0.9, "danceability": 0.7},
    "ambient": {"bpm": 90, "energy": 0.2, "danceability": 0.2},
    "downtempo": {"bpm": 95, "energy": 0.3, "danceability": 0.4},
    "hip hop": {"bpm": 90, "energy": 0.6, "danceability": 0.75},
    "rap": {"bpm": 85, "energy": 0.65, "danceability": 0.7},
    "pop": {"bpm": 118, "energy": 0.6, "danceability": 0.7},
    "rock": {"bpm": 120, "energy": 0.7, "danceability": 0.5},
    "indie": {"bpm": 115, "energy": 0.5, "danceability": 0.5},
    "electronic": {"bpm": 126, "energy": 0.7, "danceability": 0.7},
    "edm": {"bpm": 128, "energy": 0.85, "danceability": 0.8},
    "disco": {"bpm": 120, "energy": 0.7, "danceability": 0.85},
    "funk": {"bpm": 110, "energy": 0.65, "danceability": 0.8},
    "soul": {"bpm": 100, "energy": 0.5, "danceability": 0.6},
    "r&b": {"bpm": 95, "energy": 0.5, "danceability": 0.65},
    "jazz": {"bpm": 120, "energy": 0.4, "danceability": 0.5},
    "classical": {"bpm": 100, "energy": 0.3, "danceability": 0.2},
    "metal": {"bpm": 140, "energy": 0.95, "danceability": 0.4},
    "punk": {"bpm": 160, "energy": 0.9, "danceability": 0.5},
    "reggae": {"bpm": 80, "energy": 0.5, "danceability": 0.7},
    "latin": {"bpm": 100, "energy": 0.7, "danceability": 0.8},
}

KEY_CYCLE = ["Am", "Cm", "F", "Dm", "G", "Em", "Bb", "Ab", "Eb", "Bm", "Db", "C"]


def _estimate_features_from_metadata(
    track: dict, artist_genres: list[str], index: int
) -> dict:
    popularity = track.get("popularity", 50) / 100.0

    matched: list[dict[str, float]] = []
    for genre in artist_genres:
        genre_lower = genre.lower()
        for key, vals in GENRE_ESTIMATES.items():
            if key in genre_lower:
                matched.append(vals)
                break

    if matched:
        bpm = sum(m["bpm"] for m in matched) / len(matched)
        energy = sum(m["energy"] for m in matched) / len(matched)
        danceability = sum(m["danceability"] for m in matched) / len(matched)
    else:
        bpm = 110 + popularity * 30
        energy = 0.3 + popularity * 0.5
        danceability = 0.4 + popularity * 0.4

    if track.get("duration_ms", 0) > 300000:
        energy *= 0.9

    key = KEY_CYCLE[index % len(KEY_CYCLE)]
    valence = 0.3 + popularity * 0.4

    return {
        "bpm": round(bpm + (index % 5) * 2 - 4, 1),
        "energy": round(min(max(energy, 0.1), 1.0), 2),
        "danceability": round(min(max(danceability, 0.1), 1.0), 2),
        "valence": round(min(max(valence, 0.1), 1.0), 2),
        "musicalKey": key,
    }


# --- Spotify API calls (dev mode compatible: Feb 2026) ---
# Only uses: GET /search (limit 10), GET /artists/{id}, GET /tracks/{id}


async def search_tracks(token: str, query: str, limit: int = 10) -> list[dict]:
    """Search Spotify for tracks. Dev mode max is 10 results."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{BASE}/search",
            params={"q": query, "type": "track", "limit": min(limit, 10)},
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        return resp.json().get("tracks", {}).get("items", [])


async def search_track(token: str, query: str) -> dict | None:
    results = await search_tracks(token, query, limit=1)
    return results[0] if results else None


async def get_artist_genres(token: str, artist_id: str) -> list[str]:
    """Fetch a single artist's genres. Returns empty list on failure."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{BASE}/artists/{artist_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            return resp.json().get("genres", [])
    except httpx.HTTPStatusError as e:
        logger.warning(f"Failed to fetch artist {artist_id}: {e.response.status_code}")
        return []


async def get_artist_genres_batch(token: str, artist_ids: list[str]) -> dict[str, list[str]]:
    """Fetch genres for multiple artists individually (bulk endpoint removed in dev mode)."""
    # Deduplicate
    unique_ids = list(set(artist_ids))

    async def _fetch(aid: str) -> tuple[str, list[str]]:
        async with _spotify_semaphore:
            genres = await get_artist_genres(token, aid)
            return aid, genres

    results = await asyncio.gather(*[_fetch(aid) for aid in unique_ids[:20]])
    return dict(results)


async def get_track(token: str, track_id: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{BASE}/tracks/{track_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        return resp.json()


async def discover_tracks(
    token: str,
    seed_names: list[str],
    vibe_query: str,
    limit: int = 30,
) -> list[dict]:
    """Discover tracks using search (dev mode: max 10 results per query)."""
    all_tracks: list[dict] = []
    seen_ids: set[str] = set()

    def _add(tracks: list[dict]):
        for t in tracks:
            if t["id"] not in seen_ids:
                seen_ids.add(t["id"])
                all_tracks.append(t)

    # Strategy 1: Search for each seed artist's tracks
    for seed in seed_names[:3]:
        parts = seed.split(" - ", 1)
        artist = parts[0].strip()
        _add(await search_tracks(token, f"artist:{artist}", limit=10))

    # Strategy 2: Search with vibe keywords
    if vibe_query:
        _add(await search_tracks(token, vibe_query, limit=10))

    # Strategy 3: Combine seed artist + vibe
    for seed in seed_names[:2]:
        parts = seed.split(" - ", 1)
        artist = parts[0].strip()
        combo = f"{artist} {vibe_query}" if vibe_query else artist
        _add(await search_tracks(token, combo, limit=10))

    # Strategy 4: Search for seed track names directly
    for seed in seed_names[:3]:
        _add(await search_tracks(token, seed, limit=5))

    logger.info(f"Discovered {len(all_tracks)} unique tracks")
    return all_tracks[:limit]


async def get_related_artists(token: str, artist_id: str) -> list[dict]:
    """GET /artists/{id}/related-artists — returns up to 20 related artists."""
    try:
        async with _spotify_semaphore:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{BASE}/artists/{artist_id}/related-artists",
                    headers={"Authorization": f"Bearer {token}"},
                )
                resp.raise_for_status()
                return resp.json().get("artists", [])
    except httpx.HTTPStatusError as e:
        logger.warning(f"related-artists failed for {artist_id}: {e.response.status_code}")
        return []


async def get_artist_top_tracks(token: str, artist_id: str, market: str = "US") -> list[dict]:
    """GET /artists/{id}/top-tracks — returns up to 10 top tracks."""
    try:
        async with _spotify_semaphore:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{BASE}/artists/{artist_id}/top-tracks",
                    params={"market": market},
                    headers={"Authorization": f"Bearer {token}"},
                )
                resp.raise_for_status()
                return resp.json().get("tracks", [])
    except httpx.HTTPStatusError as e:
        logger.warning(f"top-tracks failed for {artist_id}: {e.response.status_code}")
        return []


async def get_album_tracks(token: str, album_id: str, limit: int = 50) -> list[dict]:
    """GET /albums/{id}/tracks — returns album tracklist (simplified track objects)."""
    try:
        async with _spotify_semaphore:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{BASE}/albums/{album_id}/tracks",
                    params={"limit": limit},
                    headers={"Authorization": f"Bearer {token}"},
                )
                resp.raise_for_status()
                return resp.json().get("items", [])
    except httpx.HTTPStatusError as e:
        logger.warning(f"album-tracks failed for {album_id}: {e.response.status_code}")
        return []


async def get_user_top_tracks(token: str, limit: int = 50) -> list[dict]:
    """GET /me/top/tracks — user's top tracks. May 403 if scope missing."""
    try:
        async with _spotify_semaphore:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{BASE}/me/top/tracks",
                    params={"limit": min(limit, 50), "time_range": "medium_term"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                resp.raise_for_status()
                return resp.json().get("items", [])
    except httpx.HTTPStatusError as e:
        logger.warning(f"user top-tracks failed: {e.response.status_code}")
        return []


async def get_user_playlists(token: str, limit: int = 20) -> list[dict]:
    """GET /me/playlists — user's playlists. May 403 if scope missing."""
    try:
        async with _spotify_semaphore:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{BASE}/me/playlists",
                    params={"limit": min(limit, 50)},
                    headers={"Authorization": f"Bearer {token}"},
                )
                resp.raise_for_status()
                return resp.json().get("items", [])
    except httpx.HTTPStatusError as e:
        logger.warning(f"user playlists failed: {e.response.status_code}")
        return []


async def get_playlist_tracks(token: str, playlist_id: str, limit: int = 50) -> list[dict]:
    """GET /playlists/{id}/tracks — returns playlist track items."""
    try:
        async with _spotify_semaphore:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{BASE}/playlists/{playlist_id}/tracks",
                    params={"limit": min(limit, 100), "fields": "items(track(id,name,artists,album,duration_ms,popularity,uri))"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                resp.raise_for_status()
                items = resp.json().get("items", [])
                return [item["track"] for item in items if item.get("track")]
    except httpx.HTTPStatusError as e:
        logger.warning(f"playlist-tracks failed for {playlist_id}: {e.response.status_code}")
        return []


def parse_track_with_features(track: dict, features: dict, index: int) -> dict:
    artists = ", ".join(a["name"] for a in track.get("artists", []))
    return {
        "id": index,
        "spotify_id": track["id"],
        "name": track["name"],
        "artist": artists,
        "bpm": features["bpm"],
        "musicalKey": features["musicalKey"],
        "duration": _format_duration(track.get("duration_ms", 0)),
        "energy": features["energy"],
        "danceability": features["danceability"],
        "valence": features["valence"],
        "spotifyUri": track.get("uri", ""),
    }
