// Which mcp.json each workspace has approved, keyed by the workspace's data folder
// (<folder>/.code-ai/<workspace>, as several workspaces can share a folder; before, by the
// folder itself). A stdio MCP server is a command this app runs, and mcp.json can arrive with
// a cloned project or be edited by hand, so servers only start from a file whose fingerprint
// the user approved in the app. The fingerprints live outside every workspace
// (~/.code-ai/mcp-trust.json), so a file can't approve itself.
import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { z } from 'zod';
import type { McpConfig, McpWorkspaceConfig } from '@app/shared';

import { errorCode, serialized, writeFileAtomic } from '@app/agent';
import { DEFAULT_APP_HOME, appHomeFile } from './app-home.js';

/** What a workspace's mcp.json says: the old full settings, or which servers are on. */
type McpFileContent = McpConfig | McpWorkspaceConfig;

const isEmpty = (config: McpFileContent): boolean => {
  if ('enabled' in config && Array.isArray(config.enabled)) return config.enabled.length === 0;
  const servers = (config as McpConfig).mcpServers;
  return Object.keys(servers).length === 0;
};

const trustFileSchema = z.object({ workspaces: z.record(z.string(), z.string()).default({}) });

export const DEFAULT_MCP_TRUST_FILE = appHomeFile(DEFAULT_APP_HOME, 'mcpTrust');

/** The same for two configs with the same content, whatever the key order or formatting. */
export function mcpFingerprint(config: McpFileContent): string {
  return createHash('sha256').update(canonicalJson(config)).digest('hex');
}

export class McpTrust {
  constructor(readonly file: string = DEFAULT_MCP_TRUST_FILE) {}

  /**
   * `dataDir`: the workspace's data folder (WorkspaceData.dir). A file that turns nothing on
   * runs nothing, so it never needs approving.
   */
  async isTrusted(dataDir: string, config: McpFileContent): Promise<boolean> {
    if (isEmpty(config)) return true;
    return (await this.#read())[dataDir] === mcpFingerprint(config);
  }

  trust(dataDir: string, config: McpFileContent): Promise<void> {
    return this.#change((all) => ({ ...all, [dataDir]: mcpFingerprint(config) }));
  }

  forget(dataDir: string): Promise<void> {
    return this.#change((all) => {
      const { [dataDir]: _removed, ...rest } = all;
      return rest;
    });
  }

  /** The workspace's data moved (another folder or a new name), and its mcp.json with it. */
  move(from: string, to: string): Promise<void> {
    return this.#change((all) => {
      const { [from]: fingerprint, ...rest } = all;
      return fingerprint ? { ...rest, [to]: fingerprint } : rest;
    });
  }

  /**
   * Like `move`, but `to` keeps an approval of its own; for old approvals (keyed by folder)
   * whose mcp.json moved into a workspace's data folder.
   * @returns whether one was carried over
   */
  async carryOver(from: string, to: string): Promise<boolean> {
    let isCarried = false;
    await this.#change((all) => {
      const { [from]: fingerprint, ...rest } = all;
      if (!fingerprint || all[to] !== undefined) return all;
      isCarried = true;
      return { ...rest, [to]: fingerprint };
    });
    return isCarried;
  }

  async #read(): Promise<Record<string, string>> {
    let text: string;
    try {
      text = await fs.readFile(this.file, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return {};
      throw error;
    }
    // A damaged file approves nothing; the user approves again in the app.
    try {
      const parsed = trustFileSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data.workspaces : {};
    } catch {
      return {};
    }
  }

  #change(update: (all: Record<string, string>) => Record<string, string>): Promise<void> {
    return serialized(this.file, async () => {
      const workspaces = update(await this.#read());
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await writeFileAtomic(this.file, `${JSON.stringify({ workspaces }, null, 2)}\n`);
    });
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, item]) => `${JSON.stringify(k)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
