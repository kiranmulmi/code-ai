// The agent's settings (approvals, limits, sub-agents, ...). The app-wide ones, in
// ~/.code-ai/agent-settings.json, are the defaults; each workspace can save its own in
// .code-ai/<workspace>/agent-settings.json (Store.agentSettings), and uses the app-wide ones
// until it does.
import { serialized } from '@app/agent';
import {
  agentSettingsSchema,
  readAgentSettings,
  type AgentSettings,
  type AgentSettingsInput,
} from '@app/shared';
import { InputError } from './errors.js';
import { readJson, writePrivateJson } from './json-file.js';

export class SettingsStore {
  /**
   * `fallback`: read while this file doesn't exist yet (a workspace's settings fall back to the
   * app-wide ones). `beforeWrite`: runs before each save (creates a workspace's data folder).
   */
  constructor(
    readonly file: string,
    private readonly options: {
      fallback?: SettingsStore;
      beforeWrite?: () => Promise<void>;
    } = {},
  ) {}

  /** The saved settings (or the fallback's), with defaults for anything missing or invalid. */
  async get(): Promise<AgentSettings> {
    const raw = await readJson(this.file);
    if (raw === null && this.options.fallback) return this.options.fallback.get();
    return readAgentSettings(raw);
  }

  /** Whether this file has been saved (false: `get` reads the fallback). */
  async isSaved(): Promise<boolean> {
    return (await readJson(this.file)) !== null;
  }

  /** Replaces every setting at once. */
  async save(input: AgentSettingsInput): Promise<AgentSettings> {
    const parsed = agentSettingsSchema.safeParse(input);
    if (!parsed.success) {
      throw new InputError(parsed.error.issues[0]?.message ?? 'Check the settings.');
    }
    await this.options.beforeWrite?.();
    await serialized(this.file, () => writePrivateJson(this.file, parsed.data));
    return readAgentSettings(parsed.data);
  }
}
