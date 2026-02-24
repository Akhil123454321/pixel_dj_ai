"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useSpotifyPlayer } from "@/context/SpotifyPlayerContext";
import { skipToNext } from "@/lib/spotify";

interface NowPlayingProps {
  bpm?: number;
  musicalKey?: string;
  energy?: number;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export default function NowPlaying({ bpm, musicalKey, energy }: NowPlayingProps) {
  const { data: session } = useSession();
  const { player, deviceId, isReady, isPremium, playerState } = useSpotifyPlayer();

  const [position, setPosition] = useState(0);
  const positionRef = useRef(0);
  const lastUpdateRef = useRef(Date.now());

  const currentTrack = playerState?.track_window?.current_track;
  const isPaused = playerState?.paused ?? true;
  const duration = playerState?.duration ?? 0;

  // Interpolate position between SDK state updates
  useEffect(() => {
    if (playerState) {
      positionRef.current = playerState.position;
      lastUpdateRef.current = Date.now();
      setPosition(playerState.position);
    }
  }, [playerState]);

  useEffect(() => {
    if (isPaused || !currentTrack) return;
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastUpdateRef.current;
      const interpolated = Math.min(
        positionRef.current + elapsed,
        duration
      );
      setPosition(interpolated);
    }, 250);
    return () => clearInterval(interval);
  }, [isPaused, currentTrack, duration]);

  const progress = duration > 0 ? (position / duration) * 100 : 0;

  const handleTogglePlay = () => {
    player?.togglePlay();
  };

  const handleSkip = async () => {
    if (session?.accessToken && deviceId) {
      await skipToNext(session.accessToken, deviceId);
    }
  };

  // Free tier — no SDK playback
  if (!isPremium) {
    return (
      <div className="pixel-panel pixel-panel-green p-4 flex flex-col gap-3">
        <span className="text-[9px] text-[#5a9b6a]">NOW PLAYING</span>
        <div className="text-[8px] text-[var(--text-dim)] leading-relaxed">
          PLAYBACK UNAVAILABLE ON FREE TIER
        </div>
        <div className="text-[6px] text-[var(--text-dim)] leading-relaxed">
          Set planning and recommendations still work.
          Tracks will open in your Spotify app.
        </div>
      </div>
    );
  }

  // No active track — show idle state
  if (!currentTrack) {
    return (
      <div className="pixel-panel pixel-panel-green p-4 flex flex-col gap-3">
        <span className="text-[9px] text-[#5a9b6a]">NOW PLAYING</span>
        <div className="text-[8px] text-[var(--text-dim)]">
          {!isReady
            ? "WAITING FOR PLAYER..."
            : "NO TRACK PLAYING"}
        </div>
        {isReady && deviceId && (
          <div className="text-[6px] text-[var(--text-dim)]">
            DEVICE: {deviceId.slice(0, 12)}...
          </div>
        )}
      </div>
    );
  }

  const albumArt = currentTrack.album.images?.[0]?.url;
  const trackName = currentTrack.name;
  const artist = currentTrack.artists.map((a) => a.name).join(", ");

  return (
    <div className="pixel-panel pixel-panel-green p-4 flex flex-col gap-3">
      <span className="text-[9px] text-[#5a9b6a]">NOW PLAYING</span>

      {/* Track info */}
      <div className="flex gap-3 items-start">
        {albumArt && (
          <img
            src={albumArt}
            alt=""
            className="w-12 h-12 border-2 border-[var(--border)]"
            style={{ imageRendering: "auto" }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-[var(--text-primary)] mb-1 truncate">
            {trackName}
          </div>
          <div className="text-[8px] text-[var(--text-dim)] truncate">
            {artist}
          </div>
        </div>
      </div>

      {/* Metadata badges */}
      <div className="flex gap-2 flex-wrap">
        {bpm && <span className="tag-pill">{bpm} BPM</span>}
        {musicalKey && <span className="tag-pill">KEY: {musicalKey}</span>}
        {energy != null && (
          <span className="tag-pill">NRG: {Math.round(energy * 100)}%</span>
        )}
      </div>

      {/* Progress */}
      <div className="flex flex-col gap-1">
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{
              width: `${progress}%`,
              background: "var(--pastel-green)",
            }}
          />
        </div>
        <div className="flex justify-between text-[7px] text-[var(--text-dim)]">
          <span>{formatMs(position)}</span>
          <span>{formatMs(duration)}</span>
        </div>
      </div>

      {/* Transport */}
      <div className="flex gap-2">
        <button
          className={`pixel-btn pixel-btn-green ${!isPaused ? "active" : ""}`}
          onClick={handleTogglePlay}
        >
          {isPaused ? "PLAY" : "PAUSE"}
        </button>
        <button
          className="pixel-btn pixel-btn-pink text-[7px]"
          onClick={handleSkip}
        >
          SKIP
        </button>
      </div>

      {/* Device info */}
      {deviceId && (
        <div className="text-[5px] text-[var(--text-dim)]">
          DEVICE: {deviceId.slice(0, 12)}...
        </div>
      )}
    </div>
  );
}
