// Tool plugins built from the chat: the agent writes a plugin's code (tools.mjs), runs it in
// its own process to see it work (test_tool_plugin), fixes it until it does, and only then
// saves it (save_tool_plugin) as the same plugin the Tools tab makes. The app supplies the
// store (ToolContext.plugins); without it these tools aren't offered.
import { PLUGIN_LIMITS, type PluginSummary, type PluginTestResult } from '@app/shared';
import { PLUGIN_CODE_GUIDE } from '../plugins/write-plugin.js';
import { defineTool, type ToolContext } from './define.js';

/** A saved plugin as the agent may see it: never its environment variables' values. */
export interface PluginForAgent {
  name: string;
  description: string;
  code: string;
  envNames: string[];
}

export interface PluginTestInput {
  code: string;
  /** a saved plugin whose environment variables the test uses */
  envFrom?: string;
  /** more environment variables (over envFrom's) */
  env?: Record<string, string>;
  tool?: string;
  args?: Record<string, unknown>;
}

export interface PluginSaveInput {
  name: string;
  description: string;
  code: string;
  /** set or change these environment variables; ones already saved stay */
  env?: Record<string, string>;
  /** a plugin with this name may be replaced */
  replace: boolean;
}

export interface SavedPluginReport {
  name: string;
  isNew: boolean;
  /** the plugin's tools, as the agent will see them from the next message */
  tools: string[];
  /** turned on in this workspace */
  isOn: boolean;
  /** false: the workspace's MCP choices wait for approval, so its tools don't run yet */
  isTrusted: boolean;
}

/** What the app gives the plugin tools (ToolContext.plugins). */
export interface PluginWorkshop {
  list(): Promise<PluginSummary[]>;
  get(name: string): Promise<PluginForAgent | null>;
  /** Runs draft code once in its own process, in the workspace folder. Never throws. */
  test(input: PluginTestInput): Promise<PluginTestResult>;
  /** Saves it (app-wide), restarts its servers and turns it on in this workspace. */
  save(input: PluginSaveInput): Promise<SavedPluginReport>;
}

export const LIST_TOOL_PLUGINS = 'list_tool_plugins';

function workshop(ctx: ToolContext): PluginWorkshop {
  if (!ctx.plugins) throw new Error('This app keeps no tool plugins.');
  return ctx.plugins;
}

/** Environment variables from the model: names checked, values as strings. */
function envOf(value: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  const env: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`"${key}" isn't a valid environment variable name (letters, digits, _).`);
    }
    env[key] = typeof raw === 'string' ? raw : JSON.stringify(raw);
  }
  return env;
}

export const listToolPlugins = defineTool<{ name?: string }>({
  name: LIST_TOOL_PLUGINS,
  isReadOnly: true,
  description:
    "Tool plugins: custom tools the user makes (the Tools tab), small Node.js modules the app runs as MCP servers. Call this first when the user wants to build, try out, fix or change a custom tool from the chat: it lists the saved plugins, or with name shows one's code, and explains how plugin code must look. It makes test_tool_plugin (run draft code) and save_tool_plugin available.",
  properties: {
    name: {
      type: 'string',
      description: "A saved plugin's name, to see its code and environment variable names.",
    },
  },
  optional: ['name'],
  async run({ name }, ctx) {
    const plugins = workshop(ctx);
    const how = `How plugin code must look:\n${PLUGIN_CODE_GUIDE}\n\nWork like this: write the code, run it with test_tool_plugin (call each tool with realistic arguments) and fix it until it works, show the user what it returned, and save it with save_tool_plugin only once they are happy with it.`;
    if (name?.trim()) {
      const plugin = await plugins.get(name.trim());
      if (!plugin)
        throw new Error(
          `There is no plugin named "${name}". Call ${LIST_TOOL_PLUGINS} without a name to see them.`,
        );
      const env = plugin.envNames.length
        ? `Environment variables set for it (values hidden): ${plugin.envNames.join(', ')}. Pass env_from: "${plugin.name}" to test_tool_plugin to use them.`
        : 'No environment variables are set for it.';
      return `Plugin "${plugin.name}": ${plugin.description || '(no description)'}\n${env}\n\nCode (tools.mjs):\n\`\`\`js\n${plugin.code}\n\`\`\`\n\n${how}`;
    }
    const list = await plugins.list();
    const lines = list.length
      ? list.map((p) => `- ${p.name}: ${p.description || '(no description)'}`).join('\n')
      : '(none yet)';
    return `Saved tool plugins:\n${lines}\n\n${how}`;
  },
});

export const testToolPlugin = defineTool<{
  code: string;
  tool?: string;
  args?: Record<string, unknown>;
  env?: Record<string, unknown>;
  env_from?: string;
}>({
  name: 'test_tool_plugin',
  description:
    "Run draft tool plugin code (a whole tools.mjs) once in its own process, the way the agent would use it once saved: it lists the tools the code offers and, with tool, calls one with args and returns its result or the error with the code's stderr. Nothing is saved. Use it to try a plugin before saving it, and again after each fix.",
  properties: {
    code: { type: 'string', description: 'The whole tools.mjs: `export const tools = [...]`.' },
    tool: {
      type: 'string',
      description: 'The tool to call (its name in the code). Left out: only load and list them.',
    },
    args: { type: 'object', description: 'Arguments for the tool, as its inputSchema describes.' },
    env: {
      type: 'object',
      description:
        'Environment variables for this run, e.g. {"API_BASE_URL": "https://..."}. Only values the user gave you; never invent keys.',
    },
    env_from: {
      type: 'string',
      description: "A saved plugin's name whose environment variables to use (values stay hidden).",
    },
  },
  optional: ['tool', 'args', 'env', 'env_from'],
  needsApproval: true,
  async run({ code, tool, args, env, env_from: envFrom }, ctx) {
    if (!code.trim()) throw new Error('Pass the whole tools.mjs code.');
    if (code.length > PLUGIN_LIMITS.codeChars) throw new Error('That code is too long.');
    const result = await workshop(ctx).test({
      code,
      tool: tool?.trim() || undefined,
      args: args ?? {},
      env: envOf(env),
      envFrom: envFrom?.trim() || undefined,
    });
    const tools = result.tools.length
      ? result.tools
          .map((t) => `- ${t.name}: ${t.description}\n  input: ${JSON.stringify(t.inputSchema)}`)
          .join('\n')
      : '(none loaded)';
    const parts = [
      `Tools the code offers:\n${tools}`,
      result.output !== null ? `Result of ${tool ?? 'the call'}:\n${result.output}` : '',
      result.error ? `Error:\n${result.error}` : '',
      `Took ${result.ms} ms.`,
      result.error
        ? 'Fix the code and test again.'
        : tool
          ? 'It worked. Show the user the result; save it with save_tool_plugin once they are happy.'
          : 'It loads. Call a tool (tool and args) to see it work.',
    ];
    return parts.filter(Boolean).join('\n\n');
  },
});

export const saveToolPlugin = defineTool<{
  name: string;
  description: string;
  code: string;
  env?: Record<string, unknown>;
  replace?: boolean;
}>({
  name: 'save_tool_plugin',
  description:
    "Save tool plugin code as a plugin (shown in the Tools tab, shared by all workspaces) and turn it on in this workspace; its tools reach the agent from the user's next message. Only after test_tool_plugin showed it working and the user wants it saved.",
  properties: {
    name: {
      type: 'string',
      description: `Lower-case words joined by "-", at most ${PLUGIN_LIMITS.nameLength} characters, e.g. "exchange-rates".`,
    },
    description: { type: 'string', description: "One sentence: what the plugin's tools are for." },
    code: { type: 'string', description: 'The whole tools.mjs, as tested.' },
    env: {
      type: 'object',
      description:
        'Environment variables to set or change, e.g. {"API_KEY": "..."}; ones already saved stay. Only values the user gave you.',
    },
    replace: {
      type: 'boolean',
      description: 'true to overwrite the saved plugin with this name. Default false.',
    },
  },
  optional: ['env', 'replace'],
  needsApproval: true,
  async run({ name, description, code, env, replace = false }, ctx) {
    const saved = await workshop(ctx).save({
      name: name.trim(),
      description: description.trim(),
      code,
      env: envOf(env),
      replace,
    });
    const tools = saved.tools.length ? saved.tools.join(', ') : '(none)';
    const state = !saved.isTrusted
      ? "It is on here, but this workspace's MCP choices changed outside the app: the user must approve them in the MCP tab before its tools run."
      : `It is on in this workspace; its tools (${tools}) are available from the user's next message.`;
    return `${saved.isNew ? 'Saved the new' : 'Updated the'} plugin "${saved.name}" (Tools tab). ${state}`;
  },
});

/** Sent once list_tool_plugins was called (or the chat used them before). */
export const PLUGIN_BUILD_TOOLS: readonly string[] = [testToolPlugin.name, saveToolPlugin.name];
