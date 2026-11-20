// Offline tests for a workspace's notes: notes.json in its data folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NOTE_LIMITS } from '@app/shared';
import { InputError } from '../src/errors.js';
import { workspaceDataDir } from '../src/workspace-data.js';
import { WorkspaceNotes } from '../src/workspace-notes.js';

async function tempNotes(): Promise<{ notes: WorkspaceNotes; folder: string }> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-test-'));
  return { notes: new WorkspaceNotes(folder, 'Notes Test'), folder };
}

test("notes live in notes.json in the workspace's own data folder", async () => {
  const { notes, folder } = await tempNotes();
  assert.equal(notes.file, path.join(workspaceDataDir(folder, 'Notes Test'), 'notes.json'));
  assert.deepEqual(await notes.list(), []);
  await notes.create({ title: 'Hello', body: 'World' });
  const saved = JSON.parse(await fs.readFile(notes.file, 'utf8')) as { notes: unknown[] };
  assert.equal(saved.notes.length, 1);
});

test('create, read, update and delete a note; the newest change comes first', async () => {
  const { notes } = await tempNotes();
  const first = await notes.create({ title: 'First', body: 'one' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await notes.create({ title: 'Second', body: 'two' });
  assert.deepEqual(
    (await notes.list()).map((note) => note.title),
    ['Second', 'First'],
  );

  await new Promise((resolve) => setTimeout(resolve, 5));
  const updated = await notes.update(first.id, { title: 'First!', body: 'one, edited' });
  assert.equal(updated?.body, 'one, edited');
  assert.equal(updated?.createdAt, first.createdAt);
  assert.notEqual(updated?.updatedAt, first.updatedAt);
  assert.deepEqual(
    (await notes.list()).map((note) => note.id),
    [first.id, second.id],
  );
  assert.equal((await notes.get(first.id))?.title, 'First!');

  assert.equal(await notes.update('missing', { title: 'x', body: '' }), null);
  assert.equal(await notes.remove(second.id), true);
  assert.equal(await notes.remove(second.id), false);
  assert.deepEqual(
    (await notes.list()).map((note) => note.id),
    [first.id],
  );
});

test('notes saved at the same time are all kept', async () => {
  const { notes } = await tempNotes();
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => notes.create({ title: `Note ${i}`, body: '' })),
  );
  assert.equal((await notes.list()).length, 10);
});

test('a damaged notes file is an error naming it, never replaced', async () => {
  const { notes } = await tempNotes();
  await fs.mkdir(path.dirname(notes.file), { recursive: true });
  await fs.writeFile(notes.file, '{ "notes": "oops" }');
  await assert.rejects(notes.list(), /notes\.json is damaged/);
  await assert.rejects(notes.create({ title: 'x', body: '' }), /damaged/);
  assert.equal(await fs.readFile(notes.file, 'utf8'), '{ "notes": "oops" }');
});

test('a workspace can have only so many notes', async () => {
  const { notes } = await tempNotes();
  const now = new Date().toISOString();
  const full = Array.from({ length: NOTE_LIMITS.count }, (_, i) => ({
    id: `id-${i}`,
    title: '',
    body: 'x',
    createdAt: now,
    updatedAt: now,
  }));
  await fs.mkdir(path.dirname(notes.file), { recursive: true });
  await fs.writeFile(notes.file, JSON.stringify({ notes: full }));
  await assert.rejects(notes.create({ title: 'one more', body: '' }), InputError);
});
