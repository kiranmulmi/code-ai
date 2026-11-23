// Tool plugins made in the Tools tab, kept in the app's own data folder (APP_HOME, see
// app-home.ts), never inside a workspace, so the agent's file tools can't change their code:
//
//   <app home>/plugins/<name>/plugin.json   { name, description, updatedAt }
//   <app home>/plugins/<name>/tools.mjs     the tool code (AI-written, editable)
//   <app home>/plugins/<name>/server.mjs    the fixed MCP server around it
//
// Each one is also an MCP server in mcp-servers.json under the same name (with the plugin's
// environment variables, as that file is private), marked `"plugin": true`. So it runs like
// any other MCP server, and each workspace turns it on in its MCP or Tools tab.
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  PLUGIN_CODE_FILE,
  PLUGIN_SERVER_FILE,
  PLUGIN_SERVER_SOURCE,
  errorCode,
  pluginNodeCommand,
  serialized,
  writeFileAtomic,
  writePluginFiles,
} from '@app/agent';
import {
  PLUGIN_NAME_PATTERN,
  type McpServerConfig,
  type Plugin,
  type PluginSummary,
} from '@app/shared';
import { InputError } from './errors.js';
import { readJson, readText } from './json-file.js';
import type { McpServerStore } from './mcp-servers.js';

const MANIFEST = 'plugin.json';

const manifestSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  updatedAt: z.string().nullable().default(null),
});

/** Another plugin (or an MCP server that isn't a plugin) has this name (the API answers 409). */
export class PluginExistsError extends Error {
  override name = 'PluginExistsError';
}

export interface PluginSave {
  name: string;
  description: string;
  code: string;
  env: Record<string, string>;
}

/** An MCP server entry made for a plugin. */
export const isPluginServer = (server: McpServerConfig): boolean =>
  (server as Record<string, unknown>).plugin === true;

export class PluginStore {
  readonly dir: string;

  constructor(
    appHome: string,
    private readonly servers: McpServerStore,
  ) {
    this.dir = path.join(appHome, 'plugins');
  }

  folderOf(name: string): string {
    if (!PLUGIN_NAME_PATTERN.test(name)) throw new InputError(`"${name}" isn't a plugin name.`);
    return path.join(this.dir, name);
  }

  /** By name. */
  async list(): Promise<PluginSummary[]> {
    let names: string[];
    try {
      names = (await fs.readdir(this.dir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && PLUGIN_NAME_PATTERN.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
    const registered = await this.#registered();
    const found = await Promise.all(names.map((name) => this.#summary(name, registered)));
    return found.filter((plugin): plugin is PluginSummary => plugin !== null);
  }

  async get(name: string): Promise<Plugin | null> {
    const summary = await this.#summary(name, await this.#registered());
    if (!summary) return null;
    const code = (await readText(path.join(this.folderOf(name), PLUGIN_CODE_FILE))) ?? '';
    const entry = await this.servers.get(name);
    const { ELECTRON_RUN_AS_NODE: _internal, ...env } = entry?.server.env ?? {};
    return { ...summary, code, env };
  }

  /**
   * Saves a plugin (new when `current` is null; a different `name` renames it) and its MCP
   * server entry. Returns the plugin as saved.
   */
  async save(current: string | null, input: PluginSave): Promise<Plugin> {
    return serialized(this.dir, async () => {
      const { name } = input;
      const renaming = current !== null && current !== name;
      if (current !== null && !(await this.#exists(current))) {
        throw new InputError(`There is no plugin named "${current}".`);
      }
      if (current === null || renaming) {
        if (await this.#exists(name)) {
          throw new PluginExistsError(`There is already a plugin named "${name}".`);
        }
        const other = await this.servers.get(name);
        if (other && !isPluginServer(other.server)) {
          throw new PluginExistsError(
            `There is already an MCP server named "${name}". Pick another name.`,
          );
        }
      }

      const folder = this.folderOf(name);
      if (current !== null && renaming) await fs.rename(this.folderOf(current), folder);
      await writePluginFiles(folder, input.code);
      const updatedAt = new Date().toISOString();
      await writeFileAtomic(
        path.join(folder, MANIFEST),
        `${JSON.stringify({ name, description: input.description, updatedAt }, null, 2)}\n`,
        { mode: 0o600 },
      );

      const before = current ? await this.servers.get(current) : null;
      const server = this.#serverConfig(folder, input.env, before?.server);
      if (before) await this.servers.replace(before.name, name, server);
      else if (await this.servers.get(name)) await this.servers.replace(name, name, server);
      else await this.servers.add(name, server);

      const saved = await this.get(name);
      if (!saved) throw new Error(`The plugin "${name}" wasn't saved.`);
      return saved;
    });
  }

  /** Deletes its folder and its MCP server entry. False: no such plugin. */
  async remove(name: string): Promise<boolean> {
    return serialized(this.dir, async () => {
      if (!(await this.#exists(name))) return false;
      await fs.rm(this.folderOf(name), { recursive: true, force: true });
      const entry = await this.servers.get(name);
      if (entry && isPluginServer(entry.server)) await this.servers.remove(name);
      return true;
    });
  }

  /**
   * Brings every plugin's server.mjs and start command up to date (after an app update, or the
   * app moved to another Node). Called at startup; a broken plugin never stops the app.
   */
  async refresh(): Promise<void> {
    for (const plugin of await this.list().catch(() => [])) {
      try {
        const folder = this.folderOf(plugin.name);
        const serverFile = path.join(folder, PLUGIN_SERVER_FILE);
        if ((await readText(serverFile)) !== PLUGIN_SERVER_SOURCE) {
          await fs.writeFile(serverFile, PLUGIN_SERVER_SOURCE, { mode: 0o600 });
        }
        const entry = await this.servers.get(plugin.name);
        if (!entry || !isPluginServer(entry.server)) continue;
        const fresh = this.#serverConfig(folder, entry.server.env ?? {}, entry.server);
        if (JSON.stringify(fresh) !== JSON.stringify(entry.server)) {
          await this.servers.replace(plugin.name, plugin.name, fresh);
        }
      } catch {
        // Leave this one as it is.
      }
    }
  }

  #serverConfig(
    folder: string,
    env: Record<string, string>,
    before: McpServerConfig | undefined,
  ): McpServerConfig {
    const node = pluginNodeCommand();
    const { ELECTRON_RUN_AS_NODE: _old, ...own } = env;
    const allEnv = { ...own, ...node.env };
    return {
      command: node.command,
      args: [path.join(folder, PLUGIN_SERVER_FILE)],
      ...(Object.keys(allEnv).length ? { env: allEnv } : {}),
      // Which tools run without asking is kept across saves (set in the MCP tab).
      ...(before?.autoApprove?.length ? { autoApprove: before.autoApprove } : {}),
      plugin: true,
    };
  }

  async #exists(name: string): Promise<boolean> {
    try {
      return (await fs.stat(path.join(this.folderOf(name), PLUGIN_CODE_FILE))).isFile();
    } catch {
      return false;
    }
  }

  async #registered(): Promise<Set<string>> {
    const entries = await this.servers.list().catch(() => []);
    return new Set(entries.filter(({ server }) => isPluginServer(server)).map(({ name }) => name));
  }

  async #summary(name: string, registered: ReadonlySet<string>): Promise<PluginSummary | null> {
    if (!(await this.#exists(name))) return null;
    let description = '';
    let updatedAt: string | null = null;
    try {
      const parsed = manifestSchema.safeParse(
        await readJson(path.join(this.folderOf(name), MANIFEST)),
      );
      if (parsed.success) ({ description, updatedAt } = parsed.data);
    } catch {
      // A damaged plugin.json: list it without a description.
    }
    return { name, description, updatedAt, isRegistered: registered.has(name) };
  }
}
