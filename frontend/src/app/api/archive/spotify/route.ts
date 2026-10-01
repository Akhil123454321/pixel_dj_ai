import { NextRequest } from "next/server";
import { archive, ArchiveError } from "@/lib/archive-store";
import { identity, reply, failure, sameOrigin } from "@/lib/archive-http";
import { z } from "zod";
async function spotify(token: string | undefined, path: string, method = "GET", body?: unknown) {
  if (!token) throw new ArchiveError("Reconnect Spotify to continue.", 401);
  const response = await fetch(`https://api.spotify.com/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new ArchiveError(response.status === 429 ? "Spotify is busy. Try again shortly." : response.status === 401 ? "Your music connection expired. Sign out and reconnect Spotify." : "Spotify couldn't complete this request. Check your app permissions and Spotify developer access.", response.status === 429 ? 429 : 502);
  const text = await response.text();
  return text.trim() ? JSON.parse(text) : {};
}
export async function GET(request: NextRequest) {
  try {
    const user = await identity(); const store = await archive(); await store.member(user.id);
    const query = z.string().trim().min(1).max(200).parse(request.nextUrl.searchParams.get("q"));
    const result = await spotify(user.token, `/search?type=track&limit=10&q=${encodeURIComponent(query)}`);
    return reply({ songs: (result.tracks?.items || []).filter(Boolean).map((t: { id: string; name: string; uri: string; duration_ms: number; artists: { name: string }[]; album: { images: { url: string }[] } }) => ({ id: t.id, name: t.name, uri: t.uri, duration: t.duration_ms, artist: t.artists.map(a => a.name).join(", "), image: t.album.images[0]?.url, side: "A" })) });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request); const user = await identity(); const store = await archive(); await store.member(user.id);
    const rawBody = await request.text();
    let payload: { tapeId?: unknown } | null = null;
    try { payload = rawBody ? JSON.parse(rawBody) as { tapeId?: unknown } : null; } catch { payload = null; }
    const queryTapeId = request.nextUrl.searchParams.get("tapeId");
    let tapeId: string | undefined;
    if (typeof payload?.tapeId === "string" && payload.tapeId.trim()) {
      tapeId = payload.tapeId;
    } else if (queryTapeId) {
      tapeId = queryTapeId;
    } else {
      tapeId = (await store.state(user.id, user.name)).tapes[0]?.id;
    }
    if (!tapeId) throw new ArchiveError("Choose a mixtape before recording it to Spotify.", 400);
    await store.throttle("export:" + user.id, 15);
    const userRole = await store.role(user.id);
    if (userRole === "partner") {
      const sharedId = await store.sharedExportId(tapeId);
      if (!sharedId) throw new ArchiveError("The owner hasn't recorded this tape to Spotify yet.", 400);
      await spotify(user.token, `/playlists/${sharedId}/followers`, "PUT", { public: false });
      return reply({ url: `https://open.spotify.com/playlist/${sharedId}` });
    }
    // Owner path
    const tape = await store.getTape(user.id, tapeId); if (!tape.songs.length) throw new ArchiveError("Add a song before recording your tape.");
    let playlistId = await store.exportId(user.id, tapeId);
    if (!playlistId) { const created = await spotify(user.token, "/me/playlists", "POST", { name: tape.title, description: tape.dedication, public: false, collaborative: true }); if (!created || typeof created.id !== "string" || !created.id) throw new ArchiveError("Spotify did not return a playlist for this tape.", 502); const newPlaylistId = created.id; playlistId = newPlaylistId; await store.rememberExport(user.id, tapeId, newPlaylistId); }
    await spotify(user.token, `/playlists/${playlistId}`, "PUT", { name: tape.title, description: tape.dedication, collaborative: true });
    // Replacing the items makes retrying idempotent and preserves A → B ordering.
    await spotify(user.token, `/playlists/${playlistId}/items`, "PUT", { uris: [...tape.songs.filter(s => s.side === "A"), ...tape.songs.filter(s => s.side === "B")].map(s => s.uri) });
    return reply({ url: `https://open.spotify.com/playlist/${playlistId}` });
  } catch (error) { return failure(error); }
}
