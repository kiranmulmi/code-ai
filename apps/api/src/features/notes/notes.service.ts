import type { Note, NoteInput } from '@app/shared';
import type { AppContext } from '../../context.js';
import { NotFoundError } from '../../lib/errors.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';

/** A workspace's notes, written by the user in the side panel's Notes tab. */
export function createNotesService(
  { store }: Pick<AppContext, 'store'>,
  workspaces: Pick<WorkspacesService, 'require'>,
) {
  const notesOf = async (workspaceId: string) => store.notes(await workspaces.require(workspaceId));
  const missing = () => new NotFoundError('That note no longer exists.');

  return {
    /** The most recently changed first. */
    async list(workspaceId: string): Promise<Note[]> {
      return (await notesOf(workspaceId)).list();
    },

    async get(workspaceId: string, noteId: string): Promise<Note> {
      const found = await (await notesOf(workspaceId)).get(noteId);
      if (!found) throw missing();
      return found;
    },

    async create(workspaceId: string, input: NoteInput): Promise<Note> {
      return (await notesOf(workspaceId)).create(input);
    },

    async update(workspaceId: string, noteId: string, input: NoteInput): Promise<Note> {
      const saved = await (await notesOf(workspaceId)).update(noteId, input);
      if (!saved) throw missing();
      return saved;
    },

    async remove(workspaceId: string, noteId: string): Promise<void> {
      if (!(await (await notesOf(workspaceId)).remove(noteId))) throw missing();
    },
  };
}

export type NotesService = ReturnType<typeof createNotesService>;
