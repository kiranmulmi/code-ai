import type { Note, NoteInput } from '@app/shared';
import { jsonBody, request } from '../../../lib/api';

const path = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/notes`;
const notePath = (workspaceId: string, noteId: string) =>
  `${path(workspaceId)}/${encodeURIComponent(noteId)}`;

/** The most recently changed first. */
export function fetchNotes(workspaceId: string): Promise<Note[]> {
  return request<Note[]>(path(workspaceId));
}

export function createNote(workspaceId: string, input: NoteInput): Promise<Note> {
  return request<Note>(path(workspaceId), jsonBody('POST', input));
}

export function updateNote(workspaceId: string, noteId: string, input: NoteInput): Promise<Note> {
  return request<Note>(notePath(workspaceId, noteId), jsonBody('PUT', input));
}

export function deleteNote(workspaceId: string, noteId: string): Promise<void> {
  return request<void>(notePath(workspaceId, noteId), { method: 'DELETE' });
}
