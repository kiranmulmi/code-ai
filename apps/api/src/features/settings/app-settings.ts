import type { AgentConfig } from '@app/agent';
import type { Store } from '@app/db';
import type { AgentSettings, AgentSettingsInput, Workspace } from '@app/shared';

type WorkspaceRef = Pick<Workspace, 'path' | 'name'>;

/**
 * The agent's settings. Each workspace has its own (`forWorkspace`), saved in its data folder;
 * one that hasn't saved any uses the app-wide ones (`current`, kept in memory so the logger and
 * quick chat read them without a file read). The SearXNG URL and console log level are only
 * app-wide (Preferences → General). A save applies from the next message on.
 */
export class AppSettings {
  readonly #store: Store;
  #current: AgentSettings;

  private constructor(store: Store, current: AgentSettings) {
    this.#store = store;
    this.#current = current;
  }

  static async load(store: Store): Promise<AppSettings> {
    return new AppSettings(store, await store.settings.get());
  }

  /** The app-wide settings: quick chat, the logger, and workspaces without their own. */
  get current(): AgentSettings {
    return this.#current;
  }

  async save(input: AgentSettingsInput): Promise<AgentSettings> {
    this.#current = await this.#store.settings.save(input);
    return this.#current;
  }

  /** The app-wide settings a workspace can't change (Preferences → General) over its own. */
  #withGlobal(settings: AgentSettings): AgentSettings {
    return {
      ...settings,
      searxngUrl: this.#current.searxngUrl,
      logLevel: this.#current.logLevel,
    };
  }

  /**
   * One workspace's settings (the app-wide ones until it saves its own). The SearXNG URL and
   * the console log level are always the app-wide ones.
   */
  async forWorkspace(workspace: WorkspaceRef): Promise<AgentSettings> {
    return this.#withGlobal(await this.#store.agentSettings(workspace).get());
  }

  /** Saves one workspace's settings; its SearXNG URL and log level are ignored (app-wide). */
  async saveForWorkspace(
    workspace: WorkspaceRef,
    input: AgentSettingsInput,
  ): Promise<AgentSettings> {
    return this.#withGlobal(await this.#store.agentSettings(workspace).save(input));
  }

  /** The config for one run: the env part (log folder) with the given (or app-wide) settings. */
  configFor(base: AgentConfig, settings: AgentSettings = this.#current): AgentConfig {
    return { ...base, ...settings };
  }
}
