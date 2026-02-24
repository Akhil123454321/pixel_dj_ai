"use client";

import { useState, useEffect } from "react";

interface Bar {
  id: number;
  minH: number;
  maxH: number;
  duration: number;
  delay: number;
}

interface VisualizerProps {
  energyValues?: number[];
  currentIndex?: number;
}

export default function Visualizer({ energyValues = [], currentIndex = 0 }: VisualizerProps) {
  const [bars, setBars] = useState<Bar[]>([]);

  useEffect(() => {
    if (energyValues.length === 0) {
      // Fallback: random idle bars
      setBars(
        Array.from({ length: 48 }).map((_, i) => ({
          id: i,
          minH: 3 + Math.random() * 4,
          maxH: 10 + Math.random() * 15,
          duration: 0.4 + Math.random() * 0.8,
          delay: Math.random() * 0.5,
        }))
      );
      return;
    }

    // Map energy values across the bar count (48 bars)
    const barCount = 48;
    const currentEnergy = energyValues[currentIndex] ?? 0.5;
    const nextEnergy = energyValues[Math.min(currentIndex + 1, energyValues.length - 1)] ?? currentEnergy;

    // Create bars that represent the energy profile of the whole set,
    // with the current track's zone highlighted (taller, faster)
    const barsPerTrack = Math.max(1, Math.floor(barCount / energyValues.length));

    setBars(
      Array.from({ length: barCount }).map((_, i) => {
        // Which track does this bar correspond to?
        const trackIdx = Math.min(
          Math.floor(i / barsPerTrack),
          energyValues.length - 1
        );
        const energy = energyValues[trackIdx] ?? 0.5;
        const isCurrentZone = trackIdx === currentIndex;
        const isNextZone = trackIdx === currentIndex + 1;

        // Scale bar heights by energy
        const baseMax = 8 + energy * 45;
        const baseMin = 2 + energy * 8;

        // Current zone: more active animation
        const activityBoost = isCurrentZone ? 1.4 : isNextZone ? 1.15 : 0.8;

        return {
          id: i,
          minH: baseMin * activityBoost,
          maxH: baseMax * activityBoost,
          duration: isCurrentZone
            ? 0.15 + Math.random() * 0.25 // fast pulse for current track
            : 0.4 + Math.random() * 0.8,
          delay: Math.random() * 0.3,
        };
      })
    );
  }, [energyValues, currentIndex]);

  // Determine color based on current energy
  const currentEnergy = energyValues[currentIndex] ?? 0.5;
  const colorVar =
    currentEnergy > 0.8
      ? "#d5b8ff" // peak - lilac
      : currentEnergy > 0.65
      ? "#ffb3ba" // high - pink
      : currentEnergy > 0.5
      ? "#ffd4a3" // mid-high - peach
      : currentEnergy > 0.35
      ? "#baffc9" // mid - green
      : "#bae1ff"; // low - blue

  return (
    <div className="pixel-panel p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[8px] text-[var(--text-dim)]">VISUALIZER</span>
        {energyValues.length > 0 && (
          <span className="text-[6px]" style={{ color: colorVar }}>
            ENERGY: {(currentEnergy * 100).toFixed(0)}%
          </span>
        )}
      </div>

      <div
        className="flex items-end justify-center bg-[var(--bg-inset)] border-2 border-[var(--border)] p-2 overflow-hidden"
        style={{ height: "64px" }}
      >
        {bars.map((bar) => (
          <div
            key={`${currentIndex}-${bar.id}`}
            className="viz-bar"
            style={
              {
                height: `${bar.minH}px`,
                "--min-h": `${bar.minH}px`,
                "--max-h": `${bar.maxH}px`,
                "--duration": `${bar.duration}s`,
                "--delay": `${bar.delay}s`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div className="flex justify-between mt-1 text-[5px] text-[var(--text-dim)] px-2">
        <span>20Hz</span>
        <span>100Hz</span>
        <span>1kHz</span>
        <span>5kHz</span>
        <span>10kHz</span>
        <span>20kHz</span>
      </div>
    </div>
  );
}
