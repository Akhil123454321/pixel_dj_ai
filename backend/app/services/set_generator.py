from app.models.schemas import (
    GenerateSetResponse,
    ReasoningEntry,
    SetSpec,
    TimelineEntry,
    TrackInSet,
)
from app.services.transition import keys_compatible, plan_transition

# --- Vibe prompt parsing ---

VIBE_KEYWORDS: dict[str, dict[str, float]] = {
    "chill": {"energy": 0.3, "danceability": 0.4, "valence": 0.4},
    "mellow": {"energy": 0.25, "danceability": 0.35, "valence": 0.35},
    "downtempo": {"energy": 0.3, "danceability": 0.4, "valence": 0.3},
    "ambient": {"energy": 0.2, "danceability": 0.2, "valence": 0.3},
    "relaxed": {"energy": 0.3, "danceability": 0.3, "valence": 0.5},
    "groovy": {"energy": 0.6, "danceability": 0.7, "valence": 0.6},
    "funky": {"energy": 0.65, "danceability": 0.75, "valence": 0.7},
    "deep": {"energy": 0.5, "danceability": 0.6, "valence": 0.4},
    "melodic": {"energy": 0.5, "danceability": 0.5, "valence": 0.5},
    "high energy": {"energy": 0.85, "danceability": 0.8, "valence": 0.7},
    "banging": {"energy": 0.9, "danceability": 0.85, "valence": 0.6},
    "peak time": {"energy": 0.9, "danceability": 0.85, "valence": 0.65},
    "dark": {"energy": 0.7, "danceability": 0.6, "valence": 0.2},
    "techno": {"energy": 0.8, "danceability": 0.75, "valence": 0.3},
    "house": {"energy": 0.65, "danceability": 0.8, "valence": 0.6},
    "trance": {"energy": 0.75, "danceability": 0.7, "valence": 0.5},
}


def parse_vibe(prompt: str) -> dict[str, float]:
    prompt_lower = prompt.lower()
    targets: dict[str, list[float]] = {"energy": [], "danceability": [], "valence": []}

    for keyword, values in VIBE_KEYWORDS.items():
        if keyword in prompt_lower:
            for feat, val in values.items():
                targets[feat].append(val)

    result = {}
    for feat, vals in targets.items():
        result[feat] = sum(vals) / len(vals) if vals else 0.5

    return result


def _detect_vocals_preference(prompt: str) -> str:
    prompt_lower = prompt.lower()
    if any(w in prompt_lower for w in ["no vocals", "instrumental", "no singing"]):
        return "none"
    if any(w in prompt_lower for w in ["low vocals", "minimal vocals"]):
        return "low"
    if any(w in prompt_lower for w in ["vocal", "vocals", "singing"]):
        return "high"
    return "low"


# --- Track ordering (energy arc) ---

def _phase_targets(track_count: int) -> list[tuple[str, float]]:
    phases = []
    warmup = max(2, track_count // 5)
    cooldown = max(2, track_count // 5)
    peak_count = max(2, track_count // 4)
    build = track_count - warmup - cooldown - peak_count

    for i in range(warmup):
        e = 0.25 + (0.15 * i / max(warmup - 1, 1))
        phases.append(("warmup", e))
    for i in range(build):
        e = 0.4 + (0.4 * i / max(build - 1, 1))
        phases.append(("build", e))
    for i in range(peak_count):
        e = 0.8 + (0.15 * i / max(peak_count - 1, 1))
        phases.append(("peak", e))
    for i in range(cooldown):
        e = 0.7 - (0.35 * i / max(cooldown - 1, 1))
        phases.append(("cooldown", e))

    return phases


def _rule_based_order(
    candidates: list[dict],
    track_count: int,
    seed_tracks: list[dict] | None = None,
) -> list[dict]:
    """Order tracks into an energy arc using rule-based scoring. Seed tracks are guaranteed inclusion."""
    phases = _phase_targets(track_count)

    # Start with seed tracks guaranteed, then fill remaining from candidates
    guaranteed = list(seed_tracks or [])
    guaranteed_ids = {t["spotify_id"] for t in guaranteed}
    available = [c for c in candidates if c["spotify_id"] not in guaranteed_ids]

    # Combine: seeds first (they'll get placed by the ordering algo), then others
    pool = guaranteed + available
    ordered: list[dict] = []

    for _phase_name, target_energy in phases:
        if not pool:
            break

        best = None
        best_score = float("inf")

        for track in pool:
            energy_diff = abs(track["energy"] - target_energy)
            score = energy_diff * 2.0

            # BPM corridor constraint
            if ordered:
                bpm_diff = abs(track["bpm"] - ordered[-1]["bpm"])
                if bpm_diff > 8:
                    score += 1.0
                score += bpm_diff * 0.05

            # Key compatibility bonus
            if ordered and keys_compatible(track["musicalKey"], ordered[-1]["musicalKey"]):
                score -= 0.2

            # Slight bonus for seed tracks to ensure they land in good spots
            if track["spotify_id"] in guaranteed_ids:
                score -= 0.1

            if score < best_score:
                best_score = score
                best = track

        if best:
            pool.remove(best)
            ordered.append(best)

    return ordered


async def order_tracks(
    candidates: list[dict],
    track_count: int,
    seed_tracks: list[dict] | None = None,
) -> list[dict]:
    """Order tracks — tries ML model first, falls back to rule-based."""
    try:
        from app.services.ml_ranker import ml_order_tracks
        result = ml_order_tracks(candidates, track_count, seed_tracks)
        if result is not None:
            return result
    except Exception as e:
        import logging
        logging.getLogger(__name__).debug(f"ML ordering unavailable: {e}")

    return _rule_based_order(candidates, track_count, seed_tracks)


# --- Full pipeline ---

async def generate_set(
    candidates: list[dict],
    prompt: str,
    track_count: int = 15,
    seed_tracks: list[dict] | None = None,
) -> GenerateSetResponse:
    # 1. Order tracks (seeds guaranteed)
    ordered = await order_tracks(candidates, track_count, seed_tracks)

    # Re-index
    for i, t in enumerate(ordered):
        t["id"] = i + 1

    # 2. Plan transitions
    transitions = []
    for i in range(len(ordered) - 1):
        transitions.append(plan_transition(ordered[i], ordered[i + 1]))

    # 3. Build response models
    tracks = [
        TrackInSet(
            id=t["id"],
            name=t["name"],
            artist=t["artist"],
            bpm=t["bpm"],
            musicalKey=t["musicalKey"],
            duration=t["duration"],
            energy=t["energy"],
            spotifyUri=t["spotifyUri"],
        )
        for t in ordered
    ]

    timeline = []
    for i, t in enumerate(ordered):
        trans_type = transitions[i]["transitionType"] if i < len(transitions) else None
        timeline.append(
            TimelineEntry(name=t["name"], energy=t["energy"], transitionType=trans_type)
        )

    # 4. Generate chain-of-thought reasoning
    reasoning = _build_reasoning(ordered, transitions, prompt, seed_tracks)

    # 5. Build spec
    if ordered:
        bpms = [t["bpm"] for t in ordered]
        bpm_range = f"{int(min(bpms))}-{int(max(bpms))}"
    else:
        bpm_range = "N/A"

    has_cuts = any(t.get("transitionType") == "CUT" for t in transitions)
    vocals = _detect_vocals_preference(prompt)

    spec = SetSpec(
        bpmRange=bpm_range,
        arc="warmup > peak > cooldown",
        vocals=vocals,
        cuts=has_cuts,
    )

    return GenerateSetResponse(
        tracks=tracks,
        timeline=timeline,
        reasoning=reasoning,
        spec=spec,
    )


def _get_phase(index: int, total: int) -> str:
    ratio = index / max(total - 1, 1)
    if ratio < 0.2:
        return "warmup"
    elif ratio < 0.55:
        return "build"
    elif ratio < 0.8:
        return "peak"
    return "cooldown"


def _build_reasoning(
    ordered: list[dict],
    transitions: list[dict],
    prompt: str,
    seed_tracks: list[dict] | None = None,
) -> list[ReasoningEntry]:
    entries: list[ReasoningEntry] = []
    rid = 1
    seed_ids = {t["spotify_id"] for t in (seed_tracks or [])}

    # --- Phase 1: Prompt analysis ---
    entries.append(ReasoningEntry(
        id=rid, type="info",
        text=f'parsing prompt: "{prompt or "(empty)"}"',
    ))
    rid += 1

    vibe = parse_vibe(prompt)
    matched_keywords = [k for k in VIBE_KEYWORDS if k in (prompt or "").lower()]
    if matched_keywords:
        entries.append(ReasoningEntry(
            id=rid, type="info",
            text=f"detected vibes: {', '.join(matched_keywords)}",
        ))
        rid += 1

    entries.append(ReasoningEntry(
        id=rid, type="decision",
        text=f"target features → energy={vibe['energy']:.2f}, dance={vibe['danceability']:.2f}, valence={vibe['valence']:.2f}",
    ))
    rid += 1

    entries.append(ReasoningEntry(
        id=rid, type="info",
        text=f"energy arc: warmup → build → peak → cooldown ({len(ordered)} tracks)",
    ))
    rid += 1

    # --- Phase 2: Seed track placement ---
    if seed_ids:
        for i, t in enumerate(ordered):
            if t["spotify_id"] in seed_ids:
                phase = _get_phase(i, len(ordered))
                entries.append(ReasoningEntry(
                    id=rid, type="decision",
                    text=f'seed "{t["artist"]} - {t["name"]}" placed at #{i+1} ({phase} phase, energy={t["energy"]:.2f})',
                ))
                rid += 1

    # --- Phase 3: Track selection reasoning ---
    for i, track in enumerate(ordered):
        if track["spotify_id"] in seed_ids:
            continue  # already logged above
        phase = _get_phase(i, len(ordered))
        entries.append(ReasoningEntry(
            id=rid, type="decision",
            text=f'slot {i+1} ({phase}): "{track["name"]}" energy={track["energy"]:.2f}, BPM={track["bpm"]:.0f}, key={track["musicalKey"]}',
        ))
        rid += 1

    # --- Phase 4: Transition analysis ---
    entries.append(ReasoningEntry(
        id=rid, type="info",
        text="planning transitions between adjacent tracks...",
    ))
    rid += 1

    for i, trans in enumerate(transitions):
        a = ordered[i]
        b = ordered[i + 1]
        entries.append(ReasoningEntry(
            id=rid, type="constraint",
            text=f'{a["name"]} → {b["name"]}: {trans["transitionType"]} '
                 f'(ΔBPM={trans["deltaBpm"]:+.1f}, key {trans["keyDistance"]}, '
                 f'Δenergy={trans["deltaEnergy"]:+.2f}, conf={trans["confidence"]*100:.0f}%)',
        ))
        rid += 1

    # --- Phase 5: Summary ---
    if ordered:
        bpms = [t["bpm"] for t in ordered]
        entries.append(ReasoningEntry(
            id=rid, type="constraint",
            text=f"final BPM corridor: [{int(min(bpms))}-{int(max(bpms))}]",
        ))
        rid += 1

    if transitions:
        avg_conf = sum(t["confidence"] for t in transitions) / len(transitions)
        long_blends = sum(1 for t in transitions if t["transitionType"] == "LONG_BLEND")
        short_blends = sum(1 for t in transitions if t["transitionType"] == "SHORT_BLEND")
        cuts = sum(1 for t in transitions if t["transitionType"] == "CUT")
        entries.append(ReasoningEntry(
            id=rid, type="info",
            text=f"transition summary: {long_blends} long blends, {short_blends} short blends, {cuts} cuts",
        ))
        rid += 1
        entries.append(ReasoningEntry(
            id=rid, type="info",
            text=f"average transition confidence: {avg_conf * 100:.0f}%",
        ))
        rid += 1

    entries.append(ReasoningEntry(
        id=rid, type="info",
        text=f"set complete: {len(ordered)} tracks, ready for playback",
    ))

    return entries
