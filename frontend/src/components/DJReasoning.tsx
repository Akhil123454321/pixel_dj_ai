"use client";

interface ReasoningEntry {
  id: number;
  text: string;
  type: "info" | "decision" | "constraint";
}

interface DJReasoningProps {
  entries: ReasoningEntry[];
}

export default function DJReasoning({ entries }: DJReasoningProps) {
  const typeColors = {
    info: "var(--text-dim)",
    decision: "var(--pastel-lilac)",
    constraint: "var(--pastel-peach)",
  };

  return (
    <div className="pixel-panel p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-[var(--text-dim)]">DJ REASONING</span>
        <span className="text-[6px] text-[var(--text-dim)]">LIVE</span>
      </div>

      <div className="reasoning-log max-h-[140px] overflow-y-auto bg-[var(--bg-inset)] border-2 border-[var(--border)] p-3">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="entry"
            style={{ color: typeColors[entry.type] }}
          >
            {entry.text}
          </div>
        ))}
      </div>
    </div>
  );
}
