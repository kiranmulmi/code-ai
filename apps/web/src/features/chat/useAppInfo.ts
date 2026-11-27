import { useCallback, useEffect } from 'react';
import type { AppInfo } from '@app/shared';
import { useAsync, type AsyncResource } from '../../lib/useAsync';
import { onSettingsSaved } from '../settings/api';
import { fetchAppInfo } from './api';

/** The app's info; with a workspace, its approval mode is that workspace's (its Agent settings). */
export function useAppInfo(workspaceId?: string): AsyncResource<AppInfo> {
  const load = useCallback(() => fetchAppInfo(workspaceId), [workspaceId]);
  const info = useAsync(load);
  const { reload } = info;
  useEffect(() => onSettingsSaved(reload), [reload]);
  return info;
}
