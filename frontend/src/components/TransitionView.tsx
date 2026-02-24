"use client";

interface TransitionViewProps {
  fromTrack: string;
  toTrack: string;
  type: "CUT" | "SHORT_BLEND" | "LONG_BLEND";
  blendBars: number;
  exitTime: string;
  exitSection: string;
  entryTime: string;
  entrySection: string;
  confidence: number;
  deltaBpm: number;
  keyDistance: string;
  deltaEnergy: number;
}

export default function TransitionView({
  fromTrack,
  toTrack,
  type,
  blendBars,
  exitTime,
  exitSection,
  entryTime,
  entrySection,
  confidence,
  deltaBpm,
  keyDistance,
  deltaEnergy,
}: TransitionViewProps) {
  const typeLabels = {
    CUT: "CUT",
    SHORT_BLEND: "SHORT BLEND",
    LONG_BLEND: "LONG BLEND",
  };

  const typeColors = {
    CUT: "var(--pastel-pink)",
    SHORT_BLEND: "var(--pastel-peach)",
    LONG_BLEND: "var(--pastel-lilac)",
  };

  return (
    <div className="pixel-panel pixel-panel-lilac p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-[#8a6abf]">TRANSITION</span>
        <span
          className="text-[7px] px-2 py-1 border-2"
          style={{
            borderColor: typeColors[type],
            background: typeColors[type],
            color: "var(--bg-dark)",
          }}
        >
          {typeLabels[type]}
        </span>
      </div>

      {/* From -> To */}
      <div className="flex items-center gap-2 text-[8px]">
        <span className="text-[var(--text-dim)]">{fromTrack}</span>
        <span className="text-[#c4727a]">&gt;</span>
        <span className="text-[var(--text-primary)]">{toTrack}</span>
      </div>

      {/* Anchor details */}
      <div className="grid grid-cols-2 gap-2 text-[7px]">
        <div className="p-2 bg-[var(--bg-inset)] border-2 border-[var(--border)]">
          <div className="text-[6px] text-[var(--text-dim)] mb-1">
            EXIT A
          </div>
          <div>{exitTime}</div>
          <div className="text-[var(--text-dim)]">{exitSection}</div>
        </div>
        <div className="p-2 bg-[var(--bg-inset)] border-2 border-[var(--border)]">
          <div className="text-[6px] text-[var(--text-dim)] mb-1">
            ENTER B
          </div>
          <div>{entryTime}</div>
          <div className="text-[var(--text-dim)]">{entrySection}</div>
        </div>
      </div>

      {/* Blend length */}
      <div className="text-[7px] text-[var(--text-dim)]">
        BLEND: <strong className="text-[var(--text-primary)]">{blendBars} BARS</strong>
      </div>

      {/* Confidence */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[7px]">
          <span className="text-[var(--text-dim)]">CONFIDENCE</span>
          <span className="text-[#5a9b6a]">{confidence}%</span>
        </div>
        <div className="confidence-bar">
          <div
            className="confidence-fill"
            style={{ width: `${confidence}%` }}
          />
        </div>
      </div>

      {/* Feature deltas */}
      <div className="flex flex-wrap gap-3 text-[6px] text-[var(--text-dim)]">
        <span>
          dBPM:{" "}
          <strong className="text-[var(--text-primary)]">
            {deltaBpm > 0 ? "+" : ""}
            {deltaBpm}
          </strong>
        </span>
        <span>
          KEY:{" "}
          <strong className="text-[var(--text-primary)]">{keyDistance}</strong>
        </span>
        <span>
          dENERGY:{" "}
          <strong className="text-[var(--text-primary)]">
            {deltaEnergy > 0 ? "+" : ""}
            {deltaEnergy.toFixed(2)}
          </strong>
        </span>
      </div>
    </div>
  );
}
