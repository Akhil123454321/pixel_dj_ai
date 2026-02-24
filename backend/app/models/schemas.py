from typing import Any, Literal, Optional

from pydantic import BaseModel


# --- Request models ---


class GenerateSetRequest(BaseModel):
    prompt: str
    seeds: list[str]
    track_count: int = 15
    session_id: Optional[str] = None


class FeedbackRequest(BaseModel):
    session_id: str
    track_index: int
    event_type: str
    payload: dict[str, Any] = {}
    context: dict[str, Any] = {}


# --- Response models (matching frontend data shapes) ---


class TrackInSet(BaseModel):
    id: int
    name: str
    artist: str
    bpm: float
    musicalKey: str
    duration: str  # "M:SS" format
    energy: float  # 0.0-1.0
    spotifyUri: str


class TimelineEntry(BaseModel):
    name: str
    energy: float
    transitionType: Optional[Literal["CUT", "SHORT_BLEND", "LONG_BLEND"]] = None


class ReasoningEntry(BaseModel):
    id: int
    text: str
    type: Literal["info", "decision", "constraint"]


class SetSpec(BaseModel):
    bpmRange: str
    arc: str
    vocals: str
    cuts: bool


class GenerateSetResponse(BaseModel):
    tracks: list[TrackInSet]
    timeline: list[TimelineEntry]
    reasoning: list[ReasoningEntry]
    spec: SetSpec
    session_id: str = ""


class TrackFeaturesResponse(BaseModel):
    id: str
    name: str
    artist: str
    bpm: float
    musicalKey: str
    energy: float
    danceability: float
    valence: float
    duration: str
    spotifyUri: str
