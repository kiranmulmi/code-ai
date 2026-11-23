// The Tools tab's AI writer: writes a tool plugin's code (tools.mjs) from what the user asks
// for, changes it as asked, or fixes it from the error a test showed. One tool-free model call;
// the form shows the result, the user tests it and can undo it.
import { PLUGIN_LIMITS } from '@app/shared';
import { isRecord } from '../errors.js';
import type { CallModel } from '../llm.js';

/**
 * How a plugin's code must look and the rules it follows: the writer's prompt, and what the
 * chat agent reads (list_tool_plugins) before it writes and tests a plugin itself.
 */
export const PLUGIN_CODE_GUIDE = `A tool plugin is one JavaScript ES module, tools.mjs, that the app runs with Node.js 22 in its own process and offers to the agent as tools (over MCP). The agent reads each tool's description and input schema to decide when and how to call it.

The module's shape, exactly:

export const tools = [
  {
    name: 'get_weather', // snake_case, letters, digits and _ only, unique, at most 64
    description: 'Get the current weather for a city. Use when the user asks about weather or temperature somewhere.',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name, e.g. "Kathmandu".' },
        units: { type: 'string', enum: ['metric', 'imperial'], description: 'Defaults to metric.' },
      },
      required: ['city'],
    },
    async run(args, ctx) {
      // args: the arguments the agent sent (check them; models make mistakes)
      // ctx.env: environment variables (API keys go here, never in the code)
      // ctx.cwd: the workspace folder the agent works in
      // ctx.log(...): debug output (stderr)
      const res = await fetch(...);
      if (!res.ok) throw new Error(\`Weather API answered \${res.status}\`);
      return { city: args.city, tempC: 21 }; // a string or any JSON value
    },
  },
];

Rules:
- Only Node.js built-ins ("node:fs/promises", "node:path", "node:child_process", ...) and globals such as fetch, URL, crypto. No npm packages: nothing is installed.
- Never write to stdout (it carries the protocol): console.log is redirected to stderr, but don't rely on printing. Return results instead.
- Secrets and settings come from ctx.env with clear UPPER_SNAKE names; if one is missing, throw an Error saying which variable to set. Never hard-code keys.
- Throw an Error with a clear, actionable message when something fails (bad input, HTTP error, not found). Don't swallow errors.
- Validate and default the arguments. Add timeouts to network calls (AbortSignal.timeout(20000)). Keep results small and useful for a model: trim huge responses, pick the fields that matter.
- Files: resolve paths against ctx.cwd and refuse paths that leave it, unless the user asked otherwise.
- Descriptions: say what the tool does and when the agent should use it, in one or two sentences; describe every property.
- Write plain modern JavaScript (no TypeScript), with short comments only where they help.`;

const WRITE_PLUGIN_PROMPT = `You write tool plugins for an AI agent. ${PLUGIN_CODE_GUIDE}

What to do depends on what you are given:
- A request and no current code: write the plugin from the request (and the name and description, when given). Split it into a few focused tools when that fits; one tool is fine.
- A request and current code: change the code as the request asks; keep everything else.
- An error from testing the code: fix the cause. Keep the rest as it is.
- Current code and nothing else: review and fix bugs, tighten descriptions and schemas.
Never invent APIs, endpoints or response fields you are unsure of; prefer well-known public APIs, and when the user named one, use it.

Also write "description": one sentence saying what the plugin's tools are for.

Reply with only a JSON object and no other text: {"description": "...", "code": "..."}`;

export interface PluginDraft {
  request?: string;
  name?: string;
  description?: string;
  code: string;
  /** what went wrong when the code was tested */
  error?: string;
  /** environment variables set for it, by name */
  envNames?: readonly string[];
}

/** The code written or rewritten and a description, or null when the reply was unusable. */
export async function writePlugin(
  callModel: CallModel,
  { request, name, description, code, error, envNames = [] }: PluginDraft,
): Promise<{ code: string; description: string } | null> {
  const asked = request?.trim() ?? '';
  const parts = [
    name?.trim() ? `Plugin name: ${name.trim()}` : '',
    description?.trim() ? `The user's description: ${description.trim()}` : '',
    envNames.length
      ? `Environment variables already set for it: ${envNames.join(', ')}`
      : 'No environment variables are set for it yet (say in a thrown error which to set, if one is needed).',
    code.trim()
      ? `Current code (tools.mjs):\n<code>\n${code.trim()}\n</code>`
      : 'No code yet: write it.',
    error?.trim() ? `Testing the code failed with:\n<error>\n${error.trim()}\n</error>` : '',
    asked ? `The user's request:\n<request>\n${asked}\n</request>` : '',
  ];
  const { message } = await callModel({
    system: WRITE_PLUGIN_PROMPT,
    messages: [{ role: 'user', content: parts.filter(Boolean).join('\n\n') }],
  });
  return parseWrittenPlugin(message.content ?? '');
}

/** Reads the JSON reply; a reply that is just code (in a fence or not) is taken as the code. */
export function parseWrittenPlugin(raw: string): { code: string; description: string } | null {
  const text = raw.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      if (isRecord(parsed) && typeof parsed.code === 'string') {
        const code = stripFence(parsed.code);
        if (!code) return null;
        return {
          code: code.slice(0, PLUGIN_LIMITS.codeChars),
          description:
            typeof parsed.description === 'string'
              ? parsed.description
                  .replace(/\s+/g, ' ')
                  .trim()
                  .slice(0, PLUGIN_LIMITS.descriptionLength)
              : '',
        };
      }
    } catch {
      // Not JSON: maybe plain code.
    }
  }
  const code = stripFence(text);
  return /export\s+(const|default)/.test(code) ? { code, description: '' } : null;
}

function stripFence(text: string): string {
  const fenced = /```[a-z]*\n([\s\S]*?)\n```/i.exec(text);
  return (fenced?.[1] ?? text).trim();
}
