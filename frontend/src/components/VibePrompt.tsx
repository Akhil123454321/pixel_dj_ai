"use client";

import { useState } from "react";

interface VibePromptProps {
  onGenerate: (prompt: string, seeds: string[]) => void;
  isLoading?: boolean;
  spec?: {
    bpmRange: string;
    arc: string;
    vocals: string;
    cuts: boolean;
  } | null;
}

export default function VibePrompt({ onGenerate, isLoading, spec }: VibePromptProps) {
  const [prompt, setPrompt] = useState("");
  const [seedInput, setSeedInput] = useState("");
  const [seeds, setSeeds] = useState<string[]>([
    "Bicep - Glue",
    "Frank Ocean - Nights",
    "LCD Soundsystem - Dance Yrself Clean",
  ]);

  const addSeed = () => {
    const trimmed = seedInput.trim();
    if (trimmed && !seeds.includes(trimmed)) {
      setSeeds([...seeds, trimmed]);
      setSeedInput("");
    }
  };

  const removeSeed = (seed: string) => {
    setSeeds(seeds.filter((s) => s !== seed));
  };

  const handleGenerate = () => {
    onGenerate(prompt, seeds);
  };

  return (
    <div className="pixel-panel pixel-panel-pink p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-[#c4727a]">VIBE PROMPT</span>
        {spec && (
          <span className="text-[6px] text-[#5a9b6a]">SET GENERATED</span>
        )}
      </div>

      <textarea
        className="pixel-input w-full p-3 text-[8px] leading-relaxed resize-none"
        rows={2}
        placeholder="describe the vibe... e.g. late-night minimal techno, slow build, peak then release"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      {/* Seed tracks */}
      <div className="flex flex-col gap-2">
        <span className="text-[7px] text-[var(--text-dim)]">SEED TRACKS</span>
        <div className="flex flex-wrap gap-2">
          {seeds.map((seed) => (
            <div key={seed} className="tag-pill">
              <span>{seed}</span>
              <button onClick={() => removeSeed(seed)}>x</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="pixel-input flex-1 px-2 py-1 text-[7px]"
            placeholder="add seed track..."
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSeed()}
          />
          <button
            className="pixel-btn pixel-btn-lilac text-[7px] px-2 py-1"
            onClick={addSeed}
          >
            +
          </button>
        </div>
      </div>

      <button
        className="pixel-btn pixel-btn-pink self-end"
        onClick={handleGenerate}
        disabled={isLoading}
      >
        {isLoading ? "GENERATING..." : "GENERATE SET"}
      </button>

      {/* Generated spec summary */}
      {spec && (
        <div className="mt-1 p-3 bg-[var(--bg-inset)] border-2 border-[var(--border)] flex flex-wrap gap-x-6 gap-y-1 text-[7px]">
          <span>
            BPM: <strong className="text-[#c4727a]">{spec.bpmRange}</strong>
          </span>
          <span>
            ARC: <strong className="text-[#8a6abf]">{spec.arc}</strong>
          </span>
          <span>
            VOCALS: <strong className="text-[#6a9bc4]">{spec.vocals}</strong>
          </span>
          <span>
            HARD CUTS:{" "}
            <strong className="text-[var(--text-dim)]">
              {spec.cuts ? "YES" : "NO"}
            </strong>
          </span>
        </div>
      )}
    </div>
  );
}
