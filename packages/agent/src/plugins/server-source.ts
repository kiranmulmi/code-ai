// The MCP server every tool plugin runs: a fixed file (server.mjs) the app writes next to the
// plugin's own code (tools.mjs). It speaks MCP over stdio (newline-delimited JSON-RPC) with no
// dependencies, so a plugin folder needs no npm install. The AI only ever writes tools.mjs,
// which exports the tools; this file loads it, lists them and calls them.
//
// tools.mjs:
//   export const tools = [
//     {
//       name: 'get_weather',                       // letters, digits, _ and -
//       description: 'What it does and when to use it.',
//       inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
//       async run(args, ctx) { return 'text' },     // or any JSON value; throw to report an error
//     },
//   ];
//   ctx: { env, cwd, log } — env: its environment variables, cwd: the workspace folder,
//   log(...): writes to stderr (stdout is the MCP channel, so console.log goes to stderr too).

/** Bump when the server's behaviour changes: saved plugins get the new file on next save or start. */
export const PLUGIN_SERVER_VERSION = '1';

export const PLUGIN_SERVER_SOURCE = String.raw`// Written by code-ai (plugin server v${PLUGIN_SERVER_VERSION}). Do not edit: it is replaced on save.
// Edit tools.mjs instead (in the app's Tools tab).
import { createInterface } from 'node:readline';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const NAME = /^[A-Za-z0-9_-]{1,64}$/;

// stdout carries the protocol: anything the tool code prints goes to stderr.
const toStderr = (...parts) => process.stderr.write(parts.map(String).join(' ') + '\n');
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;

let tools = [];
try {
  const mod = await import(pathToFileURL(path.join(here, 'tools.mjs')).href);
  const list = Array.isArray(mod.tools) ? mod.tools : Array.isArray(mod.default) ? mod.default : null;
  if (!list) throw new Error('tools.mjs must export "tools": an array of tools.');
  const seen = new Set();
  for (const [i, tool] of list.entries()) {
    const where = 'tools[' + i + ']';
    if (!tool || typeof tool !== 'object') throw new Error(where + ' is not an object.');
    if (typeof tool.name !== 'string' || !NAME.test(tool.name)) {
      throw new Error(where + ': "name" must be 1-64 letters, digits, "_" or "-".');
    }
    if (seen.has(tool.name)) throw new Error('Two tools are named "' + tool.name + '".');
    seen.add(tool.name);
    if (typeof tool.run !== 'function') throw new Error('Tool "' + tool.name + '" has no run() function.');
    const schema = tool.inputSchema ?? { type: 'object', properties: {} };
    if (!schema || typeof schema !== 'object' || schema.type !== 'object') {
      throw new Error('Tool "' + tool.name + '": inputSchema must be a JSON Schema with type "object".');
    }
  }
  tools = list;
} catch (error) {
  process.stderr.write('Could not load tools.mjs: ' + (error && error.stack ? error.stack : String(error)) + '\n');
  process.exit(1);
}

const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const reply = (id, result) => send({ id, result });
const fail = (id, code, message) => send({ id, error: { code, message } });

function asText(value) {
  if (value === undefined || value === null) return '(no result)';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function call(id, params) {
  const tool = tools.find((t) => t.name === params?.name);
  if (!tool) return fail(id, -32602, 'Unknown tool: ' + String(params?.name));
  const ctx = { env: process.env, cwd: process.cwd(), log: toStderr };
  try {
    const result = await tool.run(params.arguments ?? {}, ctx);
    // A full MCP result is passed through as it is.
    if (result && typeof result === 'object' && Array.isArray(result.content)) return reply(id, result);
    reply(id, { content: [{ type: 'text', text: asText(result) }] });
  } catch (error) {
    reply(id, {
      isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    });
  }
}

function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return reply(id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: {} },
        serverInfo: { name: path.basename(here), version: '1.0.0' },
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, {
        tools: tools.map((t) => ({
          name: t.name,
          description: String(t.description ?? ''),
          inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
        })),
      });
    case 'tools/call':
      return void call(id, params);
    default:
      if (isRequest) fail(id, -32601, 'Method not found: ' + String(method));
  }
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return fail(null, -32700, 'Parse error');
  }
  for (const item of Array.isArray(message) ? message : [message]) handle(item);
});
lines.on('close', () => process.exit(0));
`;
