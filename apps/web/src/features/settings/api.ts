import type { AgentSettings, AgentSettingsInput } from '@app/shared';
import { jsonBody, request } from '../../lib/api';

// Agent settings saved (a workspace's Agent settings, or the composer's image model): every
// reader loads again.
const EVENT = 'agent:settings-saved';

const path = (workspaceId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/agent-settings`;

/** One workspace's agent settings (the app-wide defaults until it saves its own). */
export const fetchSettings = (workspaceId: string) => request<AgentSettings>(path(workspaceId));

/** Replaces every setting of the workspace; applies from its next message on. */
export async function saveSettings(
  workspaceId: string,
  input: AgentSettingsInput,
): Promise<AgentSettings> {
  const saved = await request<AgentSettings>(path(workspaceId), jsonBody('PUT', input));
  window.dispatchEvent(new Event(EVENT));
  return saved;
}

/** Calls `onSaved` whenever agent settings are saved. Returns the unsubscribe function. */
export function onSettingsSaved(onSaved: () => void): () => void {
  window.addEventListener(EVENT, onSaved);
  return () => window.removeEventListener(EVENT, onSaved);
}
