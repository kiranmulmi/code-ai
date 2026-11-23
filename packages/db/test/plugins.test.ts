// Offline tests for tool plugins: the store (folders + MCP server entries), and a saved plugin
// running through the MCP hub as the agent would call it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { McpHub, PLUGIN_SERVER_SOURCE, parseWrittenPlugin, testPluginCode } from '@app/agent';
import { McpServerStore } from '../src/mcp-servers.js';
import { PluginExistsError, PluginStore, isPluginServer } from '../src/plugins.js';

const CODE = `export const tools = [
  {
    name: 'shout',
    description: 'Upper-case the text.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    async run({ text }, ctx) {
      return text.toUpperCase() + (ctx.env.SUFFIX ?? '');
    },
  },
];`;

async function tempStore(): Promise<{
  home: string;
  servers: McpServerStore;
  plugins: PluginStore;
}> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'plugins-test-'));
  const servers = new McpServerStore(path.join(home, 'mcp-servers.json'));
  return { home, servers, plugins: new PluginStore(home, servers) };
}

test('saving a plugin writes its files and registers it as an MCP server', async () => {
  const { servers, plugins } = await tempStore();
  const saved = await plugins.save(null, {
    name: 'shouter',
    description: 'Shouts.',
    code: CODE,
    env: { SUFFIX: '!' },
  });
  assert.equal(saved.name, 'shouter');
  assert.equal(saved.isRegistered, true);
  assert.deepEqual(saved.env, { SUFFIX: '!' });
  const folder = plugins.folderOf('shouter');
  assert.equal(await fs.readFile(path.join(folder, 'server.mjs'), 'utf8'), PLUGIN_SERVER_SOURCE);
  assert.match(await fs.readFile(path.join(folder, 'tools.mjs'), 'utf8'), /shout/);

  const entry = await servers.get('shouter');
  assert.ok(entry && isPluginServer(entry.server));
  assert.equal(entry.server.command, process.execPath);
  assert.deepEqual(entry.server.args, [path.join(folder, 'server.mjs')]);

  assert.deepEqual(
    (await plugins.list()).map((p) => p.name),
    ['shouter'],
  );
});

test('names are unique and never take over a hand-made MCP server', async () => {
  const { servers, plugins } = await tempStore();
  await plugins.save(null, { name: 'one', description: '', code: CODE, env: {} });
  await assert.rejects(
    plugins.save(null, { name: 'one', description: '', code: CODE, env: {} }),
    PluginExistsError,
  );
  await servers.add('github', { command: 'npx', args: ['x'] });
  await assert.rejects(
    plugins.save(null, { name: 'github', description: '', code: CODE, env: {} }),
    PluginExistsError,
  );
  assert.equal((await servers.get('github'))?.server.command, 'npx');
});

test('rename moves the folder and the server entry; delete removes both', async () => {
  const { servers, plugins } = await tempStore();
  await plugins.save(null, { name: 'old-name', description: '', code: CODE, env: {} });
  const before = await servers.get('old-name');
  assert.ok(before);
  await servers.replace('old-name', 'old-name', { ...before.server, autoApprove: ['shout'] });
  const renamed = await plugins.save('old-name', {
    name: 'new-name',
    description: 'Renamed',
    code: CODE,
    env: {},
  });
  assert.equal(renamed.name, 'new-name');
  assert.equal(await servers.get('old-name'), null);
  // Allowed tools survive a save.
  assert.deepEqual((await servers.get('new-name'))?.server.autoApprove, ['shout']);
  assert.equal(await plugins.get('old-name'), null);

  assert.equal(await plugins.remove('new-name'), true);
  assert.equal(await servers.get('new-name'), null);
  assert.deepEqual(await plugins.list(), []);
  assert.equal(await plugins.remove('new-name'), false);
});

test('a saved plugin runs through the MCP hub like any MCP server', async () => {
  const { servers, plugins, home } = await tempStore();
  await plugins.save(null, { name: 'shouter', description: '', code: CODE, env: { SUFFIX: '?' } });
  const entry = await servers.get('shouter');
  assert.ok(entry);
  const hub = new McpHub();
  try {
    const workspace = { id: 'w1', path: home };
    const { tools, reports } = await hub.tools(workspace, { shouter: entry.server });
    assert.equal(reports[0]?.state, 'connected', reports[0]?.error ?? '');
    const shout = tools.find((t) => t.name === 'mcp__shouter__shout');
    assert.ok(shout, 'the agent sees the tool');
    assert.equal(shout.needsApproval, true);
    const out = await shout.runValidated({ text: 'hi', reason: 'test' }, {} as never);
    assert.equal(out, 'HI?');
  } finally {
    await hub.close();
  }
});

test('refresh rewrites an outdated server file', async () => {
  const { plugins } = await tempStore();
  await plugins.save(null, { name: 'p', description: '', code: CODE, env: {} });
  const file = path.join(plugins.folderOf('p'), 'server.mjs');
  await fs.writeFile(file, '// old');
  await plugins.refresh();
  assert.equal(await fs.readFile(file, 'utf8'), PLUGIN_SERVER_SOURCE);
});

test('testPluginCode reports load errors with stderr, and tool results', async () => {
  const broken = await testPluginCode({ code: 'export const tools = [{ name: "x" }];' });
  assert.deepEqual(broken.tools, []);
  assert.match(broken.error ?? '', /has no run\(\) function/);

  const ok = await testPluginCode({ code: CODE, tool: 'shout', args: { text: 'a' } });
  assert.equal(ok.error, null);
  assert.equal(ok.output, 'A');

  const missing = await testPluginCode({ code: CODE, tool: 'nope' });
  assert.match(missing.error ?? '', /no tool named "nope"/);
});

test('parseWrittenPlugin takes JSON, fenced code, or nothing usable', () => {
  assert.deepEqual(parseWrittenPlugin('{"description":"D","code":"export const tools = [];"}'), {
    code: 'export const tools = [];',
    description: 'D',
  });
  assert.deepEqual(parseWrittenPlugin('```js\nexport const tools = [];\n```'), {
    code: 'export const tools = [];',
    description: '',
  });
  assert.equal(parseWrittenPlugin('Sorry, I cannot.'), null);
});
