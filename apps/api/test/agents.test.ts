// Offline tests for the Agents tab's service: a workspace's own specialists and broken files.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Store } from '@app/db';
import { specialistInputSchema } from '@app/shared';
import { createAgentsService } from '../src/features/agents/agents.service.js';
import { ConflictError, NotFoundError } from '../src/lib/errors.js';

async function setup() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-api-agents-'));
  const store = new Store({ appHome: path.join(tmp, 'home') });
  const folder = path.join(tmp, 'project');
  await fs.mkdir(folder);
  const workspace = await store.createWorkspace({ name: 'Project', path: folder });
  const workspaces = {
    require: async (id: string) => {
      const found = await store.getWorkspace(id);
      if (!found) throw new NotFoundError('No such workspace.');
      return found;
    },
  };
  return { service: createAgentsService({ store }, workspaces), id: workspace.id, folder };
}

const auditor = specialistInputSchema.parse({
  name: 'security-auditor',
  description: 'Checking code for security problems.',
  toolGroups: ['files'],
  readOnly: true,
});

test('create, read, rename and delete a specialist; taken names are a 409', async () => {
  const { service, id } = await setup();
  const created = await service.create(id, auditor);
  assert.equal(created.name, 'security-auditor');
  await assert.rejects(service.create(id, auditor), ConflictError);

  const list = await service.list(id);
  assert.equal(list.specialists[0]?.name, 'security-auditor');
  assert.ok(list.specialists.some((s) => s.name === 'researcher' && s.isBuiltIn));

  const renamed = await service.update(id, 'security-auditor', { ...auditor, name: 'auditor' });
  assert.equal(renamed.name, 'auditor');
  await assert.rejects(service.get(id, 'security-auditor'), NotFoundError);
  await service.remove(id, 'auditor');
  await assert.rejects(service.remove(id, 'auditor'), NotFoundError);
});

test('broken files show with their reason and can be deleted by file name', async () => {
  const { service, id, folder } = await setup();
  const dir = path.join(folder, '.hamro-ai', 'project', 'agents');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'helper.md'), '---\ntools: files, wifi\n---\n');
  const { problems } = await service.list(id);
  assert.deepEqual(problems, [
    {
      file: 'helper.md',
      problem: 'Add a "description:" line saying when to use it: the agent picks by it.',
    },
  ]);
  await service.remove(id, 'helper.md');
  assert.deepEqual((await service.list(id)).problems, []);
});

test('an unknown workspace is a 404', async () => {
  const { service } = await setup();
  await assert.rejects(service.list('00000000-0000-4000-8000-000000000000'), NotFoundError);
});
