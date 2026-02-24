import httpx
from fastapi import APIRouter, Header, HTTPException

from app.models.schemas import TrackFeaturesResponse
from app.services import spotify

router = APIRouter()


@router.get("/track-features/{track_id}", response_model=TrackFeaturesResponse)
async def get_track_features(
    track_id: str,
    authorization: str = Header(default=""),
):
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing Spotify token")

    try:
        track = await spotify.get_track(token, track_id)

        # Get artist genres for feature estimation
        artist_ids = [a["id"] for a in track.get("artists", [])]
        genres: list[str] = []
        if artist_ids:
            artists = await spotify.get_artists_bulk(token, artist_ids)
            for a in artists:
                genres.extend(a.get("genres", []))

        features = spotify._estimate_features_from_metadata(track, genres, 0)
        artists = ", ".join(a["name"] for a in track.get("artists", []))

        return TrackFeaturesResponse(
            id=track["id"],
            name=track["name"],
            artist=artists,
            bpm=features["bpm"],
            musicalKey=features["musicalKey"],
            energy=features["energy"],
            danceability=features["danceability"],
            valence=features["valence"],
            duration=spotify._format_duration(track.get("duration_ms", 0)),
            spotifyUri=track.get("uri", ""),
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            raise HTTPException(status_code=401, detail="Spotify token expired or invalid")
        raise HTTPException(status_code=502, detail=f"Spotify API error ({e.response.status_code})")
