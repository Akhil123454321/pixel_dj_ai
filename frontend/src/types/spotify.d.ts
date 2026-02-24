interface Window {
  Spotify: typeof Spotify;
  onSpotifyWebPlaybackSDKReady: () => void;
}

declare namespace Spotify {
  interface PlayerInit {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }

  interface WebPlaybackTrack {
    uri: string;
    id: string;
    type: string;
    media_type: string;
    name: string;
    is_playable: boolean;
    album: {
      uri: string;
      name: string;
      images: { url: string; height: number; width: number }[];
    };
    artists: { uri: string; name: string }[];
  }

  interface WebPlaybackState {
    context: {
      uri: string | null;
      metadata: Record<string, string> | null;
    };
    disallows: Record<string, boolean>;
    paused: boolean;
    position: number;
    duration: number;
    repeat_mode: number;
    shuffle: boolean;
    track_window: {
      current_track: WebPlaybackTrack;
      previous_tracks: WebPlaybackTrack[];
      next_tracks: WebPlaybackTrack[];
    };
  }

  interface WebPlaybackError {
    message: string;
  }

  class Player {
    constructor(options: PlayerInit);
    connect(): Promise<boolean>;
    disconnect(): void;
    addListener(
      event: "ready",
      cb: (data: { device_id: string }) => void
    ): void;
    addListener(
      event: "not_ready",
      cb: (data: { device_id: string }) => void
    ): void;
    addListener(
      event: "player_state_changed",
      cb: (state: WebPlaybackState | null) => void
    ): void;
    addListener(
      event:
        | "initialization_error"
        | "authentication_error"
        | "account_error"
        | "playback_error",
      cb: (error: WebPlaybackError) => void
    ): void;
    removeListener(event: string): void;
    getCurrentState(): Promise<WebPlaybackState | null>;
    setName(name: string): Promise<void>;
    getVolume(): Promise<number>;
    setVolume(volume: number): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    togglePlay(): Promise<void>;
    seek(positionMs: number): Promise<void>;
    previousTrack(): Promise<void>;
    nextTrack(): Promise<void>;
  }
}
