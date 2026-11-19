import { useCallback } from 'react';
import type { SpecialistList } from '@app/shared';
import { useAsync, type AsyncResource } from '../../lib/useAsync';
import { fetchAgents } from './api';

/** The Agents tab's list: the workspace's own specialists, the built-ins and broken files. */
export function useAgents(workspaceId: string): AsyncResource<SpecialistList> {
  const load = useCallback(() => fetchAgents(workspaceId), [workspaceId]);
  return useAsync(load);
}
