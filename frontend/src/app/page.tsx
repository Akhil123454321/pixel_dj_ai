"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useSession } from "next-auth/react";
import Header from "@/components/Header";
import VibePrompt from "@/components/VibePrompt";
import SetTimeline from "@/components/SetTimeline";
import NowPlaying from "@/components/NowPlaying";
import FeedbackBar from "@/components/FeedbackBar";
import TransitionView from "@/components/TransitionView";
import DJReasoning from "@/components/DJReasoning";
import Visualizer from "@/components/Visualizer";
import SetQueue from "@/components/SetQueue";
import { useSpotifyPlayer } from "@/context/SpotifyPlayerContext";
import { transferPlayback, playTracks, playTrack } from "@/lib/spotify";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Track {
  id: number;
  name: string;
  artist: string;
  bpm: number;
  musicalKey: string;
  duration: string;
  energy: number;
  spotifyUri: string;
}

interface TimelineEntry {
  name: string;
  energy: number;
  transitionType?: "CUT" | "SHORT_BLEND" | "LONG_BLEND";
}

interface ReasoningEntry {
  id: number;
  text: string;
  type: "info" | "decision" | "constraint";
}

interface SetSpec {
  bpmRange: string;
  arc: string;
  vocals: string;
  cuts: boolean;
}

export default function Home() {
  const { data: session } = useSession();
  const { deviceId, isReady, isPremium, playerState, error: playerError } = useSpotifyPlayer();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSetGenerated, setIsSetGenerated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transferred, setTransferred] = useState(false);
  const transferAttempted = useRef(false);
  const sessionId = useRef("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    sessionId.current = crypto.randomUUID();
    setMounted(true);
  }, []);

  // Set data from backend
  const [tracks, setTracks] = useState<Track[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [reasoning, setReasoning] = useState<ReasoningEntry[]>([]);
  const [spec, setSpec] = useState<SetSpec | null>(null);

  const currentTrack = tracks[currentIndex];
  const nextTrack = tracks[currentIndex + 1];

  // Build a URI → index map for fast lookup
  const uriToIndex = useMemo(() => {
    const map = new Map<string, number>();
    tracks.forEach((t, i) => map.set(t.spotifyUri, i));
    return map;
  }, [tracks]);

  // Sync currentIndex with Spotify playback state
  useEffect(() => {
    if (!playerState || tracks.length === 0) return;

    const currentUri = playerState.track_window?.current_track?.uri;
    if (!currentUri) return;

    const idx = uriToIndex.get(currentUri);
    if (idx !== undefined && idx !== currentIndex) {
      setCurrentIndex(idx);
    }
  }, [playerState, tracks, uriToIndex, currentIndex]);

  // Auto-transfer playback when player is ready
  useEffect(() => {
    if (
      isReady &&
      deviceId &&
      session?.accessToken &&
      !transferred &&
      !transferAttempted.current
    ) {
      transferAttempted.current = true;
      console.log("[Pixel DJ] Transferring playback to device:", deviceId);
      transferPlayback(session.accessToken, deviceId)
        .then(() => {
          console.log("[Pixel DJ] Playback transferred successfully");
          setTransferred(true);
        })
        .catch((err) => {
          console.error("[Pixel DJ] Transfer failed:", err);
          transferAttempted.current = false;
        });
    }
  }, [isReady, deviceId, session?.accessToken, transferred]);

  const handleGenerate = async (prompt: string, seeds: string[]) => {
    if (!session?.accessToken) {
      setError("Please sign in with Spotify first");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/generate-set`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ prompt, seeds, session_id: sessionId.current }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `API error ${res.status}`);
      }

      const data = await res.json();
      setTracks(data.tracks);
      setTimeline(data.timeline);
      setReasoning(data.reasoning);
      setSpec(data.spec);
      setCurrentIndex(0);
      setIsSetGenerated(true);

      // Auto-play the set if player is ready
      if (isReady && deviceId && session.accessToken && data.tracks.length > 0) {
        const uris = data.tracks.map((t: Track) => t.spotifyUri).filter(Boolean);
        if (uris.length > 0) {
          playTracks(session.accessToken, deviceId, uris).catch((err) =>
            console.error("[Pixel DJ] Auto-play failed:", err)
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate set");
      console.error("[Pixel DJ] Generate failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTrackClick = async (index: number) => {
    if (!session?.accessToken || !deviceId || !isReady) return;
    const track = tracks[index];
    if (!track?.spotifyUri) return;

    // Play the full queue starting from the clicked track
    const uris = tracks.slice(index).map((t) => t.spotifyUri).filter(Boolean);
    try {
      await playTracks(session.accessToken, deviceId, uris);
      setCurrentIndex(index);
    } catch (err) {
      console.error("[Pixel DJ] Track click play failed:", err);
    }
  };

  const handleFeedback = async (eventType: string, payload: Record<string, unknown> = {}) => {
    try {
      await fetch(`${API_BASE}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId.current,
          track_index: currentIndex,
          event_type: eventType,
          payload,
          context: {
            track: currentTrack?.name,
            bpm: currentTrack?.bpm,
            energy: currentTrack?.energy,
          },
        }),
      });
    } catch (err) {
      console.error("[Pixel DJ] Feedback failed:", err);
    }
  };

  // Memoize energy array so Visualizer doesn't get a new ref every render
  const energyValues = useMemo(() => tracks.map((t) => t.energy), [tracks]);

  return (
    <div className="min-h-screen flex flex-col max-w-5xl mx-auto">
      {/* Header */}
      <Header />

      {/* Player status bar */}
      {session?.accessToken && (
        <div className="mx-4 mt-2 pixel-panel p-3 flex flex-col gap-2 text-[7px]">
          {!isPremium ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[#bf8a4a]">FREE ACCOUNT DETECTED</span>
              </div>
              <div className="text-[var(--text-dim)] leading-relaxed">
                In-browser playback requires Spotify Premium.
                You can still generate sets, browse recommendations,
                and plan transitions. Playback will open in your
                Spotify app instead.
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-[var(--text-dim)]">PLAYER:</span>
                {isReady ? (
                  <span className="text-[#5a9b6a]">READY</span>
                ) : (
                  <span className="text-[var(--text-dim)]">CONNECTING...</span>
                )}
                {transferred && (
                  <span className="text-[#5a9b6a]">ACTIVE DEVICE</span>
                )}
                {playerError && !playerError.includes("Premium") && (
                  <span className="text-[#c4727a]">ERR: {playerError}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 p-4 flex flex-col gap-4">
        <VibePrompt onGenerate={handleGenerate} isLoading={isLoading} spec={spec} />

        {error && (
          <div className="pixel-panel p-3 text-[8px] text-[#c4727a]">
            ERROR: {error}
          </div>
        )}

        {isLoading && (
          <div className="pixel-panel p-4 text-center text-[8px] text-[var(--text-dim)]">
            GENERATING SET...
          </div>
        )}

        {isSetGenerated && !isLoading && tracks.length > 0 && (
          <>
            <SetTimeline tracks={timeline} currentIndex={currentIndex} />

            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-4">
              <div className="flex flex-col gap-4">
                {currentTrack && (
                  <NowPlaying
                    bpm={currentTrack.bpm}
                    musicalKey={currentTrack.musicalKey}
                    energy={currentTrack.energy}
                  />
                )}
                <FeedbackBar onFeedback={handleFeedback} />
              </div>

              <div className="flex flex-col gap-4">
                {currentTrack && nextTrack && (
                  <TransitionView
                    fromTrack={currentTrack.name}
                    toTrack={nextTrack.name}
                    type={timeline[currentIndex]?.transitionType || "CUT"}
                    blendBars={timeline[currentIndex]?.transitionType === "LONG_BLEND" ? 16 : timeline[currentIndex]?.transitionType === "SHORT_BLEND" ? 8 : 0}
                    exitTime="3:12"
                    exitSection="outro (stable groove)"
                    entryTime="0:24"
                    entrySection="first groove"
                    confidence={85}
                    deltaBpm={Math.round((nextTrack.bpm - currentTrack.bpm) * 10) / 10}
                    keyDistance={`${currentTrack.musicalKey} > ${nextTrack.musicalKey}`}
                    deltaEnergy={Math.round((nextTrack.energy - currentTrack.energy) * 100) / 100}
                  />
                )}
                <DJReasoning entries={reasoning} />
              </div>
            </div>

            <Visualizer energyValues={energyValues} currentIndex={currentIndex} />

            <SetQueue
              tracks={tracks}
              currentIndex={currentIndex}
              onTrackClick={handleTrackClick}
            />
          </>
        )}
      </main>

      <footer className="px-6 py-3 border-t-2 border-[var(--border)] flex justify-between text-[6px] text-[var(--text-dim)]">
        <span>PIXEL DJ v1.0</span>
        <span>44.1kHz / 16BIT</span>
        <span>SESSION: {mounted ? sessionId.current.slice(0, 8) : "--------"}</span>
      </footer>
    </div>
  );
}
