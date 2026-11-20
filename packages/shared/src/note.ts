import { z } from 'zod';
import { NOTE_LIMITS } from './constants.js';

/**
 * A note the user keeps for a workspace in the side panel's Notes tab, saved as notes.json in
 * the workspace's data folder (next to its chats and memory). Only the user writes them; the
 * agent doesn't see them.
 */
export interface Note {
  /** uuid */
  id: string;
  title: string;
  /** the note itself (plain text or Markdown) */
  body: string;
  /** ISO */
  createdAt: string;
  /** ISO */
  updatedAt: string;
}

/** `POST /v1/workspaces/:id/notes` and `PUT …/notes/:noteId`. */
export const noteInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .max(NOTE_LIMITS.titleChars, `Keep the title to ${NOTE_LIMITS.titleChars} characters.`),
    body: z
      .string()
      .max(NOTE_LIMITS.bodyChars, `Keep the note to ${NOTE_LIMITS.bodyChars} characters.`),
  })
  .refine((note) => note.title !== '' || note.body.trim() !== '', {
    message: 'Write a title or some text.',
    path: ['body'],
  });

export type NoteInput = z.infer<typeof noteInputSchema>;
