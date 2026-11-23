// How a tool plugin's server is started, and a one-off test run of draft plugin code.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PLUGIN_LIMITS, type PluginTestResult, type PluginToolInfo } from '@app/shared';
import { errorMessage, isRecord } from '../errors.js';
import { formatResult } from '../mcp/tools.js';
import { PLUGIN_SERVER_SOURCE } from './server-source.js';

/** The plugin's code, written by the AI (or the user). */
export const PLUGIN_CODE_FILE = 'tools.mjs';
/** The fixed MCP server around it (server-source.ts). */
export const PLUGIN_SERVER_FILE = 'server.mjs';

/**
 * The Node that runs plugin servers: this process's own binary, so it works without Node on
 * PATH. Inside Electron (the desktop app) that binary is Electron, which acts as plain Node
 * with ELECTRON_RUN_AS_NODE.
 */
export function pluginNodeCommand(): { command: string; env: Record<string, string> } {
  return {
    command: process.execPath,
    env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
  };
}

/** Writes a plugin's two files into `dir` (made if needed). */
export async function writePluginFiles(dir: string, code: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(dir, PLUGIN_CODE_FILE), ensureNewline(code), { mode: 0o600 });
  await fs.writeFile(path.join(dir, PLUGIN_SERVER_FILE), PLUGIN_SERVER_SOURCE, { mode: 0o600 });
}

const ensureNewline = (text: string) => (text.endsWith('\n') ? text : `${text}\n`);

export interface PluginTestOptions {
  code: string;
  env?: Record<string, string>;
  /** call this tool after listing them */
  tool?: string;
  args?: Record<string, unknown>;
  /** the folder the code runs in (as `ctx.cwd`); left out: its own temporary folder */
  cwd?: string;
  timeoutMs?: number;
}

/**
 * Runs draft plugin code the way the agent would (its own process, over MCP), lists its tools
 * and optionally calls one. Never throws: problems come back in `error`, with the end of
 * what the code wrote to stderr, so the AI writer can fix them.
 */
export async function testPluginCode({
  code,
  env = {},
  tool,
  args = {},
  cwd,
  timeoutMs = PLUGIN_LIMITS.testTimeoutMs,
}: PluginTestOptions): Promise<PluginTestResult> {
  const started = Date.now();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hamro-plugin-'));
  const stderr: string[] = [];
  let client: Client | null = null;
  const result = (part: Omit<PluginTestResult, 'ms'>): PluginTestResult => ({
    ...part,
    error: part.error ? withStderr(part.error, stderr) : null,
    ms: Date.now() - started,
  });
  let tools: PluginToolInfo[] = [];
  try {
    await writePluginFiles(dir, code);
    const node = pluginNodeCommand();
    const transport = new StdioClientTransport({
      command: node.command,
      args: [path.join(dir, PLUGIN_SERVER_FILE)],
      env: { ...env, ...node.env },
      cwd: cwd ?? dir,
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk: Buffer | string) => {
      for (const line of String(chunk).split('\n'))
        if (line.trim()) stderr.push(line.slice(0, 400));
      stderr.splice(0, Math.max(0, stderr.length - 40));
    });
    client = new Client({ name: 'hamro-ai-plugin-test', version: '1.0.0' });
    await client.connect(transport, { timeout: Math.min(timeoutMs, 20_000) });
    const listed = await client.listTools(undefined, { timeout: timeoutMs });
    tools = listed.tools.map((t) => ({
      name: t.name,
      description: (t.description ?? '').trim(),
      inputSchema: isRecord(t.inputSchema) ? t.inputSchema : { type: 'object' },
    }));
    if (!tool) return result({ tools, output: null, error: null });
    if (!tools.some((t) => t.name === tool)) {
      return result({ tools, output: null, error: `The code has no tool named "${tool}".` });
    }
    const called = await client.callTool({ name: tool, arguments: args }, undefined, {
      timeout: timeoutMs,
    });
    try {
      return result({ tools, output: formatResult(called), error: null });
    } catch (error) {
      // The tool threw: formatResult turns an isError result into an exception.
      return result({ tools, output: null, error: `The tool failed: ${errorMessage(error)}` });
    }
  } catch (error) {
    const message = errorMessage(error);
    return result({
      tools,
      output: null,
      error: /connection closed/i.test(message) ? 'The code stopped before it was ready.' : message,
    });
  } finally {
    await client?.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function withStderr(message: string, stderr: readonly string[]): string {
  return stderr.length ? `${message}\n\nstderr:\n${stderr.slice(-20).join('\n')}` : message;
}
