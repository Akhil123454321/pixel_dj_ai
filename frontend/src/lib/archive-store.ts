import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
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

// One shared home, with exactly one configured owner and one invited partner.
// Keeping authorization here makes HTTP routes and direct integration tests use identical checks.
export function createArchiveStore(filename: string, ownerId: () => string | undefined) {
  if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, role TEXT NOT NULL UNIQUE CHECK(role='partner'), name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tapes (id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, body TEXT NOT NULL, opened INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), key_book TEXT REFERENCES books(id) ON DELETE SET NULL, salt TEXT, phrase_hash TEXT);
    INSERT OR IGNORE INTO settings (id) VALUES (1);
    CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS grants (session TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS vault (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, mime TEXT, data BLOB, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS exports (user_id TEXT, tape_id TEXT, playlist_id TEXT, PRIMARY KEY(user_id, tape_id));
  `);
  for (const sql of [
    "ALTER TABLE vault ADD COLUMN x REAL",
    "ALTER TABLE vault ADD COLUMN y REAL",
    "ALTER TABLE vault ADD COLUMN rotation REAL NOT NULL DEFAULT 0",
    "ALTER TABLE vault ADD COLUMN color TEXT",
    "ALTER TABLE vault ADD COLUMN url TEXT",
  ]) { try { db.exec(sql); } catch { /* column already exists */ } }
  // The shelf starts empty. Remove the original demo books and tapes from older local databases;
  // user-added entries use other IDs and are preserved.
  const demoBookIds = displayBooks.map((value) => value.id);
  if (demoBookIds.length) db.prepare(`DELETE FROM books WHERE id IN (${demoBookIds.map(() => "?").join(",")})`).run(...demoBookIds);
  db.prepare("DELETE FROM tapes WHERE id IN ('sample-t1','sample-t2','sample-t3')").run();
  function role(id: string): Role | null {
    // Never let an arbitrary first sign-in claim the owner's seat.
    if (!ownerId()) return null;
    if (id === ownerId()) return "owner";
    return db.prepare("SELECT id FROM members WHERE id=?").get(id) ? "partner" : null;
  }
  function member(id: string) { const r = role(id); if (!r) throw new ArchiveError("This account hasn't been invited to this home.", 403); return r; }
  function owner(id: string) { if (member(id) !== "owner") throw new ArchiveError("Only the owner can do that.", 403); }
  function book(id: string): Book { const row = db.prepare("SELECT data FROM books WHERE id=?").get(id) as { data: string } | undefined; if (!row) throw new ArchiveError("Book not found.", 404); return JSON.parse(row.data); }
  function tape(id: string): Tape { const row = db.prepare("SELECT data, version FROM tapes WHERE id=?").get(id) as { data: string; version: number } | undefined; if (!row) throw new ArchiveError("Tape not found.", 404); return { ...JSON.parse(row.data), id, version: row.version }; }
  function settings() { return db.prepare("SELECT * FROM settings WHERE id=1").get() as { key_book: string | null; salt: string | null; phrase_hash: string | null }; }
  function vaultAccess(id: string, session: string) {
    if (member(id) === "owner") return;
    const grant = db.prepare("SELECT expires FROM grants WHERE session=?").get(hash(id + ":" + session)) as { expires: number } | undefined;
    if (!session || !grant || grant.expires <= Date.now()) throw new ArchiveError("The room is locked. Open the key book and enter your phrase.", 403);
  }
  function throttle(id: string, limit: number) {
    const now = Date.now();
    const row = db.prepare("SELECT count, until FROM attempts WHERE id=?").get(id) as { count: number; until: number } | undefined;
    if (row && row.until > now && row.count >= limit) throw new ArchiveError("Too many attempts. Please try again in 15 minutes.", 429);
    db.prepare("INSERT OR REPLACE INTO attempts VALUES (?, ?, ?)").run(id, row && row.until > now ? row.count + 1 : 1, row && row.until > now ? row.until : now + 900000);
  }
  return {
    db, role, member, owner, vaultAccess, throttle,
    state(id: string, name: string): ArchiveState {
      const r = member(id);
      const playlists = Object.fromEntries((db.prepare("SELECT tape_id, playlist_id FROM exports").all() as { tape_id: string; playlist_id: string }[]).map(row => [row.tape_id, row.playlist_id]));
      return { role: r, name, books: (db.prepare("SELECT data FROM books ORDER BY rowid").all() as { data: string }[]).map(row => JSON.parse(row.data)), tapes: (db.prepare("SELECT id FROM tapes ORDER BY rowid").all() as { id: string }[]).map(row => tape(row.id)), partnerJoined: !!db.prepare("SELECT id FROM members").get(), playlists };
    },
    invite(id: string) { owner(id); if (db.prepare("SELECT id FROM members").get()) throw new ArchiveError("Your partner has already joined."); const code = randomBytes(24).toString("base64url"); db.transaction(() => { db.prepare("DELETE FROM invites").run(); db.prepare("INSERT INTO invites VALUES (?, ?)").run(hash(code), Date.now() + 86400000); })(); return code; },
    join(id: string, name: string, code: string) {
      if (!ownerId()) throw new ArchiveError("The owner needs to finish setting up the home.", 403);
      if (role(id)) return;
      throttle("join:" + id, 10);
      db.transaction(() => {
        const invite = db.prepare("SELECT expires FROM invites WHERE hash=?").get(hash(code)) as { expires: number } | undefined;
        if (!invite || invite.expires < Date.now() || db.prepare("SELECT id FROM members").get()) throw new ArchiveError("That invitation has expired or already been used.", 403);
        db.prepare("INSERT INTO members VALUES (?, 'partner', ?)").run(id, name);
        db.prepare("DELETE FROM invites").run();
      })();
    },
    addBook(id: string, input: unknown) { member(id); const b = bookSchema.parse(input); db.prepare("INSERT OR IGNORE INTO books VALUES (?, ?)").run(b.id, JSON.stringify(b)); return b; },
    removeBook(id: string, bookId: string) { member(id); book(bookId); if (settings().key_book === bookId) throw new ArchiveError("This book is holding a keepsake. Ask the owner to move it before removing the book.", 409); db.prepare("DELETE FROM books WHERE id=?").run(bookId); },
    openBook(id: string, bookId: string) {
      const r = member(id); const b = book(bookId);
      const notes = (db.prepare("SELECT id, body, opened FROM notes WHERE book_id=? ORDER BY rowid").all(bookId) as { id: string; body: string; opened: number }[]).map(n => ({ ...n, opened: !!n.opened })) as Note[];
      if (r === "partner") db.prepare("UPDATE notes SET opened=1 WHERE book_id=?").run(bookId);
      return { book: b, notes, flower: settings().key_book === bookId };
    },
    addNote(id: string, bookId: string, body: string) { owner(id); book(bookId); db.prepare("INSERT INTO notes (id, book_id, body) VALUES (?, ?, ?)").run(randomUUID(), bookId, text(10000).parse(body)); },
    removeNote(id: string, noteId: string) { owner(id); db.prepare("DELETE FROM notes WHERE id=?").run(noteId); },
    configureVault(id: string, phrase: string) { owner(id); const value = text(200).min(8).parse(phrase); const salt = randomBytes(16).toString("hex"); db.transaction(() => { db.prepare("UPDATE settings SET key_book=NULL, salt=?, phrase_hash=? WHERE id=1").run(salt, phraseHash(value, salt)); db.prepare("DELETE FROM grants").run(); })(); },
    unlock(id: string, session: string, phrase: string) {
      member(id); throttle("unlock:" + id, 5); const config = settings();
      const value = z.string().max(200).parse(phrase);
      if (!session || !config.salt || !config.phrase_hash || !timingSafeEqual(Buffer.from(config.phrase_hash, "hex"), Buffer.from(phraseHash(value, config.salt), "hex"))) throw new ArchiveError("That phrase didn't open the vault.", 403);
      db.prepare("INSERT OR REPLACE INTO grants VALUES (?, ?)").run(hash(id + ":" + session), Date.now() + 900000);
      db.prepare("DELETE FROM attempts WHERE id=?").run("unlock:" + id);
    },
    lock(id: string, session: string) { member(id); db.prepare("DELETE FROM grants WHERE session=?").run(hash(id + ":" + session)); },
    vaultItems(id: string, session: string): VaultItem[] { vaultAccess(id, session); return db.prepare("SELECT id, kind, body, created, x, y, rotation, color, url, mime FROM vault ORDER BY created ASC").all() as VaultItem[]; },
    addEnvelope(id: string, body: string, openNote: string, x: number, y: number, rotation: number, noteColor: string | null) {
      owner(id);
      const vb = text(20000).parse(body), von = z.string().trim().max(200).parse(openNote);
      const vx = z.number().min(0).max(100).parse(x), vy = z.number().min(0).max(100).parse(y), vr = z.number().min(-15).max(15).parse(rotation);
      const vc = noteColor ? z.string().regex(/^#[0-9a-f]{6}$/i).parse(noteColor) : null;
      db.prepare("INSERT INTO vault (id, kind, body, created, x, y, rotation, color, url) VALUES (?, 'envelope', ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), vb, Date.now(), vx, vy, vr, vc, von);
    },
    addMessage(id: string, body: string, x: number, y: number, rotation: number, noteColor: string | null) {
      owner(id);
      const vx = z.number().min(0).max(100).parse(x), vy = z.number().min(0).max(100).parse(y), vr = z.number().min(-15).max(15).parse(rotation);
      const vc = noteColor ? z.string().regex(/^#[0-9a-f]{6}$/i).parse(noteColor) : null;
      db.prepare("INSERT INTO vault (id, kind, body, created, x, y, rotation, color) VALUES (?, 'message', ?, ?, ?, ?, ?, ?)").run(randomUUID(), text(20000).parse(body), Date.now(), vx, vy, vr, vc);
    },
    addPhoto(id: string, caption: string, mime: string, data: Buffer, x: number, y: number, rotation: number) {
      owner(id); if (data.length > 5 * 1024 * 1024) throw new ArchiveError("Use a photo smaller than 5 MB.", 413);
      const valid = (mime === "image/jpeg" && data.subarray(0, 3).equals(Buffer.from([255,216,255]))) || (mime === "image/png" && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) || (mime === "image/webp" && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP");
      if (!valid) throw new ArchiveError("Please use a JPEG, PNG, or WebP image.");
      const vx = z.number().min(0).max(100).parse(x), vy = z.number().min(0).max(100).parse(y), vr = z.number().min(-15).max(15).parse(rotation);
      db.prepare("INSERT INTO vault (id, kind, body, mime, data, created, x, y, rotation) VALUES (?, 'photo', ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), z.string().max(500).parse(caption), mime, data, Date.now(), vx, vy, vr);
    },
    photo(id: string, session: string, photoId: string) { vaultAccess(id, session); const row = db.prepare("SELECT mime, data, body, kind FROM vault WHERE id=? AND (kind='photo' OR kind='file')").get(photoId) as { mime: string; data: Buffer; body: string; kind: string } | undefined; if (!row) throw new ArchiveError("File not found.", 404); return row; },
    addLink(id: string, url: string, title: string, x: number, y: number, rotation: number) {
      owner(id);
      const vu = z.string().url().max(2000).parse(url), vt = text(300).parse(title);
      const vx = z.number().min(0).max(100).parse(x), vy = z.number().min(0).max(100).parse(y), vr = z.number().min(-15).max(15).parse(rotation);
      db.prepare("INSERT INTO vault (id, kind, body, created, x, y, rotation, url) VALUES (?, 'link', ?, ?, ?, ?, ?, ?)").run(randomUUID(), vt, Date.now(), vx, vy, vr, vu);
    },
    addFile(id: string, caption: string, mime: string, data: Buffer, x: number, y: number, rotation: number) {
      owner(id); if (data.length > 10 * 1024 * 1024) throw new ArchiveError("Use a file smaller than 10 MB.", 413);
      const allowed = ["application/pdf", "application/msword", "text/plain", "application/zip"];
      if (!allowed.includes(mime) && !mime.startsWith("image/") && !mime.startsWith("application/vnd.openxmlformats-officedocument.")) throw new ArchiveError("That file type isn't supported.");
      const vx = z.number().min(0).max(100).parse(x), vy = z.number().min(0).max(100).parse(y), vr = z.number().min(-15).max(15).parse(rotation);
      db.prepare("INSERT INTO vault (id, kind, body, mime, data, created, x, y, rotation) VALUES (?, 'file', ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), z.string().max(500).parse(caption), mime, data, Date.now(), vx, vy, vr);
    },
    moveItem(id: string, itemId: string, x: number, y: number) {
      owner(id);
      const vx = z.number().min(0).max(100).parse(x), vy = z.number().min(0).max(100).parse(y);
      db.prepare("UPDATE vault SET x=?, y=? WHERE id=?").run(vx, vy, itemId);
    },
    removeItem(id: string, itemId: string) { owner(id); db.prepare("DELETE FROM vault WHERE id=?").run(itemId); },
    getTape(id: string, tapeId: string) { member(id); return tape(tapeId); },
    saveTape(id: string, input: unknown, tapeId?: string, version?: number) {
      member(id); const data = tapeSchema.parse(input); const key = tapeId || randomUUID();
      if (tapeId) { tape(tapeId); const result = db.prepare("UPDATE tapes SET data=?, version=version+1 WHERE id=? AND version=?").run(JSON.stringify(data), key, version ?? -1); if (!result.changes) throw new ArchiveError("This tape changed on another device. Reopen it to load the latest version.", 409); }
      else db.prepare("INSERT INTO tapes (id, data) VALUES (?, ?)").run(key, JSON.stringify(data));
      return tape(key);
    },
    removeTape(id: string, tapeId: string) { member(id); db.prepare("DELETE FROM tapes WHERE id=?").run(tapeId); },
    exportId(id: string, tapeId: string) { member(id); return (db.prepare("SELECT playlist_id FROM exports WHERE user_id=? AND tape_id=?").get(id, tapeId) as { playlist_id: string } | undefined)?.playlist_id; },
    rememberExport(id: string, tapeId: string, playlistId: string) { member(id); db.prepare("INSERT OR REPLACE INTO exports VALUES (?, ?, ?)").run(id, tapeId, playlistId); },
    sharedExportId(tapeId: string) { return (db.prepare("SELECT playlist_id FROM exports WHERE tape_id=? LIMIT 1").get(tapeId) as { playlist_id: string } | undefined)?.playlist_id; },
  };
}
let singleton: ReturnType<typeof createArchiveStore> | undefined;
export function archive() { return singleton ??= createArchiveStore(process.env.ARCHIVE_DB_PATH || path.join(process.cwd(), ".data", "archive.sqlite"), () => process.env.OWNER_SPOTIFY_ID); }
