// Which of the app's MCP servers one workspace uses and has turned on:
// <folder>/.hamro-ai/<workspace>/mcp.json, `{ "allowed": ["Github", "JIRA"], "enabled": ["Github"] }`.
// `allowed` is chosen in the workspace settings; `enabled` (always among them) is switched
// in the MCP tab. The file comes with the folder (a cloned project could
// carry one), so it only takes effect once approved in the app (McpTrust); changes made in
// the app keep an approved file approved.
import { serialized } from '@app/agent';
import type { McpServerConfig, McpServerEntry, McpWorkspaceConfig } from '@app/shared';
import type { McpTrust } from './mcp-trust.js';
import type { WorkspaceData } from './workspace-data.js';

export interface McpState {
  /** where the workspace's choices are saved */
  file: string;
  /** the servers this workspace uses, by name (listed in its MCP tab) */
  allowed: string[];
  /** the allowed servers turned on here, by name */
  enabled: string[];
  /** false when the file changed outside the app since it was last approved */
  isTrusted: boolean;
}

export class WorkspaceMcp {
  constructor(
    private readonly data: WorkspaceData,
    private readonly trust: McpTrust,
  ) {}

  get file(): string {
    return this.data.mcpFile;
  }

  async read(): Promise<McpState> {
    const config = await this.data.readMcpWorkspace();
    return {
      file: this.file,
      ...choicesOf(config),
      isTrusted: await this.trust.isTrusted(this.data.dir, config),
    };
  }

  /**
   * Turns one server on or off here (the MCP tab). Turning it off keeps it allowed, so it
   * stays listed and can be turned back on.
   */
  setEnabled(name: string, isOn: boolean): Promise<McpState> {
    return this.#update(({ allowed, enabled }) =>
      isOn
        ? { allowed: unique([...allowed, name]), enabled: unique([...enabled, name]) }
        : { allowed, enabled: enabled.filter((item) => item !== name) },
    );
  }

  /**
   * Sets which servers this workspace uses, all at once (workspace settings). Newly allowed
   * ones start on; ones still allowed keep their on/off; the rest are off.
   */
  setAllowedList(names: readonly string[]): Promise<McpState> {
    return this.#update(({ allowed, enabled }) => {
      const next = unique(names);
      const before = new Set(allowed);
      const on = new Set(enabled);
      return { allowed: next, enabled: next.filter((name) => on.has(name) || !before.has(name)) };
    });
  }

  /** The server was renamed app-wide: keep it here (on or off) under its new name. */
  rename(from: string, to: string): Promise<McpState> {
    const swap = (names: string[]) => names.map((item) => (item === from ? to : item));
    return this.#update(({ allowed, enabled }) => ({
      allowed: swap(allowed),
      enabled: swap(enabled),
    }));
  }

  /** The user reviewed the file as it is now and lets its servers start. */
  approve(): Promise<McpState> {
    return serialized(`${this.file}#app`, async () => {
      const config = await this.data.readMcpWorkspace();
      await this.trust.trust(this.data.dir, config);
      return { file: this.file, ...choicesOf(config), isTrusted: true };
    });
  }

  /** Writes the choices and approves them, e.g. after importing an old mcp.json. */
  replaceApproved(enabled: readonly string[]): Promise<void> {
    return serialized(`${this.file}#app`, async () => {
      const config: McpWorkspaceConfig = { enabled: [...enabled] };
      await this.data.writeMcpWorkspace(config);
      await this.trust.trust(this.data.dir, config);
    });
  }

  #update(change: (choices: McpChoices) => McpChoices): Promise<McpState> {
    return serialized(`${this.file}#app`, async () => {
      const before = await this.read();
      const config: McpWorkspaceConfig = change(before);
      await this.data.writeMcpWorkspace(config);
      if (before.isTrusted) await this.trust.trust(this.data.dir, config);
      return {
        file: this.file,
        ...choicesOf(config),
        isTrusted: before.isTrusted || (await this.trust.isTrusted(this.data.dir, config)),
      };
    });
  }
}

type McpChoices = Pick<McpState, 'allowed' | 'enabled'>;

const unique = (names: readonly string[]): string[] => [...new Set(names)];

/** Allowed and on, as the file says; a file without `allowed` allows the ones on. */
function choicesOf(config: McpWorkspaceConfig): McpChoices {
  const allowed = unique(config.allowed ?? config.enabled);
  const isAllowed = new Set(allowed);
  return { allowed, enabled: unique(config.enabled).filter((name) => isAllowed.has(name)) };
}

/** The servers that may start in a workspace: the app's servers it turned on, once approved. */
export function runnableMcpServers(
  servers: readonly McpServerEntry[],
  state: McpState,
): Record<string, McpServerConfig> {
  if (!state.isTrusted) return {};
  const on = new Set(state.enabled.filter((name) => state.allowed.includes(name)));
  return Object.fromEntries(
    servers.filter(({ name }) => on.has(name)).map(({ name, server }) => [name, server]),
  );
}
