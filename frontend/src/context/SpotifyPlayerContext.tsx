"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { useSession } from "next-auth/react";
import Script from "next/script";

interface SpotifyPlayerContextValue {
  player: Spotify.Player | null;
  deviceId: string | null;
  isReady: boolean;
  isPremium: boolean;
  playerState: Spotify.WebPlaybackState | null;
  error: string | null;
}

const SpotifyPlayerContext = createContext<SpotifyPlayerContextValue>({
  player: null,
  deviceId: null,
  isReady: false,
  isPremium: true,
  playerState: null,
  error: null,
});

export function useSpotifyPlayer() {
  return useContext(SpotifyPlayerContext);
}

export function SpotifyPlayerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session } = useSession();
  const [player, setPlayer] = useState<Spotify.Player | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [playerState, setPlayerState] =
    useState<Spotify.WebPlaybackState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPremium, setIsPremium] = useState(true);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const playerRef = useRef<Spotify.Player | null>(null);
  const initAttempted = useRef(false);

  const accessToken = session?.accessToken;

  const initializePlayer = useCallback(() => {
    if (!accessToken || !window.Spotify || initAttempted.current) return;
    initAttempted.current = true;

    console.log("[Pixel DJ] Initializing Spotify Player...");

    const newPlayer = new window.Spotify.Player({
      name: "Pixel DJ",
      getOAuthToken: (cb) => {
        cb(accessToken);
      },
      volume: 0.5,
    });

    // Error listeners
    newPlayer.addListener("initialization_error", ({ message }) => {
      console.error("[Pixel DJ] Init error:", message);
      setError(`Init: ${message}`);
    });

    newPlayer.addListener("authentication_error", ({ message }) => {
      console.error("[Pixel DJ] Auth error:", message);
      setError(`Auth: ${message}`);
    });

    newPlayer.addListener("account_error", ({ message }) => {
      console.error("[Pixel DJ] Account error:", message);
      setIsPremium(false);
      setError("Spotify Premium is required for in-browser playback");
    });

    newPlayer.addListener("playback_error", ({ message }) => {
      console.error("[Pixel DJ] Playback error:", message);
    });

    // Ready
    newPlayer.addListener("ready", ({ device_id }) => {
      console.log("[Pixel DJ] Player ready, device_id:", device_id);
      setDeviceId(device_id);
      setIsReady(true);
      setError(null);
    });

    // Not ready
    newPlayer.addListener("not_ready", ({ device_id }) => {
      console.log("[Pixel DJ] Player not ready, device_id:", device_id);
      setIsReady(false);
    });

    // State changes
    newPlayer.addListener("player_state_changed", (state) => {
      setPlayerState(state);
    });

    newPlayer.connect().then((success) => {
      if (success) {
        console.log("[Pixel DJ] Player connected successfully");
      } else {
        console.error("[Pixel DJ] Player connection failed");
        setError("Connection failed");
      }
    });

    playerRef.current = newPlayer;
    setPlayer(newPlayer);
  }, [accessToken]);

  // When SDK script loads, set flag
  const handleSdkReady = useCallback(() => {
    console.log("[Pixel DJ] SDK script loaded");
    setSdkLoaded(true);
  }, []);

  // Initialize when both SDK and token are available
  useEffect(() => {
    if (sdkLoaded && accessToken) {
      initializePlayer();
    }
  }, [sdkLoaded, accessToken, initializePlayer]);

  // Also handle the case where SDK was already loaded
  useEffect(() => {
    if (window.Spotify && accessToken) {
      setSdkLoaded(true);
    }
  }, [accessToken]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        console.log("[Pixel DJ] Disconnecting player");
        playerRef.current.disconnect();
        playerRef.current = null;
        initAttempted.current = false;
      }
    };
  }, []);

  // Reset when token disappears (sign out)
  useEffect(() => {
    if (!accessToken && playerRef.current) {
      playerRef.current.disconnect();
      playerRef.current = null;
      initAttempted.current = false;
      setPlayer(null);
      setDeviceId(null);
      setIsReady(false);
      setIsPremium(true);
      setPlayerState(null);
      setError(null);
    }
  }, [accessToken]);

  return (
    <SpotifyPlayerContext.Provider
      value={{ player, deviceId, isReady, isPremium, playerState, error }}
    >
      <Script
        src="https://sdk.scdn.co/spotify-player.js"
        onLoad={() => {
          window.onSpotifyWebPlaybackSDKReady = handleSdkReady;
          // If the callback was already fired before we set it
          if (window.Spotify) {
            handleSdkReady();
          }
        }}
      />
      {children}
    </SpotifyPlayerContext.Provider>
  );
}
