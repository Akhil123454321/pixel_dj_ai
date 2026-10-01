import { createClient, type Client, type InValue } from "@libsql/client";
import { z } from "zod";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { displayBooks } from "./archive-types";
import type { ArchiveState, Book, Note, Role, Tape, VaultItem } from "./archive-types";

export class ArchiveError extends Error { constructor(message: string, public status = 400) { super(message); } }
const text = (max: number) => z.string().trim().min(1).max(max);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const imageUrl = z.string().url().refine(v => /^https:\/\/(covers\.openlibrary\.org|i\.scdn\.co)\//.test(v));
export const bookSchema = z.object({ id: text(200), title: text(300), author: text(200), color, cover: imageUrl.optional() });
export const songSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9]{22}$/), uri: z.string().regex(/^spotify:track:[a-zA-Z0-9]{22}$/), name: text(300), artist: text(300), duration: z.number().int().min(0).max(3600000), image: imageUrl.optional(), side: z.enum(["A", "B"]) });
export const tapeSchema = z.object({ title: text(120), color, dedication: z.string().max(500), songs: z.array(songSchema).max(100) });
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function phraseHash(value: string, salt: string) { return scryptSync(value.normalize("NFKC").trim().toLowerCase(), salt, 64).toString("hex"); }

type Row = Record<string, InValue>;

export function createArchiveStore(db: Client, ownerId: () => string | undefined) {
  async function q<T = Row>(sql: string, args: InValue[] = []): Promise<T[]> {
    const result = await db.execute({ sql, args });
    return result.rows as unknown as T[];
  }
  async function q1<T = Row>(sql: string, args: InValue[] = []): Promise<T | undefined> {
    const result = await db.execute({ sql, args });
    return result.rows[0] as unknown as T | undefined;
  }
  async function run(sql: string, args: InValue[] = []) { return db.execute({ sql, args }); }

  async function init() {
    await db.executeMultiple(`
      CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, role TEXT NOT NULL UNIQUE CHECK(role='partner'), name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tapes (id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, body TEXT NOT NULL, opened INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), key_book TEXT REFERENCES books(id) ON DELETE SET NULL, salt TEXT, phrase_hash TEXT);
      INSERT OR IGNORE INTO settings (id) VALUES (1);
      CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS grants (session TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS vault (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, mime TEXT, created INTEGER NOT NULL, x REAL, y REAL, rotation REAL NOT NULL DEFAULT 0, color TEXT, url TEXT);
      CREATE TABLE IF NOT EXISTS exports (user_id TEXT, tape_id TEXT, playlist_id TEXT, PRIMARY KEY(user_id, tape_id));
    `);
    const demoIds = displayBooks.map(b => b.id);
    if (demoIds.length) await run(`DELETE FROM books WHERE id IN (${demoIds.map(() => "?").join(",")})`, demoIds);
    await run("DELETE FROM tapes WHERE id IN ('sample-t1','sample-t2','sample-t3')");
  }

  async function getRole(id: string): Promise<Role | null> {
    if (!ownerId()) return null;
    if (id === ownerId()) return "owner";
    return (await q1("SELECT id FROM members WHERE id=?", [id])) ? "partner" : null;
  }
  async function member(id: string): Promise<Role> {
    const r = await getRole(id); if (!r) throw new ArchiveError("This account hasn't been invited to this home.", 403); return r;
  }
  async function owner(id: string) { if (await member(id) !== "owner") throw new ArchiveError("Only the owner can do that.", 403); }
  async function bookById(id: string): Promise<Book> {
    const row = await q1<{ data: string }>("SELECT data FROM books WHERE id=?", [id]);
    if (!row) throw new ArchiveError("Book not found.", 404); return JSON.parse(row.data);
  }
  async function tapeById(id: string): Promise<Tape> {
    const row = await q1<{ data: string; version: InValue }>("SELECT data, version FROM tapes WHERE id=?", [id]);
    if (!row) throw new ArchiveError("Tape not found.", 404);
    return { ...JSON.parse(row.data as string), id, version: Number(row.version) };
  }
  async function getSettings() {
    return q1<{ key_book: string | null; salt: string | null; phrase_hash: string | null }>("SELECT * FROM settings WHERE id=1");
  }
  async function vaultAccess(id: string, session: string) {
    if (await member(id) === "owner") return;
    const grant = await q1<{ expires: InValue }>("SELECT expires FROM grants WHERE session=?", [hash(id + ":" + session)]);
    if (!session || !grant || Number(grant.expires) <= Date.now()) throw new ArchiveError("The room is locked. Open the key book and enter your phrase.", 403);
  }
  async function throttle(id: string, limit: number) {
    const now = Date.now();
    const row = await q1<{ count: InValue; until: InValue }>("SELECT count, until FROM attempts WHERE id=?", [id]);
    const count = row ? Number(row.count) : 0; const until = row ? Number(row.until) : 0;
    if (row && until > now && count >= limit) throw new ArchiveError("Too many attempts. Please try again in 15 minutes.", 429);
    await run("INSERT OR REPLACE INTO attempts VALUES (?, ?, ?)", [id, until > now ? count + 1 : 1, until > now ? until : now + 900000]);
  }

  return {
    init, role: getRole, member, owner, vaultAccess, throttle,
    async state(id: string, name: string): Promise<ArchiveState> {
      const r = await member(id);
      const exportRows = await q<{ tape_id: string; playlist_id: string }>("SELECT tape_id, playlist_id FROM exports");
      const playlists = Object.fromEntries(exportRows.map(row => [row.tape_id, row.playlist_id]));
      const bookRows = await q<{ data: string }>("SELECT data FROM books ORDER BY rowid");
      const books = bookRows.map(row => JSON.parse(row.data) as Book);
      const tapeRows = await q<{ id: string }>("SELECT id FROM tapes ORDER BY rowid");
      const tapes = await Promise.all(tapeRows.map(row => tapeById(row.id)));
      return { role: r, name, books, tapes, partnerJoined: !!(await q1("SELECT id FROM members")), playlists };
    },
    async invite(id: string) {
      await owner(id);
      if (await q1("SELECT id FROM members")) throw new ArchiveError("Your partner has already joined.");
      const code = randomBytes(24).toString("base64url");
      await db.batch(["DELETE FROM invites", { sql: "INSERT INTO invites VALUES (?, ?)", args: [hash(code), Date.now() + 86400000] }], "write");
      return code;
    },
    async join(id: string, name: string, code: string) {
      if (!ownerId()) throw new ArchiveError("The owner needs to finish setting up the home.", 403);
      if (await getRole(id)) return;
      await throttle("join:" + id, 10);
      const invite = await q1<{ expires: InValue }>("SELECT expires FROM invites WHERE hash=?", [hash(code)]);
      if (!invite || Number(invite.expires) < Date.now() || await q1("SELECT id FROM members")) throw new ArchiveError("That invitation has expired or already been used.", 403);
      await db.batch([{ sql: "INSERT INTO members VALUES (?, 'partner', ?)", args: [id, name] }, "DELETE FROM invites"], "write");
    },
    async addBook(id: string, input: unknown) {
      await member(id); const b = bookSchema.parse(input);
      await run("INSERT OR IGNORE INTO books VALUES (?, ?)", [b.id, JSON.stringify(b)]); return b;
    },
    async removeBook(id: string, bookId: string) {
      await member(id); await bookById(bookId);
      const settings = await getSettings();
      if (settings?.key_book === bookId) throw new ArchiveError("This book is holding a keepsake. Ask the owner to move it before removing the book.", 409);
      await run("DELETE FROM books WHERE id=?", [bookId]);
    },
    async openBook(id: string, bookId: string) {
      const r = await member(id); const b = await bookById(bookId);
      const noteRows = await q<{ id: string; body: string; opened: InValue }>("SELECT id, body, opened FROM notes WHERE book_id=? ORDER BY rowid", [bookId]);
      const notes: Note[] = noteRows.map(n => ({ id: n.id as string, body: n.body as string, opened: !!n.opened }));
      if (r === "partner") await run("UPDATE notes SET opened=1 WHERE book_id=?", [bookId]);
      const settings = await getSettings();
      return { book: b, notes, flower: settings?.key_book === bookId };
    },
    async addNote(id: string, bookId: string, body: string) {
      await owner(id); await bookById(bookId);
      await run("INSERT INTO notes (id, book_id, body) VALUES (?, ?, ?)", [randomUUID(), bookId, text(10000).parse(body)]);
    },
    async removeNote(id: string, noteId: string) { await owner(id); await run("DELETE FROM notes WHERE id=?", [noteId]); },
    async configureVault(id: string, phrase: string) {
      await owner(id); const value = text(200).min(8).parse(phrase); const salt = randomBytes(16).toString("hex");
      await db.batch([{ sql: "UPDATE settings SET key_book=NULL, salt=?, phrase_hash=? WHERE id=1", args: [salt, phraseHash(value, salt)] }, "DELETE FROM grants"], "write");
    },
    async unlock(id: string, session: string, phrase: string) {
      await member(id); await throttle("unlock:" + id, 5); const config = await getSettings();
      const value = z.string().max(200).parse(phrase);
      if (!session || !config?.salt || !config?.phrase_hash || !timingSafeEqual(Buffer.from(config.phrase_hash, "hex"), Buffer.from(phraseHash(value, config.salt), "hex"))) throw new ArchiveError("That phrase didn't open the vault.", 403);
      await run("INSERT OR REPLACE INTO grants VALUES (?, ?)", [hash(id + ":" + session), Date.now() + 900000]);
      await run("DELETE FROM attempts WHERE id=?", ["unlock:" + id]);
    },
    async lock(id: string, session: string) { await member(id); await run("DELETE FROM grants WHERE session=?", [hash(id + ":" + session)]); },
    async vaultItems(id: string, session: string): Promise<VaultItem[]> {
      await vaultAccess(id, session);
      const rows = await q("SELECT id, kind, body, created, x, y, rotation, color, url, mime FROM vault ORDER BY created ASC");
      return rows.map(row => ({
        id: row.id as string, kind: row.kind as VaultItem["kind"], body: row.body as string,
        created: Number(row.created), x: row.x != null ? Number(row.x) : null, y: row.y != null ? Number(row.y) : null,
        rotation: Number(row.rotation ?? 0), color: row.color as string | null, url: row.url as string | null, mime: row.mime as string | null,
      }));
    },
    async addEnvelope(id: string, body: string, openNote: string, x: number, y: number, rotation: number, noteColor: string | null) {
      await owner(id);
      const vb = text(20000).parse(body), von = z.string().trim().max(200).parse(openNote);
      const vx = z.number().min(0).max(100).parse(x), vy = z.number().min(0).max(100).parse(y), vr = z.number().min(-15).max(15).parse(rotation);
      const vc = noteColor ? z.string().regex(/^#[0-9a-f]{6}$/i).parse(noteColor) : null;
      await run("INSERT INTO vault (id, kind, body, created, x, y, rotation, color, url) VALUES (?, 'envelope', ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), vb, Date.now(), vx, vy, vr, vc, von]);
    },
    async addMessage(id: string, body: string, x: number, y: number, rotation: number, noteColor: string | null) {
      await owner(id);
      const vx = z.number().min(0).max(100).parse(x), vy = z.number().min(0).max(100).parse(y), vr = z.number().min(-15).max(15).parse(rotation);
      const vc = noteColor ? z.string().regex(/^#[0-9a-f]{6}$/i).parse(noteColor) : null;
      await run("INSERT INTO vault (id, kind, body, created, x, y, rotation, color) VALUES (?, 'message', ?, ?, ?, ?, ?, ?)", [randomUUID(), text(20000).parse(body), Date.now(), vx, vy, vr, vc]);
    },
    async addPhoto(id: string, caption: string, mime: string, blobUrl: string, x: number, y: number, rotation: number) {
      await owner(id);
      const vx = z.number().min(0).max(100).parse(x), vy = z.number().min(0).max(100).parse(y), vr = z.number().min(-15).max(15).parse(rotation);
      await run("INSERT INTO vault (id, kind, body, mime, created, x, y, rotation, url) VALUES (?, 'photo', ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), z.string().max(500).parse(caption), mime, Date.now(), vx, vy, vr, blobUrl]);
    },
    async photo(id: string, session: string, photoId: string) {
      await vaultAccess(id, session);
      const row = await q1<{ mime: string; url: string; body: string; kind: string }>("SELECT mime, url, body, kind FROM vault WHERE id=? AND (kind='photo' OR kind='file')", [photoId]);
      if (!row) throw new ArchiveError("File not found.", 404); return row;
    },
    async addLink(id: string, url: string, title: string, x: number, y: number, rotation: number) {
      await owner(id);
      const vu = z.string().url().max(2000).parse(url), vt = text(300).parse(title);
      const vx = z.number().min(0).max(100).parse(x), vy = z.number().min(0).max(100).parse(y), vr = z.number().min(-15).max(15).parse(rotation);
      await run("INSERT INTO vault (id, kind, body, created, x, y, rotation, url) VALUES (?, 'link', ?, ?, ?, ?, ?, ?)", [randomUUID(), vt, Date.now(), vx, vy, vr, vu]);
    },
    async addFile(id: string, caption: string, mime: string, blobUrl: string, x: number, y: number, rotation: number) {
      await owner(id);
      const allowed = ["application/pdf", "application/msword", "text/plain", "application/zip"];
      if (!allowed.includes(mime) && !mime.startsWith("image/") && !mime.startsWith("application/vnd.openxmlformats-officedocument.")) throw new ArchiveError("That file type isn't supported.");
      const vx = z.number().min(0).max(100).parse(x), vy = z.number().min(0).max(100).parse(y), vr = z.number().min(-15).max(15).parse(rotation);
      await run("INSERT INTO vault (id, kind, body, mime, created, x, y, rotation, url) VALUES (?, 'file', ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), z.string().max(500).parse(caption), mime, Date.now(), vx, vy, vr, blobUrl]);
    },
    async moveItem(id: string, itemId: string, x: number, y: number) {
      await owner(id);
      const vx = z.number().min(0).max(100).parse(x), vy = z.number().min(0).max(100).parse(y);
      await run("UPDATE vault SET x=?, y=? WHERE id=?", [vx, vy, itemId]);
    },
    async removeItem(id: string, itemId: string) { await owner(id); await run("DELETE FROM vault WHERE id=?", [itemId]); },
    async getTape(id: string, tapeId: string) { await member(id); return tapeById(tapeId); },
    async saveTape(id: string, input: unknown, tapeId?: string, version?: number) {
      await member(id); const data = tapeSchema.parse(input); const key = tapeId || randomUUID();
      if (tapeId) {
        await tapeById(tapeId);
        const result = await run("UPDATE tapes SET data=?, version=version+1 WHERE id=? AND version=?", [JSON.stringify(data), key, version ?? -1]);
        if (!result.rowsAffected) throw new ArchiveError("This tape changed on another device. Reopen it to load the latest version.", 409);
      } else { await run("INSERT INTO tapes (id, data) VALUES (?, ?)", [key, JSON.stringify(data)]); }
      return tapeById(key);
    },
    async removeTape(id: string, tapeId: string) { await member(id); await run("DELETE FROM tapes WHERE id=?", [tapeId]); },
    async exportId(id: string, tapeId: string) {
      await member(id);
      return (await q1<{ playlist_id: string }>("SELECT playlist_id FROM exports WHERE user_id=? AND tape_id=?", [id, tapeId]))?.playlist_id;
    },
    async rememberExport(id: string, tapeId: string, playlistId: string) {
      await member(id); await run("INSERT OR REPLACE INTO exports VALUES (?, ?, ?)", [id, tapeId, playlistId]);
    },
    async sharedExportId(tapeId: string) {
      return (await q1<{ playlist_id: string }>("SELECT playlist_id FROM exports WHERE tape_id=? LIMIT 1", [tapeId]))?.playlist_id;
    },
  };
}

let singletonPromise: Promise<ReturnType<typeof createArchiveStore>> | undefined;
export function archive() {
  if (!singletonPromise) {
    singletonPromise = (async () => {
      const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
      const store = createArchiveStore(db, () => process.env.OWNER_SPOTIFY_ID);
      await store.init();
      return store;
    })();
  }
  return singletonPromise;
}
