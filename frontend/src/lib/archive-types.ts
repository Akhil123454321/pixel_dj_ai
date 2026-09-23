export type Role = "owner" | "partner";
export type Book = { id: string; title: string; author: string; color: string; cover?: string };
export type Song = { id: string; name: string; artist: string; uri: string; image?: string; duration: number; side: "A" | "B" };
export type Tape = { id: string; title: string; color: string; dedication: string; songs: Song[]; version: number };
export type Note = { id: string; body: string; opened: boolean };
export type VaultItem = { id: string; kind: "message" | "photo" | "link" | "file" | "envelope"; body: string; created: number; x: number | null; y: number | null; rotation: number; color: string | null; url: string | null; mime: string | null };
export type ArchiveState = { role: Role; name: string; books: Book[]; tapes: Tape[]; partnerJoined: boolean; playlists: Record<string, string> };
export const palette = ["#cb705d", "#c5a157", "#79988b", "#818ba0", "#a97787", "#5e7461"];
// Public display samples only. Never seed private notes or vault content into a client bundle.
export const displayBooks: Book[] = [
  { id: "sample-1", title: "The Art of Noticing", author: "Rob Walker", color: "#cc754d" },
  { id: "sample-2", title: "Norwegian Wood", author: "Haruki Murakami", color: "#6d897b" },
  { id: "sample-3", title: "The Creative Act", author: "Rick Rubin", color: "#cdc1a9" },
  { id: "sample-4", title: "Just Kids", author: "Patti Smith", color: "#596979" },
  { id: "sample-5", title: "Normal People", author: "Sally Rooney", color: "#c5a35c" },
  { id: "sample-6", title: "All About Love", author: "bell hooks", color: "#aa6055" },
];
