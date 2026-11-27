// Offline tests for the chat limit: a workspace keeps its MAX_CHATS_PER_WORKSPACE most recently
// active chats, and making a new one deletes the oldest beyond that.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Workspace } from '@app/shared';
import { MAX_CHATS_PER_WORKSPACE, Store, type Chat } from '../src/store.js';
import { WorkspaceData } from '../src/workspace-data.js';

let tmp = '';
let shared: Store | undefined;

function db(): Store {
  assert.ok(shared, 'the store was not set up');
  return shared;
}

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-chat-limit-test-'));
  // Never the real ~/.code-ai: each run gets its own app home folder.
  shared = new Store({ appHome: path.join(tmp, 'home') });
});

async function newWorkspace(name: string): Promise<Workspace> {
  return db().createWorkspace({ name, path: path.join(tmp, 'folders', name.toLowerCase()) });
}

/** `count` chats, the first the least recently active (made in one millisecond, they'd tie). */
async function makeChats(ws: Workspace, count: number): Promise<Chat[]> {
  const data = new WorkspaceData(ws.path, ws.name);
  const chats: Chat[] = [];
  for (let i = 0; i < count; i++) {
    const chat = await db().createChat(ws.id, `Chat ${i}`);
    await data.updateChat(chat.id, {
      updatedAt: `2024-01-01T00:00:${String(i).padStart(2, '0')}Z`,
    });
    chats.push(chat);
  }
  return chats;
}

async function chatIds(ws: Workspace): Promise<string[]> {
  return (await db().listChats(ws.id)).map((chat) => chat.id);
}

test('a workspace up to the limit keeps every chat', async () => {
  const ws = await newWorkspace('Under');
  const chats = await makeChats(ws, MAX_CHATS_PER_WORKSPACE);
  const kept = await chatIds(ws);
  assert.equal(kept.length, MAX_CHATS_PER_WORKSPACE);
  for (const chat of chats) assert.ok(kept.includes(chat.id), `${chat.title} was kept`);
});

test('one chat past the limit deletes the least recently active, not the first made', async () => {
  const ws = await newWorkspace('Over');
  const chats = await makeChats(ws, MAX_CHATS_PER_WORKSPACE);
  const data = new WorkspaceData(ws.path, ws.name);
  const [first, second] = chats;
  assert.ok(first && second);
  // The first chat was used again lately, so the second is now the oldest.
  await data.updateChat(first.id, { updatedAt: '2024-06-01T00:00:00Z' });

  const newest = await db().createChat(ws.id, 'Newest');
  const kept = await chatIds(ws);
  assert.equal(kept.length, MAX_CHATS_PER_WORKSPACE);
  assert.ok(kept.includes(newest.id));
  assert.ok(kept.includes(first.id), 'recent activity keeps it');
  assert.ok(!kept.includes(second.id), 'the oldest is deleted');
  assert.equal(await db().getChat(second.id), null, 'and is gone from the store');
});

test('a chat without updatedAt is ordered by createdAt', async () => {
  const ws = await newWorkspace('Fallback');
  const chats = await makeChats(ws, MAX_CHATS_PER_WORKSPACE);
  const data = new WorkspaceData(ws.path, ws.name);
  const [first, second] = chats;
  assert.ok(first && second);
  // As in chats saved before updatedAt was written.
  const file = path.join(data.dir, 'chats', first.id, 'chat.json');
  const saved: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.ok(typeof saved === 'object' && saved !== null);
  await fs.writeFile(
    file,
    JSON.stringify({ ...saved, updatedAt: null, createdAt: '2024-06-01T00:00:00Z' }),
  );

  await db().createChat(ws.id, 'Newest');
  const kept = await chatIds(ws);
  assert.ok(kept.includes(first.id));
  assert.ok(!kept.includes(second.id));
});

test('the new chat is never deleted, nor a chat with a request running', async () => {
  const ws = await newWorkspace('Kept');
  const chats = await makeChats(ws, MAX_CHATS_PER_WORKSPACE);
  const data = new WorkspaceData(ws.path, ws.name);
  // Every other chat looks newer than the one about to be made.
  for (const chat of chats) await data.updateChat(chat.id, { updatedAt: '2999-01-01T00:00:00Z' });
  const [running] = chats;
  assert.ok(running);
  await data.updateChat(running.id, { updatedAt: '2000-01-01T00:00:00Z' });

  const newest = await db().createChat(ws.id, 'Newest', {
    isRunning: (id) => id === running.id,
  });
  const kept = await chatIds(ws);
  assert.ok(kept.includes(newest.id), 'the new chat stays');
  assert.ok(kept.includes(running.id), 'the running chat stays, though the oldest');
  assert.equal(kept.length, MAX_CHATS_PER_WORKSPACE, 'another chat made room instead');
});

test("a chat that can't be read doesn't stop a new one being made", async () => {
  const ws = await newWorkspace('Damaged');
  await makeChats(ws, MAX_CHATS_PER_WORKSPACE);
  const broken = await db().createChat(ws.id, 'Broken');
  const data = new WorkspaceData(ws.path, ws.name);
  await fs.writeFile(path.join(data.dir, 'chats', broken.id, 'chat.json'), '{ not json');

  const chat = await db().createChat(ws.id, 'Still made');
  assert.equal(chat.title, 'Still made');
});
