import type { NextAuthOptions } from "next-auth";
import SpotifyProvider from "next-auth/providers/spotify";
import { randomUUID } from "node:crypto";

const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-modify-private",
  "playlist-modify-public",
].join(" ");

export const authOptions: NextAuthOptions = {
  providers: [
    SpotifyProvider({
      clientId: process.env.SPOTIFY_CLIENT_ID!,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
      authorization: {
        params: { scope: SPOTIFY_SCOPES },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // On initial sign-in, persist the Spotify tokens
      if (account) {
        const spotifyProfile = profile as { account_id?: string; id?: string } | undefined;
        token.spotifyId = spotifyProfile?.account_id || spotifyProfile?.id || account.providerAccountId;
        token.archiveSession = randomUUID();
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        return token;
      }

      // Migrate sessions created before the shared archive was added.
      if (!token.spotifyId && token.sub) token.spotifyId = token.sub;
      if (!token.archiveSession) token.archiveSession = randomUUID();

      // If token hasn't expired, return as-is
      if (token.expiresAt && Date.now() < token.expiresAt * 1000) {
        return token;
      }

      // Token expired — attempt refresh
      return await refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.error = token.error;
      // Older sessions must reauthenticate to obtain an explicit Spotify identity.
      session.user.id = token.spotifyId;
      session.archiveSession = token.archiveSession;
      return session;
    },
  },
};

async function refreshAccessToken(
  token: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refreshToken as string,
    });

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString("base64")}`,
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to refresh token");
    }

    return {
      ...token,
      accessToken: data.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
      // Spotify may return a new refresh token
      refreshToken: data.refresh_token ?? token.refreshToken,
      error: undefined,
    };
  } catch {
    return {
      ...token,
      error: "RefreshTokenError",
    };
  }
}
