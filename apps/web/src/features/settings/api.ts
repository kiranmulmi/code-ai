import type { AgentSettings, AgentSettingsInput } from '@app/shared';
import { jsonBody, request } from '../../lib/api';

// Settings saved (Settings → Agent, or the composer's image model): every reader loads again.
const EVENT = 'agent:settings-saved';

export const fetchSettings = () => request<AgentSettings>('/settings');

/** Replaces every setting; applies from the next message on. */
export async function saveSettings(input: AgentSettingsInput): Promise<AgentSettings> {
  const saved = await request<AgentSettings>('/settings', jsonBody('PUT', input));
  window.dispatchEvent(new Event(EVENT));
  return saved;
}

/** Calls `onSaved` whenever the agent settings are saved. Returns the unsubscribe function. */
export function onSettingsSaved(onSaved: () => void): () => void {
  window.addEventListener(EVENT, onSaved);
  return () => window.removeEventListener(EVENT, onSaved);
}
