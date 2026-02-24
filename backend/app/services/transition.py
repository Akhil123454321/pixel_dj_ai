from typing import Literal

# Camelot wheel mapping for key compatibility
# Each key maps to its Camelot code (number + letter)
CAMELOT: dict[str, str] = {
    "Ab": "4B",  "Abm": "4A",
    "A":  "11B", "Am":  "8A",
    "Bb": "6B",  "Bbm": "3A",
    "B":  "1B",  "Bm":  "10A",
    "C":  "8B",  "Cm":  "5A",
    "Db": "3B",  "Dbm": "12A",
    "D":  "10B", "Dm":  "7A",
    "Eb": "5B",  "Ebm": "2A",
    "E":  "12B", "Em":  "9A",
    "F":  "7B",  "Fm":  "4A",
    "F#": "2B",  "F#m": "11A",
    "G":  "9B",  "Gm":  "6A",
}


def camelot_distance(key_a: str, key_b: str) -> int:
    """Compute distance on the Camelot wheel. 0 = same, 1 = adjacent, etc."""
    ca = CAMELOT.get(key_a)
    cb = CAMELOT.get(key_b)
    if ca is None or cb is None:
        return 99  # unknown key

    num_a, letter_a = int(ca[:-1]), ca[-1]
    num_b, letter_b = int(cb[:-1]), cb[-1]

    # Same position
    if ca == cb:
        return 0

    # Same number, different letter (major/minor switch)
    if num_a == num_b:
        return 1

    # Same letter, adjacent numbers (mod 12)
    if letter_a == letter_b:
        diff = abs(num_a - num_b)
        circular = min(diff, 12 - diff)
        if circular <= 1:
            return circular
        return circular

    # Different letter and different number
    return abs(num_a - num_b) + 1


def keys_compatible(key_a: str, key_b: str) -> bool:
    """True if keys are compatible for mixing (Camelot distance <= 1)."""
    return camelot_distance(key_a, key_b) <= 1


def plan_transition(
    track_a: dict, track_b: dict
) -> dict:
    """Plan a transition between two tracks.

    Returns transition type, confidence score, and feature deltas.
    """
    bpm_a = track_a["bpm"]
    bpm_b = track_b["bpm"]
    delta_bpm = abs(bpm_a - bpm_b)

    key_a = track_a["musicalKey"]
    key_b = track_b["musicalKey"]
    key_compat = keys_compatible(key_a, key_b)
    key_dist = camelot_distance(key_a, key_b)

    delta_energy = round(track_b["energy"] - track_a["energy"], 2)

    # Determine transition type
    transition_type: Literal["CUT", "SHORT_BLEND", "LONG_BLEND"]
    if delta_bpm < 3:
        transition_type = "LONG_BLEND"
    elif delta_bpm <= 6 and key_compat:
        transition_type = "SHORT_BLEND"
    else:
        transition_type = "CUT"

    # Confidence score: higher when BPM is close, keys compatible, energy smooth
    confidence = 1.0
    confidence -= min(delta_bpm / 20.0, 0.4)  # BPM penalty
    if not key_compat:
        confidence -= 0.25
    confidence -= min(abs(delta_energy) / 2.0, 0.2)  # Energy gap penalty
    confidence = round(max(confidence, 0.1), 2)

    # Blend bars estimate
    blend_bars = {"LONG_BLEND": 16, "SHORT_BLEND": 8, "CUT": 0}[transition_type]

    # Key distance description
    if key_dist == 0:
        key_desc = "same key"
    elif key_dist == 1:
        key_desc = "compatible (adjacent)"
    else:
        key_desc = f"distance {key_dist}"

    return {
        "transitionType": transition_type,
        "confidence": confidence,
        "deltaBpm": round(delta_bpm, 1),
        "deltaEnergy": delta_energy,
        "keyDistance": key_desc,
        "blendBars": blend_bars,
        "exitTime": "3:12",   # placeholder — would need waveform analysis
        "exitSection": "outro",
        "entryTime": "0:24",
        "entrySection": "intro groove",
    }
