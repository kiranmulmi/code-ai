import { useCallback } from 'react';
import type { Note } from '@app/shared';
import { useAsync, type AsyncResource } from '../../../lib/useAsync';
import { fetchNotes } from './api';

/** The Notes tab's list. */
export function useNotes(workspaceId: string): AsyncResource<Note[]> {
  const load = useCallback(() => fetchNotes(workspaceId), [workspaceId]);
  return useAsync(load);
}
