/** Notes, persisted as "productivity.notes". The tile shows the note edited last. */
import { createPersistedStore } from "../../../core/store";
import { uid } from "../shared/env";

export interface Note {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
}

interface NotesState {
  notes: Note[];
  activeId: string | null;
}

export const useNotes = createPersistedStore<NotesState>("productivity.notes", { notes: [], activeId: null });

export const MAX_NOTE = 20_000;

export const noteActions = {
  create(text = ""): string {
    const id = uid("n");
    const now = Date.now();
    useNotes.setState((s) => ({ notes: [{ id, text, createdAt: now, updatedAt: now }, ...s.notes], activeId: id }));
    return id;
  },
  update(id: string, text: string) {
    useNotes.setState((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, text: text.slice(0, MAX_NOTE), updatedAt: Date.now() } : n)) }));
  },
  remove(id: string) {
    useNotes.setState((s) => {
      const notes = s.notes.filter((n) => n.id !== id);
      return { notes, activeId: s.activeId === id ? (sortNotes(notes)[0]?.id ?? null) : s.activeId };
    });
  },
  select(id: string) {
    useNotes.setState({ activeId: id });
  },
  togglePin(id: string) {
    useNotes.setState((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)) }));
  },
};

/** Pinned first, then most recently edited. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);
}

/** The note edited last (what the tile shows). */
export function latestNote(notes: Note[]): Note | undefined {
  return notes.reduce<Note | undefined>((best, n) => (n.text.trim() && (!best || n.updatedAt > best.updatedAt) ? n : best), undefined);
}

export function noteTitle(n: Note): string {
  const line = n.text.split("\n").find((l) => l.trim());
  return line ? line.trim().replace(/^#+\s*/, "").slice(0, 80) : "New note";
}

export function noteSnippet(n: Note): string {
  const lines = n.text.split("\n").filter((l) => l.trim());
  return lines.slice(1).join(" ").trim().slice(0, 160);
}

const H = 3600_000;
export const SAMPLE_NOTES: Note[] = [
  { id: "s1", text: "Groceries\nOat milk, eggs, basil, lemons, coffee beans", createdAt: Date.now() - 30 * H, updatedAt: Date.now() - 0.4 * H },
  { id: "s2", text: "Ideas for the landing page\nShorter hero line. Show the dock on a real desktop. FAQ about privacy.", createdAt: Date.now() - 80 * H, updatedAt: Date.now() - 26 * H },
  { id: "s3", text: "Wi-Fi at the office\nNetwork: Studio-5G", createdAt: Date.now() - 200 * H, updatedAt: Date.now() - 150 * H },
];
