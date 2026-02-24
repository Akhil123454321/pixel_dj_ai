"""Expanded track discovery — combines search, related artists, albums, and user library."""

import asyncio
import logging

from app.services import spotify

logger = logging.getLogger(__name__)

DISCOVERY_TIMEOUT = 8  # seconds


async def discover_tracks_expanded(
    token: str,
    seed_names: list[str],
    seed_tracks_raw: list[dict],
    vibe_query: str,
    limit: int = 60,
) -> list[dict]:
    """Orchestrate multiple discovery strategies concurrently.

    Returns deduplicated list of raw Spotify track objects.
    """
    all_tracks: list[dict] = []
    seen_ids: set[str] = set()

    def _add(tracks: list[dict]):
        for t in tracks:
            tid = t.get("id")
            if tid and tid not in seen_ids:
                seen_ids.add(tid)
                all_tracks.append(t)

    # Extract artist IDs and album IDs from seed tracks
    seed_artist_ids: list[str] = []
    seed_album_ids: list[str] = []
    for t in seed_tracks_raw:
        for a in t.get("artists", []):
            if a.get("id"):
                seed_artist_ids.append(a["id"])
        album = t.get("album", {})
        if album.get("id"):
            seed_album_ids.append(album["id"])

    # Deduplicate
    seed_artist_ids = list(dict.fromkeys(seed_artist_ids))
    seed_album_ids = list(dict.fromkeys(seed_album_ids))

    # Run all strategies concurrently with timeout
    try:
        results = await asyncio.wait_for(
            asyncio.gather(
                _discover_via_search(token, seed_names, vibe_query),
                _discover_via_related_artists(token, seed_artist_ids),
                _discover_via_albums(token, seed_album_ids),
                _discover_via_user_library(token),
                return_exceptions=True,
            ),
            timeout=DISCOVERY_TIMEOUT,
        )

        for i, result in enumerate(results):
            strategy_names = ["search", "related-artists", "albums", "user-library"]
            if isinstance(result, Exception):
                logger.warning(f"Discovery strategy '{strategy_names[i]}' failed: {result}")
            else:
                count_before = len(all_tracks)
                _add(result)
                added = len(all_tracks) - count_before
                logger.info(f"Discovery '{strategy_names[i]}': {len(result)} raw, {added} new unique")

    except asyncio.TimeoutError:
        logger.warning(f"Discovery timed out after {DISCOVERY_TIMEOUT}s, using {len(all_tracks)} tracks collected so far")

    logger.info(f"Total discovered: {len(all_tracks)} unique tracks")
    return all_tracks[:limit * 3]  # return generous pool, let caller trim


async def _discover_via_search(
    token: str,
    seed_names: list[str],
    vibe_query: str,
) -> list[dict]:
    """Original search-based discovery (strategies 1-4 from spotify.discover_tracks)."""
    return await spotify.discover_tracks(token, seed_names, vibe_query, limit=200)


async def _discover_via_related_artists(
    token: str,
    seed_artist_ids: list[str],
) -> list[dict]:
    """Seed artist → related artists → top tracks pipeline."""
    if not seed_artist_ids:
        return []

    tracks: list[dict] = []

    # Get related artists for up to 3 seed artists
    related_tasks = [
        spotify.get_related_artists(token, aid)
        for aid in seed_artist_ids[:3]
    ]
    related_results = await asyncio.gather(*related_tasks, return_exceptions=True)

    # Collect unique related artist IDs (pick top 3 from each seed's related)
    related_artist_ids: list[str] = []
    seen: set[str] = set(seed_artist_ids)
    for result in related_results:
        if isinstance(result, Exception):
            continue
        for artist in result[:3]:
            aid = artist.get("id")
            if aid and aid not in seen:
                seen.add(aid)
                related_artist_ids.append(aid)

    if not related_artist_ids:
        return []

    # Get top tracks for each related artist
    top_tasks = [
        spotify.get_artist_top_tracks(token, aid)
        for aid in related_artist_ids[:9]  # cap at 9 to limit API calls
    ]
    top_results = await asyncio.gather(*top_tasks, return_exceptions=True)

    for result in top_results:
        if isinstance(result, Exception):
            continue
        tracks.extend(result)

    logger.info(f"Related-artists pipeline: {len(related_artist_ids)} artists → {len(tracks)} tracks")
    return tracks


async def _discover_via_albums(
    token: str,
    album_ids: list[str],
) -> list[dict]:
    """Get other tracks from the same albums as seed tracks."""
    if not album_ids:
        return []

    tracks: list[dict] = []
    album_tasks = [
        spotify.get_album_tracks(token, aid)
        for aid in album_ids[:5]
    ]
    results = await asyncio.gather(*album_tasks, return_exceptions=True)

    for result in results:
        if isinstance(result, Exception):
            continue
        tracks.extend(result)

    return tracks


async def _discover_via_user_library(
    token: str,
    limit: int = 50,
) -> list[dict]:
    """Mine user's top tracks and playlist tracks. Graceful on 403."""
    tracks: list[dict] = []

    # Get user's top tracks
    top_tracks, playlists = await asyncio.gather(
        spotify.get_user_top_tracks(token, limit=limit),
        spotify.get_user_playlists(token, limit=5),
        return_exceptions=True,
    )

    if not isinstance(top_tracks, Exception):
        tracks.extend(top_tracks)

    # Get tracks from user's top playlists
    if not isinstance(playlists, Exception) and playlists:
        playlist_tasks = [
            spotify.get_playlist_tracks(token, p["id"], limit=30)
            for p in playlists[:3]
            if p.get("id")
        ]
        if playlist_tasks:
            playlist_results = await asyncio.gather(*playlist_tasks, return_exceptions=True)
            for result in playlist_results:
                if not isinstance(result, Exception):
                    tracks.extend(result)

    return tracks
