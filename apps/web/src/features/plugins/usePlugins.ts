import { useCallback } from 'react';
import type { McpEnabled, PluginSummary } from '@app/shared';
import { useAsync, type AsyncResource } from '../../lib/useAsync';
import { fetchMcpEnabled } from '../mcp/api';
import { fetchPlugins } from './api';

export interface PluginsState {
  plugins: PluginSummary[];
  /** which MCP servers (plugins among them) this workspace has on */
  mcp: McpEnabled;
}

/** The Tools tab's list: every plugin, and which are on in this workspace. */
export function usePlugins(workspaceId: string): AsyncResource<PluginsState> {
  const load = useCallback(async () => {
    const [plugins, mcp] = await Promise.all([fetchPlugins(), fetchMcpEnabled(workspaceId)]);
    return { plugins, mcp };
  }, [workspaceId]);
  return useAsync(load);
}
