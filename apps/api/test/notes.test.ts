// Offline tests for the Notes tab's service and input schema.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Store } from '@app/db';
import { NOTE_LIMITS, noteInputSchema } from '@app/shared';
import { createNotesService } from '../src/features/notes/notes.service.js';
import { NotFoundError } from '../src/lib/errors.js';

async function setup() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-api-notes-'));
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
  const file = store.notes(workspace).file;
  return { service: createNotesService({ store }, workspaces), id: workspace.id, folder, file };
}

test('create, list, update and delete a note; unknown ids are a 404', async () => {
  const { service, id, folder, file } = await setup();
  const note = await service.create(id, { title: 'Deploy', body: 'Run the build first.' });
  assert.deepEqual(
    (await service.list(id)).map((n) => n.id),
    [note.id],
  );
  const saved = await service.update(id, note.id, { title: 'Deploy', body: 'Build, then ship.' });
  assert.equal(saved.body, 'Build, then ship.');
  assert.equal((await service.get(id, note.id)).body, 'Build, then ship.');

  // Kept inside the workspace's folder, in its own data subfolder.
  assert.ok(file.startsWith((await fs.realpath(folder)) + path.sep));
  assert.match(await fs.readFile(file, 'utf8'), /Build, then ship\./);

  await service.remove(id, note.id);
  await assert.rejects(service.get(id, note.id), NotFoundError);
  await assert.rejects(service.remove(id, note.id), NotFoundError);
  await assert.rejects(service.update(id, note.id, { title: 'x', body: '' }), NotFoundError);
  await assert.rejects(service.list('no-such-workspace'), NotFoundError);
});

test('a note needs a title or some text, within the limits', () => {
  assert.ok(!noteInputSchema.safeParse({ title: '  ', body: ' \n ' }).success);
  assert.ok(noteInputSchema.safeParse({ title: 'Only a title', body: '' }).success);
  assert.ok(noteInputSchema.safeParse({ title: '', body: 'Only text' }).success);
  assert.equal(noteInputSchema.parse({ title: '  Trimmed  ', body: 'x' }).title, 'Trimmed');
  assert.ok(
    !noteInputSchema.safeParse({ title: 'x'.repeat(NOTE_LIMITS.titleChars + 1), body: '' }).success,
  );
  assert.ok(!noteInputSchema.safeParse({ title: 'x' }).success);
});
