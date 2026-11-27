import { z } from 'zod';
import { PLUGIN_LIMITS } from './constants.js';

// Tool plugins: tools the user makes in the Tools tab by describing them; the AI writes the
// code. Each plugin is a small MCP server the app runs over stdio, kept in the app's data
// folder under plugins/<name>/:
//
//   plugin.json   name and description
//   tools.mjs     the tool code (AI-written, editable): `export const tools = [...]`
//   server.mjs    a fixed MCP stdio server around tools.mjs (written by the app, no dependencies)
//
// Saving a plugin also adds it to the app's MCP servers (mcp-servers.json) under the same
// name, with its environment variables there (that file is private), so each workspace turns
// it on in its Tools or MCP tab like any MCP server.

/** Lower-case words joined by hyphens, short enough to be an MCP server name. */
export const PLUGIN_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const pluginNameSchema = z
  .string()
  .trim()
  .min(1, 'Give the plugin a name.')
  .max(PLUGIN_LIMITS.nameLength, `Keep the name to ${PLUGIN_LIMITS.nameLength} characters.`)
  .regex(PLUGIN_NAME_PATTERN, 'Use lower-case letters and digits, words joined by "-".');

/** Environment variable names a plugin's code can read (API keys, base URLs). */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const envSchema = z
  .record(
    z.string().regex(ENV_NAME, 'Environment variable names are letters, digits and "_".'),
    z.string().max(4096),
  )
  .refine((env) => Object.keys(env).length <= PLUGIN_LIMITS.envCount, {
    message: `At most ${PLUGIN_LIMITS.envCount} environment variables.`,
  });

const codeSchema = z
  .string()
  .trim()
  .min(1, 'Write the tool code first (or ask AI to).')
  .max(PLUGIN_LIMITS.codeChars, 'That code is too long.');

/** POST /v1/plugins, PUT /v1/plugins/:name. */
export const pluginInputSchema = z.object({
  name: pluginNameSchema,
  description: z.string().trim().max(PLUGIN_LIMITS.descriptionLength).default(''),
  code: codeSchema,
  env: envSchema.default({}),
});

export type PluginInput = z.input<typeof pluginInputSchema>;

/** One tool a plugin offers, as its code describes it. */
export interface PluginToolInfo {
  name: string;
  description: string;
  /** its input's JSON Schema, to show and to fill in a test call */
  inputSchema: Record<string, unknown>;
}

/** A plugin in the Tools tab's list. */
export interface PluginSummary {
  name: string;
  description: string;
  updatedAt: string | null;
  /** false: its MCP server entry is gone (deleted from a workspace's MCP tab); saving adds it back */
  isRegistered: boolean;
}

/** A plugin with its code, for the edit form. */
export interface Plugin extends PluginSummary {
  code: string;
  env: Record<string, string>;
}

/**
 * POST /v1/plugins/test: runs draft code in its own process, lists its tools and, with `tool`,
 * calls one with `args`. Nothing is saved.
 */
export const pluginTestSchema = z.object({
  code: codeSchema,
  env: envSchema.default({}),
  tool: z.string().max(64).optional(),
  args: z.record(z.string(), z.unknown()).default({}),
  /** run in this workspace's folder, as the agent would; left out: a temporary folder */
  workspaceId: z.string().uuid().optional(),
});

export type PluginTestRequest = z.input<typeof pluginTestSchema>;

export interface PluginTestResult {
  /** the tools the code offers; empty when it didn't load */
  tools: PluginToolInfo[];
  /** the called tool's result as text (null: no call, or it failed) */
  output: string | null;
  /** why loading or the call failed, with the end of what the code wrote to stderr */
  error: string | null;
  /** how long it took, in milliseconds */
  ms: number;
}

/** Longest request the plugin writer takes. */
export const PLUGIN_REQUEST_MAX_CHARS = PLUGIN_LIMITS.requestChars;

/**
 * POST /v1/plugins/write: the AI writer. Writes the tool code from a request (from scratch
 * when there is none), changes it as asked, or fixes it given the error a test showed. Nothing
 * is saved.
 */
export const pluginWriteSchema = z
  .object({
    request: z
      .string()
      .trim()
      .max(PLUGIN_REQUEST_MAX_CHARS, 'Keep the request shorter.')
      .default(''),
    name: z.string().trim().max(PLUGIN_LIMITS.nameLength).optional(),
    description: z.string().max(PLUGIN_LIMITS.descriptionLength).optional(),
    code: z.string().max(PLUGIN_LIMITS.codeChars, 'That code is too long.').default(''),
    /** what went wrong when the code was tested, for the writer to fix */
    error: z.string().max(8000).optional(),
    /** names of the environment variables set for it (never their values) */
    envNames: z.array(z.string().max(100)).max(PLUGIN_LIMITS.envCount).default([]),
    modelId: z.string().uuid('Pick a model.').optional(),
  })
  .refine((draft) => draft.request !== '' || draft.code.trim() !== '' || Boolean(draft.error), {
    message: 'Say what the tool should do first.',
    path: ['request'],
  });

export type PluginWriteRequest = z.input<typeof pluginWriteSchema>;

export interface WrittenPlugin {
  code: string;
  /** a suggested description; empty when the model gave none */
  description: string;
}

/** A name typed into a field, as a plugin name: "Weather Tools!" → "weather-tools". */
export function toPluginName(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PLUGIN_LIMITS.nameLength)
    .replace(/-+$/, '');
}
