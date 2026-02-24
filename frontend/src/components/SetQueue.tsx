"use client";

interface QueueTrack {
  id: number;
  name: string;
  artist: string;
  bpm: number;
  musicalKey: string;
  duration: string;
  energy: number;
}

interface SetQueueProps {
  tracks: QueueTrack[];
  currentIndex: number;
  onTrackClick?: (index: number) => void;
}

export default function SetQueue({ tracks, currentIndex, onTrackClick }: SetQueueProps) {
  return (
    <div className="pixel-panel p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-[var(--text-dim)]">SET QUEUE</span>
        <span className="text-[6px] text-[var(--text-dim)]">
          {tracks.length} TRACKS
        </span>
      </div>

      {/* Column header */}
      <div className="grid grid-cols-[24px_1fr_auto_auto_auto] gap-2 px-3 py-1 text-[6px] text-[var(--text-dim)] border-b-2 border-[var(--border)]">
        <span>#</span>
        <span>TRACK / ARTIST</span>
        <span className="w-12 text-center">BPM</span>
        <span className="w-8 text-center">KEY</span>
        <span className="w-10 text-center">TIME</span>
      </div>

      {/* Tracks */}
      <div className="max-h-[200px] overflow-y-auto">
        {tracks.map((track, i) => {
          const isPlayed = i < currentIndex;
          const isCurrent = i === currentIndex;

          return (
            <div
              key={track.id}
              onClick={() => onTrackClick?.(i)}
              className={`queue-row grid grid-cols-[24px_1fr_auto_auto_auto] gap-2 items-center ${
                onTrackClick ? "cursor-pointer hover:bg-[var(--bg-inset)]" : ""
              } ${isPlayed ? "played" : ""} ${isCurrent ? "current" : ""} ${
                !isPlayed && !isCurrent ? "upcoming" : ""
              }`}
            >
              <span className="text-[7px] text-[var(--text-dim)]">
                {isPlayed ? (
                  <span className="text-[#5a9b6a]">ok</span>
                ) : isCurrent ? (
                  <span className="text-[#5a9b6a]">&gt;&gt;</span>
                ) : (
                  <span>{i + 1}</span>
                )}
              </span>

              <div className="flex flex-col gap-[2px] min-w-0">
                <span className="text-[7px] text-[var(--text-primary)] truncate">
                  {track.name}
                </span>
                <span className="text-[5px] text-[var(--text-dim)] truncate">
                  {track.artist}
                </span>
              </div>

              <span className="text-[7px] text-[#bf8a4a] w-12 text-center">
                {track.bpm}
              </span>
              <span className="text-[7px] text-[var(--text-dim)] w-8 text-center">
                {track.musicalKey}
              </span>
              <span className="text-[7px] text-[var(--text-dim)] w-10 text-center">
                {track.duration}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
