import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { archive, ArchiveError } from "@/lib/archive-store";
import { identity, reply, failure, sameOrigin } from "@/lib/archive-http";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await identity(); const store = await archive();
    const id = request.nextUrl.searchParams.get("id") || "";
    const file = await store.photo(user.id, user.session, id);
    const response = NextResponse.redirect(file.url);
    if (file.kind === "file") response.headers.set("Content-Disposition", `attachment; filename="${encodeURIComponent(file.body)}"`);
    return response;
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request); const user = await identity(); const store = await archive();
    await store.owner(user.id);
    const kind = request.nextUrl.searchParams.get("kind") || "photo";
    const sizeCap = kind === "file" ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
    const reader = request.body?.getReader(); if (!reader) throw new ArchiveError("Choose a file.");
    const chunks: Uint8Array[] = []; let total = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > sizeCap) { await reader.cancel(); throw new ArchiveError(`Use a file smaller than ${kind === "file" ? "10" : "5"} MB.`, 413); } chunks.push(value); }
    const buffer = Buffer.concat(chunks);
    const x = parseFloat(request.nextUrl.searchParams.get("x") || "10");
    const y = parseFloat(request.nextUrl.searchParams.get("y") || "10");
    const rotation = parseFloat(request.nextUrl.searchParams.get("rotation") || "0");
    const caption = request.nextUrl.searchParams.get("caption") || "file";
    const mime = request.headers.get("content-type") || "";
    if (kind === "file") {
      const allowed = ["application/pdf", "application/msword", "text/plain", "application/zip"];
      if (!allowed.includes(mime) && !mime.startsWith("image/") && !mime.startsWith("application/vnd.openxmlformats-officedocument.")) throw new ArchiveError("That file type isn't supported.");
    } else {
      const valid = (mime === "image/jpeg" && buffer.subarray(0,3).equals(Buffer.from([255,216,255]))) || (mime === "image/png" && buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) || (mime === "image/webp" && buffer.toString("ascii",0,4) === "RIFF" && buffer.toString("ascii",8,12) === "WEBP");
      if (!valid) throw new ArchiveError("Please use a JPEG, PNG, or WebP image.");
    }
    const ext = mime.split("/")[1]?.replace("jpeg","jpg") || "bin";
    const blob = await put(`vault/${randomUUID()}.${ext}`, buffer, { access: "public", contentType: mime });
    if (kind === "file") { await store.addFile(user.id, caption, mime, blob.url, x, y, rotation); }
    else { await store.addPhoto(user.id, caption, mime, blob.url, x, y, rotation); }
    return reply({ items: await store.vaultItems(user.id, user.session) });
  } catch (error) { return failure(error); }
}
