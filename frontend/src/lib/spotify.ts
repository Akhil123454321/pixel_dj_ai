const BASE = "https://api.spotify.com/v1";

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function transferPlayback(
  token: string,
  deviceId: string,
  play = false
) {
  const res = await fetch(`${BASE}/me/player`, {
    method: "PUT",
    headers: headers(token),
    body: JSON.stringify({ device_ids: [deviceId], play }),
  });
  // 204 = success, no content
  if (!res.ok && res.status !== 204) {
    throw new Error(`Transfer playback failed: ${res.status}`);
  }
}

export async function playTrack(
  token: string,
  deviceId: string,
  trackUri: string
) {
  const res = await fetch(`${BASE}/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
    headers: headers(token),
    body: JSON.stringify({ uris: [trackUri] }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Play track failed: ${res.status}`);
  }
}

export async function playTracks(
  token: string,
  deviceId: string,
  trackUris: string[]
) {
  const res = await fetch(`${BASE}/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
    headers: headers(token),
    body: JSON.stringify({ uris: trackUris }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Play tracks failed: ${res.status}`);
  }
}

export async function pausePlayback(token: string, deviceId: string) {
  const res = await fetch(`${BASE}/me/player/pause?device_id=${deviceId}`, {
    method: "PUT",
    headers: headers(token),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Pause failed: ${res.status}`);
  }
}

export async function skipToNext(token: string, deviceId: string) {
  const res = await fetch(`${BASE}/me/player/next?device_id=${deviceId}`, {
    method: "POST",
    headers: headers(token),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Skip failed: ${res.status}`);
  }
}

export async function queueTrack(token: string, trackUri: string) {
  const res = await fetch(
    `${BASE}/me/player/queue?uri=${encodeURIComponent(trackUri)}`,
    {
      method: "POST",
      headers: headers(token),
    }
  );
  if (!res.ok && res.status !== 204) {
    throw new Error(`Queue failed: ${res.status}`);
  }
}

export async function getPlaybackState(token: string) {
  const res = await fetch(`${BASE}/me/player`, {
    headers: headers(token),
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Get playback state failed: ${res.status}`);
  return res.json();
}
