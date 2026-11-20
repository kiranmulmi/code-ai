// A workspace's notes, written by the user in the side panel's Notes tab: notes.json in the
// workspace's data folder (workspaceDataDir), as `{ "notes": [Note, …] }`.
//
// Every read-change-write runs in the file's own queue and is written atomically. A damaged
// file is an error naming it, never silently replaced (it holds the user's own text).
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NOTE_LIMITS, type Note, type NoteInput } from '@app/shared';
import { serialized, writeFileAtomic } from '@app/agent';
import { InputError } from './errors.js';
import { readJson } from './json-file.js';
import { workspaceDataDir } from './workspace-data.js';

const isNote = (value: unknown): value is Note => {
  if (!value || typeof value !== 'object') return false;
  const note = value as Record<string, unknown>;
  return (
    typeof note.id === 'string' &&
    typeof note.title === 'string' &&
    typeof note.body === 'string' &&
    typeof note.createdAt === 'string' &&
    typeof note.updatedAt === 'string'
  );
};

const newestFirst = (a: Note, b: Note) => b.updatedAt.localeCompare(a.updatedAt);

export class WorkspaceNotes {
  /** notes.json in the workspace's data folder */
  readonly file: string;

  /** `name`: the workspace's, which names its data subfolder in `folder` */
  constructor(folder: string, name: string) {
    this.file = path.join(workspaceDataDir(folder, name), 'notes.json');
  }

  /** Every note, the most recently changed first. */
  async list(): Promise<Note[]> {
    return (await this.#read()).sort(newestFirst);
  }

  async get(id: string): Promise<Note | null> {
    return (await this.#read()).find((note) => note.id === id) ?? null;
  }

  /** InputError when the workspace already has as many notes as it may. */
  async create(input: NoteInput): Promise<Note> {
    return serialized(this.file, async () => {
      const notes = await this.#read();
      if (notes.length >= NOTE_LIMITS.count) {
        throw new InputError(
          `A workspace can have at most ${NOTE_LIMITS.count} notes. Delete one first.`,
        );
      }
      const now = new Date().toISOString();
      const note: Note = {
        id: randomUUID(),
        title: input.title,
        body: input.body,
        createdAt: now,
        updatedAt: now,
      };
      await this.#write([note, ...notes]);
      return note;
    });
  }

  /** The saved note, or null when there's none with that id. */
  async update(id: string, input: NoteInput): Promise<Note | null> {
    return serialized(this.file, async () => {
      const notes = await this.#read();
      const index = notes.findIndex((note) => note.id === id);
      const current = notes[index];
      if (!current) return null;
      const note: Note = {
        ...current,
        title: input.title,
        body: input.body,
        updatedAt: new Date().toISOString(),
      };
      notes[index] = note;
      await this.#write(notes);
      return note;
    });
  }

  /** Whether there was a note with that id. */
  async remove(id: string): Promise<boolean> {
    return serialized(this.file, async () => {
      const notes = await this.#read();
      const kept = notes.filter((note) => note.id !== id);
      if (kept.length === notes.length) return false;
      await this.#write(kept);
      return true;
    });
  }

  async #read(): Promise<Note[]> {
    const raw = await readJson(this.file);
    if (raw === null) return [];
    const notes = (raw as { notes?: unknown }).notes;
    if (!Array.isArray(notes) || !notes.every(isNote)) {
      throw new Error(`${this.file} is damaged: it doesn't hold a list of notes.`);
    }
    return notes;
  }

  async #write(notes: Note[]): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await writeFileAtomic(this.file, `${JSON.stringify({ notes }, null, 2)}\n`);
  }
}
