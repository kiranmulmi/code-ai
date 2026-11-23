// The chat's plugin tools: a draft is tested in its own process, and saving it makes it a
// plugin that is on in the workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store, pluginWorkshop } from '../src/index.js';

const CODE = `export const tools = [
  {
    name: 'add',
    description: 'Add two numbers.',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
    async run(args, ctx) {
      return String(args.a + args.b) + (ctx.env.SUFFIX ?? '');
    },
  },
];`;

test('a chat tests a draft plugin, then saves it and it is on in the workspace', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-workshop-test-'));
  const store = new Store({ appHome: path.join(tmp, 'home') });
  const folder = path.join(tmp, 'project');
  await fs.mkdir(folder, { recursive: true });
  const workspace = await store.createWorkspace({ name: 'Plugins', path: folder });
  const workshop = pluginWorkshop(store, workspace);

  const tried = await workshop.test({
    code: CODE,
    tool: 'add',
    args: { a: 2, b: 3 },
    env: { SUFFIX: '!' },
  });
  assert.equal(tried.error, null);
  assert.equal(tried.output, '5!');

  const broken = await workshop.test({ code: 'export const tools = [;', tool: 'add' });
  assert.ok(broken.error);

  const saved = await workshop.save({
    name: 'math-tools',
    description: 'Maths.',
    code: CODE,
    env: { SUFFIX: '?' },
    replace: false,
  });
  assert.deepEqual(saved.tools, ['add']);
  assert.equal(saved.isNew, true);
  assert.equal(saved.isOn, true);
  assert.deepEqual((await store.mcp(workspace).read()).enabled, ['math-tools']);

  // The saved env is reused without the model seeing it.
  assert.deepEqual((await workshop.get('math-tools'))?.envNames, ['SUFFIX']);
  const again = await workshop.test({
    code: CODE,
    tool: 'add',
    args: { a: 1, b: 1 },
    envFrom: 'math-tools',
  });
  assert.equal(again.output, '2?');

  await assert.rejects(
    workshop.save({ name: 'math-tools', description: '', code: CODE, replace: false }),
    /already a plugin/,
  );
  await assert.rejects(
    workshop.save({ name: 'bad', description: '', code: 'export const tools = [;', replace: true }),
    /doesn't load/,
  );
  await fs.rm(tmp, { recursive: true, force: true });
});
