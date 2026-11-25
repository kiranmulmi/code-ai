// Offline tests for the Files panel's folder listing: one folder at a time, git's ignores dimmed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Store } from '@app/db';
import { folderChildrenQuerySchema } from '@app/shared';
import { createFilesService } from '../src/features/files/files.service.js';
import { NotFoundError, ValidationError } from '../src/lib/errors.js';

async function setup() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-api-files-'));
  const store = new Store({ appHome: path.join(tmp, 'home') });
  const folder = path.join(tmp, 'project');
  await fs.mkdir(path.join(folder, 'node_modules', 'dep'), { recursive: true });
  await fs.mkdir(path.join(folder, 'src', 'deep'), { recursive: true });
  await fs.writeFile(path.join(folder, 'node_modules', 'dep', 'index.js'), '');
  await fs.writeFile(path.join(folder, 'src', 'deep', 'a.ts'), '');
  await fs.writeFile(path.join(folder, 'README.md'), '');
  await fs.writeFile(path.join(folder, 'debug.log'), '');
  await fs.writeFile(path.join(folder, '.gitignore'), 'node_modules\n*.log\n');
  const workspace = await store.createWorkspace({ name: 'Project', path: folder });
  const workspaces = {
    require: async (id: string) => {
      const found = await store.getWorkspace(id);
      if (!found) throw new NotFoundError('No such workspace.');
      return found;
    },
  };
  return { service: createFilesService(workspaces), id: workspace.id, folder };
}

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('the top level comes first; a folder is read only when asked, generated ones too', async () => {
  const { service, id, folder } = await setup();
  const files = await service.list(id);
  assert.equal(await fs.realpath(files.path), await fs.realpath(folder));
  assert.deepEqual(
    files.root.entries.map((entry) => [entry.path, entry.kind, entry.isGenerated ?? false]),
    [
      ['node_modules', 'folder', true],
      ['src', 'folder', false],
      ['.gitignore', 'file', false],
      ['debug.log', 'file', false],
      ['README.md', 'file', false],
    ],
  );
  assert.equal(files.root.total, 5);
  // The app's own data folder (made by the Store) is never listed.
  assert.ok(!files.root.entries.some((entry) => entry.name === '.hamro-ai'));

  const src = await service.children(id, 'src', 0, 100);
  assert.deepEqual(src.entries, [{ name: 'deep', path: 'src/deep', kind: 'folder' }]);
  const deps = await service.children(id, 'node_modules/dep', 0, 100);
  assert.deepEqual(
    deps.entries.map((entry) => entry.path),
    ['node_modules/dep/index.js'],
  );

  // A page of a folder, with the total so the rest can be asked for.
  const page = await service.children(id, '', 1, 2);
  assert.deepEqual(
    page.entries.map((entry) => entry.name),
    ['src', '.gitignore'],
  );
  assert.equal(page.total, 5);
});

test(
  'git-ignored entries are marked, inside ignored folders too',
  { skip: !hasGit() },
  async () => {
    const { service, id, folder } = await setup();
    execFileSync('git', ['init', '-q'], { cwd: folder });
    const ignored = (entries: { name: string; isIgnored?: boolean }[]) =>
      entries.filter((entry) => entry.isIgnored).map((entry) => entry.name);
    assert.deepEqual(ignored((await service.list(id)).root.entries), ['node_modules', 'debug.log']);
    assert.deepEqual(ignored((await service.children(id, 'node_modules', 0, 100)).entries), [
      'dep',
    ]);
    assert.deepEqual(ignored((await service.children(id, 'src', 0, 100)).entries), []);
  },
);

test('paths outside the workspace, missing, or to a file are refused', async () => {
  const { service, id } = await setup();
  await assert.rejects(service.children(id, '../', 0, 10), ValidationError);
  await assert.rejects(service.children(id, 'nope', 0, 10), NotFoundError);
  await assert.rejects(service.children(id, 'README.md', 0, 10), ValidationError);
});

test('the folder query has defaults and limits', () => {
  assert.deepEqual(folderChildrenQuerySchema.parse({}), { path: '', offset: 0, limit: 500 });
  assert.deepEqual(folderChildrenQuerySchema.parse({ path: 'src', offset: '500', limit: '50' }), {
    path: 'src',
    offset: 500,
    limit: 50,
  });
  assert.ok(!folderChildrenQuerySchema.safeParse({ limit: '0' }).success);
  assert.ok(!folderChildrenQuerySchema.safeParse({ limit: '100000' }).success);
  assert.ok(!folderChildrenQuerySchema.safeParse({ offset: '-1' }).success);
});
