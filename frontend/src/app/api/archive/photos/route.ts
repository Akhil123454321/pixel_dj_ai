import { NextRequest, NextResponse } from "next/server";
import { archive, ArchiveError } from "@/lib/archive-store";
import { identity, reply, failure, sameOrigin } from "@/lib/archive-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const user = await identity();
    const id = request.nextUrl.searchParams.get("id") || "";
    const file = archive().photo(user.id, user.session, id);
    const headers: Record<string, string> = { "Content-Type": file.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
    if (file.kind === "file") headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(file.body)}"`;
    return new NextResponse(new Uint8Array(file.data), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request); const user = await identity(); archive().owner(user.id);
    const kind = request.nextUrl.searchParams.get("kind") || "photo";
    const sizeCap = kind === "file" ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
    const reader = request.body?.getReader(); if (!reader) throw new ArchiveError("Choose a file.");
    const chunks: Uint8Array[] = []; let total = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > sizeCap) { await reader.cancel(); throw new ArchiveError(`Use a file smaller than ${kind === "file" ? "10" : "5"} MB.`, 413); } chunks.push(value); }
    const x = parseFloat(request.nextUrl.searchParams.get("x") || "10");
    const y = parseFloat(request.nextUrl.searchParams.get("y") || "10");
    const rotation = parseFloat(request.nextUrl.searchParams.get("rotation") || "0");
    const caption = request.nextUrl.searchParams.get("caption") || "file";
    const mime = request.headers.get("content-type") || "";
    if (kind === "file") {
      archive().addFile(user.id, caption, mime, Buffer.concat(chunks), x, y, rotation);
    } else {
      archive().addPhoto(user.id, caption, mime, Buffer.concat(chunks), x, y, rotation);
    }
    return reply({ items: archive().vaultItems(user.id, user.session) });
  } catch (error) { return failure(error); }
}
