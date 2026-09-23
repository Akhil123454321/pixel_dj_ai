import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { authOptions } from "./auth";
import { ArchiveError } from "./archive-store";

export async function identity() {
  const session = await getServerSession(authOptions);
  if (!session?.user.id || !session.archiveSession) throw new ArchiveError("Sign in with Spotify to enter your home.", 401);
  return { id: session.user.id, name: session.user.name || "you", session: session.archiveSession, token: session.accessToken, tokenError: session.error };
}
export function sameOrigin(request: NextRequest) {
  const incoming = request.headers.get("origin");
  if (!incoming) return;
  const configured = new URL(process.env.NEXTAUTH_URL || request.url).origin;
  const requestOrigin = new URL(request.url).origin;
  // Local development commonly alternates between localhost and 127.0.0.1.
  // Keep the check strict for every other origin.
  const localOrigins = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);
  const allowed = process.env.NODE_ENV === "development" && localOrigins.has(requestOrigin)
    ? localOrigins
    : new Set([configured, requestOrigin]);
  if (!allowed.has(incoming)) throw new ArchiveError("This request must come from your home.", 403);
}
export function reply(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store, private" } }); }
export function failure(error: unknown) {
  if (error instanceof ArchiveError) { console.warn("Archive request rejected", error.status, error.message); return reply({ error: error.message }, error.status); }
  if (error instanceof ZodError) {
    console.warn("Archive validation failed", error.issues);
    const detail = process.env.NODE_ENV === "development" ? error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ") : "Please check the supplied details.";
    return reply({ error: detail }, 400);
  }
  if (error instanceof SyntaxError) return reply({ error: process.env.NODE_ENV === "development" ? "The request body was not valid JSON." : "Please check the supplied details." }, 400);
  console.error("Archive request failed", error instanceof Error ? error.message : "Unknown error");
  return reply({ error: "Something went wrong saving your memory. Please try again." }, 500);
}
