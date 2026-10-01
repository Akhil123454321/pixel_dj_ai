import { NextRequest } from "next/server";
import { z } from "zod";
import { archive, ArchiveError } from "@/lib/archive-store";
import { identity, reply, failure, sameOrigin } from "@/lib/archive-http";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await identity(); const store = await archive();
    if (!await store.role(user.id)) return reply({ pending: true, accountId: user.id, ownerConfigured: !!process.env.OWNER_SPOTIFY_ID });
    const state = await store.state(user.id, user.name);
    if (process.env.TEST_AS_PARTNER === "1" && process.env.NODE_ENV !== "production" && state.role === "owner") return reply({ ...state, role: "partner" as const });
    return reply(state);
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request); const user = await identity(); const store = await archive();
    if (Number(request.headers.get("content-length") || 0) > 1024 * 1024) throw new ArchiveError("This request is too large.", 413);
    const raw = await request.text(); if (raw.length > 1024 * 1024) throw new ArchiveError("This request is too large.", 413);
    const data = z.record(z.string(), z.unknown()).parse(JSON.parse(raw));
    const str = (key: string, max = 200) => z.string().max(max).parse(data[key]);
    const num = (key: string) => z.number().min(0).max(100).parse(data[key]);
    const rot = () => z.number().min(-15).max(15).parse(data.rotation);
    const action = str("action");
    if (action === "join") { await store.join(user.id, user.name, str("code")); return reply(await store.state(user.id, user.name)); }
    await store.member(user.id);
    switch (action) {
      case "invite": return reply({ code: await store.invite(user.id) });
      case "addBook": await store.addBook(user.id, data.book); break;
      case "removeBook": await store.removeBook(user.id, str("bookId")); break;
      case "openBook": return reply(await store.openBook(user.id, str("bookId")));
      case "addNote": await store.addNote(user.id, str("bookId"), str("body", 10000)); break;
      case "removeNote": await store.removeNote(user.id, str("noteId")); break;
      case "configureVault": await store.configureVault(user.id, str("phrase")); break;
      case "unlock": await store.unlock(user.id, user.session, str("phrase")); return reply({ items: await store.vaultItems(user.id, user.session) });
      case "vault": return reply({ items: await store.vaultItems(user.id, user.session) });
      case "lock": await store.lock(user.id, user.session); return reply({ ok: true });
      case "addEnvelope": await store.addEnvelope(user.id, str("body",20000), str("openNote",200), num("x"), num("y"), rot(), data.color ? str("color",7) : null); return reply({ items: await store.vaultItems(user.id, user.session) });
      case "addMessage": await store.addMessage(user.id, str("body",20000), num("x"), num("y"), rot(), data.color ? str("color",7) : null); return reply({ items: await store.vaultItems(user.id, user.session) });
      case "addLink": await store.addLink(user.id, str("url",2000), str("title",300), num("x"), num("y"), rot()); return reply({ items: await store.vaultItems(user.id, user.session) });
      case "moveItem": await store.moveItem(user.id, str("itemId"), num("x"), num("y")); return reply({ items: await store.vaultItems(user.id, user.session) });
      case "removeItem": await store.removeItem(user.id, str("itemId")); return reply({ items: await store.vaultItems(user.id, user.session) });
      case "saveTape": {
        await store.saveTape(user.id, data.tape, data.tapeId ? str("tapeId") : undefined, data.version === undefined ? undefined : z.number().int().parse(data.version));
        return reply(await store.state(user.id, user.name));
      }
      case "removeTape": await store.removeTape(user.id, str("tapeId")); break;
      default: throw new ArchiveError("Unknown action.");
    }
    return reply(await store.state(user.id, user.name));
  } catch (error) { return failure(error); }
}
