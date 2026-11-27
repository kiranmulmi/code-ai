import type { AgentSettings, AgentSettingsInput } from '@app/shared';
import { jsonBody, request } from '../../lib/api';

/**
 * The app-wide agent settings (`/v1/settings`): Preferences → General edits their SearXNG URL
 * and console log level, which every workspace uses. The rest are the defaults for workspaces
 * that haven't saved their own Agent settings.
 */
export const fetchGlobalSettings = () => request<AgentSettings>('/settings');

/** Replaces every app-wide setting; send the fetched ones with the changes over them. */
export const saveGlobalSettings = (input: AgentSettingsInput) =>
  request<AgentSettings>('/settings', jsonBody('PUT', input));
