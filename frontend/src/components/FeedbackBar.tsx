"use client";

import { useState } from "react";

interface FeedbackBarProps {
  onFeedback?: (eventType: string, payload?: Record<string, unknown>) => void;
}

export default function FeedbackBar({ onFeedback }: FeedbackBarProps) {
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const [activeChips, setActiveChips] = useState<string[]>([]);

  const chips = [
    { label: "MORE ENERGY", id: "energy" },
    { label: "LESS VOCALS", id: "vocals" },
    { label: "MORE LIKE THIS", id: "similar" },
    { label: "DIFFERENT VIBE", id: "different" },
  ];

  const handleVote = (v: "up" | "down") => {
    const newVote = vote === v ? null : v;
    setVote(newVote);
    if (newVote) {
      onFeedback?.(newVote === "up" ? "thumbs_up" : "thumbs_down");
    }
  };

  const toggleChip = (id: string) => {
    const isActive = activeChips.includes(id);
    setActiveChips((prev) =>
      isActive ? prev.filter((c) => c !== id) : [...prev, id]
    );
    if (!isActive) {
      onFeedback?.("chip", { chip: id });
    }
  };

  return (
    <div className="pixel-panel p-3 flex flex-col gap-3">
      <span className="text-[7px] text-[var(--text-dim)]">
        HOW WAS THIS TRANSITION?
      </span>

      {/* Thumbs */}
      <div className="flex gap-2">
        <button
          className={`pixel-btn pixel-btn-green text-[7px] ${vote === "up" ? "active" : ""}`}
          onClick={() => handleVote("up")}
        >
          GOOD
        </button>
        <button
          className={`pixel-btn pixel-btn-pink text-[7px] ${vote === "down" ? "active" : ""}`}
          onClick={() => handleVote("down")}
        >
          BAD
        </button>
      </div>

      {/* Quick adjust chips */}
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <button
            key={chip.id}
            className={`pixel-btn pixel-btn-lilac text-[6px] px-2 py-1 ${
              activeChips.includes(chip.id) ? "active" : ""
            }`}
            onClick={() => toggleChip(chip.id)}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}
