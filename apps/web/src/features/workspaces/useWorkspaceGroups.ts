import type { WorkspaceGroup } from '@app/shared';
import { useAsync, type AsyncResource } from '../../lib/useAsync';
import { fetchWorkspaceGroups } from './api';

/** The sidebar folders, oldest first. */
export function useWorkspaceGroups(): AsyncResource<WorkspaceGroup[]> {
  return useAsync(fetchWorkspaceGroups);
}
