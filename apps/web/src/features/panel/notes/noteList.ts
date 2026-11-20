import type { Note } from '@app/shared';

/** The most recently changed first. */
export function sortNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The list with `saved` put in (replacing the note with its id, or added), newest first. */
export function withNote(notes: readonly Note[] | null, saved: Note): Note[] {
  return sortNotes([saved, ...(notes ?? []).filter((note) => note.id !== saved.id)]);
}

/** What a note is called in the list: its title, else its first line of text. */
export function noteLabel(note: Pick<Note, 'title' | 'body'>): string {
  const firstLine = note.body
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return note.title.trim() || firstLine || 'Untitled note';
}

/** A one-line preview of the text under the label (empty when the label already is it). */
export function notePreview(note: Pick<Note, 'title' | 'body'>): string {
  const text = note.body.replace(/\s+/g, ' ').trim();
  if (!note.title.trim()) {
    const label = noteLabel(note);
    return text.startsWith(label) ? text.slice(label.length).trim() : text;
  }
  return text;
}

/** Notes whose title or text holds `query` (case-insensitive); all of them when it's empty. */
export function filterNotes(notes: readonly Note[], query: string): Note[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...notes];
  return notes.filter(
    (note) => note.title.toLowerCase().includes(needle) || note.body.toLowerCase().includes(needle),
  );
}
