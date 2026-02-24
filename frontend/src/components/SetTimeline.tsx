"use client";

interface Track {
  name: string;
  energy: number;
  transitionType?: "CUT" | "SHORT_BLEND" | "LONG_BLEND";
}

interface SetTimelineProps {
  tracks: Track[];
  currentIndex: number;
}

const ENERGY_COLORS = [
  "#bae1ff", // low - blue
  "#c5f0e0", // low-mid - mint
  "#baffc9", // mid - green
  "#ffd4a3", // mid-high - peach
  "#ffb3ba", // high - pink
  "#d5b8ff", // peak - lilac
];

function getEnergyColor(energy: number): string {
  const idx = Math.min(
    Math.floor(energy * (ENERGY_COLORS.length - 1)),
    ENERGY_COLORS.length - 1
  );
  return ENERGY_COLORS[idx];
}

function getTransitionLabel(type?: "CUT" | "SHORT_BLEND" | "LONG_BLEND"): string {
  if (!type) return "";
  switch (type) {
    case "CUT":
      return "|";
    case "SHORT_BLEND":
      return "~";
    case "LONG_BLEND":
      return "~~";
  }
}

export default function SetTimeline({
  tracks,
  currentIndex,
}: SetTimelineProps) {
  const nextTransitionIn = "0:45";

  return (
    <div className="pixel-panel pixel-panel-blue p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-[#6a9bc4]">SET TIMELINE</span>
        <span className="text-[7px] text-[var(--text-dim)]">
          TRACK {currentIndex + 1}/{tracks.length}
        </span>
      </div>

      {/* Energy arc bars */}
      <div className="flex items-end gap-[3px] h-16 px-1">
        {tracks.map((track, i) => {
          const height = Math.max(12, track.energy * 60);
          const isCurrent = i === currentIndex;
          const isPlayed = i < currentIndex;

          return (
            <div key={i} className="flex items-end gap-[2px] flex-1">
              <div className="flex flex-col items-center flex-1 gap-1">
                <div
                  className="w-full transition-all duration-300"
                  style={{
                    height: `${height}px`,
                    background: getEnergyColor(track.energy),
                    opacity: isPlayed ? 0.35 : 1,
                    border: isCurrent
                      ? "2px solid var(--bg-dark)"
                      : "1px solid var(--border)",
                  }}
                />
              </div>
              {/* Transition marker */}
              {i < tracks.length - 1 && track.transitionType && (
                <span className="text-[6px] text-[var(--text-dim)] self-center">
                  {getTransitionLabel(track.transitionType)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Track names below bars */}
      <div className="flex gap-[3px] px-1">
        {tracks.map((track, i) => (
          <div
            key={i}
            className={`flex-1 text-[5px] text-center truncate ${
              i === currentIndex
                ? "text-[var(--text-primary)]"
                : "text-[var(--text-dim)]"
            }`}
          >
            {track.name}
          </div>
        ))}
      </div>

      {/* Status */}
      <div className="flex items-center justify-between text-[7px]">
        <span className="text-[var(--text-dim)]">
          NEXT TRANSITION IN{" "}
          <strong className="text-[#c4727a]">{nextTransitionIn}</strong>
        </span>
        <span className="text-[var(--text-dim)]">
          ENERGY:{" "}
          <strong style={{ color: getEnergyColor(tracks[currentIndex]?.energy ?? 0) }}>
            {Math.round((tracks[currentIndex]?.energy ?? 0) * 100)}%
          </strong>
        </span>
      </div>
    </div>
  );
}
