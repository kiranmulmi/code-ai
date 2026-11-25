// Offline tests for the Store: the workspace list (in a temp app home instead of ~/.code-ai),
// and each workspace's chats, memory and files in its folder. No database or server needed.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  AgentLogger,
  AgentRunOptions,
  CallModel,
  ModelReply,
  ModelRequest,
  ToolCall,
} from '@app/agent';
import { workspaceSlug, type HistoryItem } from '@app/shared';
import { Store } from '../src/store.js';
import { McpTrust } from '../src/mcp-trust.js';
import { WorkspaceData } from '../src/workspace-data.js';
import { runInChat, historyForUi, titleFrom } from '../src/chat-session.js';

const silentLogger: AgentLogger = {
  file: null,
  record() {},
  warn() {},
  error() {},
  scoped: () => silentLogger,
};

let shared: Store | undefined;
let tmp = '';

/** The store the tests share, created in before(). */
function db(): Store {
  assert.ok(shared, 'the store was not set up');
  return shared;
}

/** The item at `index` (negative counts from the end), failing the test when it's missing. */
function nth<T>(items: readonly T[], index: number): T {
  const item = items.at(index);
  assert.ok(item !== undefined, `no item at index ${index}`);
  return item;
}

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-test-'));
  // Never the real ~/.code-ai: each run gets its own app home folder.
  shared = new Store({ appHome: path.join(tmp, 'home') });
});

interface Scripted {
  finishReason?: string;
  message: ModelReply;
}

function scriptedModel(responses: Scripted[]) {
  const requests: Omit<ModelRequest, 'onText' | 'onOutput' | 'onReasoning'>[] = [];
  const callModel: CallModel = async (req) => {
    const { onText: _onText, onOutput: _onOutput, onReasoning: _onReasoning, ...rest } = req;
    requests.push(structuredClone(rest));
    const next = responses.shift();
    if (!next) throw new Error('fake model ran out of responses');
    return {
      model: 'fake',
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: next.finishReason ?? 'stop',
      message: next.message,
    };
  };
  return { callModel, requests };
}
const callTools = (...calls: ToolCall[]): Scripted => ({
  finishReason: 'tool_calls',
  message: { role: 'assistant', content: null, tool_calls: calls },
});
const toolCall = (id: string, name: string, input: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(input) },
});
const answer = (text: string): Scripted => ({
  finishReason: 'stop',
  message: { role: 'assistant', content: text },
});
/** A new folder for a workspace, inside this run's temp dir. */
const folder = (name: string) => path.join(tmp, 'folders', name);

const agentOptions = (callModel: CallModel): AgentRunOptions => ({
  callModel,
  logger: silentLogger,
  approve: async () => true,
  config: { planning: 'off' },
});

test('workspaces keep their own memories and the folder chosen for them', async () => {
  const store = db();
  const a = await store.createWorkspace({
    name: 'English Tutor!',
    path: folder('tutor'),
    instructions: 'Correct my English.',
  });
  const b = await store.createWorkspace({ name: 'Research', path: folder('research') });
  assert.equal(a.path, await fs.realpath(folder('tutor')), 'stored as the real path');
  assert.ok((await fs.stat(a.path)).isDirectory(), 'created when missing');

  const memA = store.memory(a);
  const saved = await memA.add('The user is learning English.');
  assert.equal(
    (await memA.add('the user is learning english.')).id,
    saved.id,
    "exact copies aren't saved twice",
  );
  await store.memory(b).add('The user researches Indonesian media.');
  assert.deepEqual(
    (await memA.all()).map((m) => m.fact),
    ['The user is learning English.'],
  );
  assert.equal(
    (await store.memory(b).search('learning english')).length,
    0,
    'search stays inside the workspace',
  );

  const updated = await memA.update(
    saved.id.slice(0, 8),
    'The user is learning English, level B1.',
  );
  assert.ok(updated);
  assert.equal(updated.id, saved.id);
  assert.ok(updated.updatedAt);
  assert.equal(
    await store.memory(b).update(saved.id.slice(0, 8), 'x'),
    null,
    "another workspace can't edit it",
  );
  assert.equal((await store.memory(b).remove([saved.id])).length, 0, 'or delete it');
  assert.equal((await memA.remove([saved.id.slice(0, 8)])).length, 1);

  const renamed = await store.updateWorkspace(a.id, { name: 'Tutor' });
  assert.ok(renamed);
  assert.equal(renamed.name, 'Tutor');
  assert.equal(renamed.instructions, 'Correct my English.', 'fields left out are kept');
  assert.equal(renamed.path, a.path);
  const chat = await store.createChat(a.id, 'Kept');
  await store.memory(renamed).add('A fact that moves too.');
  const moved = await store.updateWorkspace(a.id, { path: folder('tutor-2') });
  assert.ok(moved);
  assert.equal(moved.path, await fs.realpath(folder('tutor-2')));
  assert.equal(moved.instructions, 'Correct my English.', 'instructions move with the folder');
  assert.equal((await store.getChat(chat.id))?.title, 'Kept', 'so do the chats');
  assert.deepEqual(
    (await store.memory(moved).all()).map((m) => m.fact),
    ['A fact that moves too.'],
  );
  await assert.rejects(fs.access(path.join(a.path, '.code-ai')), 'nothing is left behind');

  // Another workspace can share the folder, but not under a name with the same slug.
  await assert.rejects(store.createWorkspace({ name: 'tutor!', path: moved.path }), {
    name: 'InputError',
    message: /"Tutor" already uses that folder with a name that's too similar/,
  });
  await assert.rejects(store.updateWorkspace(b.id, { path: moved.path, name: 'TUTOR' }), {
    name: 'InputError',
    message: /too similar/,
  });

  // The same checks before saving, as the folder is picked; nothing is created.
  assert.equal(await store.folderProblem(moved.path), null, 'sharing a folder is fine');
  assert.match((await store.folderProblem(moved.path, undefined, ' tutor ')) ?? '', /too similar/);
  assert.equal(await store.folderProblem(moved.path, b.id), null, 'another name is fine');
  assert.match((await store.folderProblem(moved.path, b.id, 'Tutor')) ?? '', /too similar/);
  assert.equal(await store.folderProblem(moved.path, a.id), null, 'its own folder is fine');
  assert.equal(await store.folderProblem(folder('not-made-yet'), b.id), null);
  await assert.rejects(fs.access(folder('not-made-yet')), 'checking creates nothing');
  const leftover = folder('leftover');
  await fs.mkdir(path.join(leftover, '.code-ai', 'research'), { recursive: true });
  assert.match((await store.folderProblem(leftover, b.id)) ?? '', /already has data/);
  assert.equal(
    await store.folderProblem(leftover, undefined, 'Research'),
    null,
    'a new workspace takes it over',
  );
  await assert.rejects(store.createWorkspace({ name: '  ', path: folder('x') }), {
    name: 'InputError',
    message: /Give the workspace a name/,
  });
  await assert.rejects(store.createWorkspace({ name: 'Disk', path: '/' }), {
    name: 'InputError',
    message: /not the whole disk/,
  });
  await assert.rejects(store.createWorkspace({ name: 'Relative', path: 'code/app' }), {
    name: 'InputError',
    message: /absolute path/,
  });
});

test('a new workspace starts with the file tools off until turned on', async () => {
  const store = db();
  const ws = await store.createWorkspace({ name: 'Fresh', path: folder('fresh') });
  assert.deepEqual(ws.disabledTools, ['files']);

  const updated = await store.updateWorkspace(ws.id, { disabledTools: [] });
  assert.deepEqual(updated?.disabledTools, [], 'turning them on is saved');

  const chosen = await store.createWorkspace({
    name: 'All on',
    path: folder('all-on'),
    disabledTools: [],
  });
  assert.deepEqual(chosen.disabledTools, [], 'an explicit choice wins over the default');
});

test("a chat is saved and continues across requests, with the workspace's instructions and memories", async () => {
  const store = db();
  const ws = await store.createWorkspace({
    name: 'Tutor',
    path: folder('chat'),
    instructions: 'Always answer in simple English.',
    disabledTools: [], // it writes a file, and new workspaces start with the file tools off
  });
  await store.memory(ws).add("The user's name is Kiran.");
  const chat = await store.createChat(ws.id, titleFrom('hello?\nsecond line'));
  assert.equal(chat.title, 'hello?');

  const first = scriptedModel([
    callTools(
      toolCall('t1', 'create_plan', {
        goal: 'Greet',
        steps: ['Say hi', 'Ask a question'],
        done_when: '',
      }),
    ),
    callTools(toolCall('t2', 'write_file', { path: 'notes.txt', content: 'hi' })),
    answer('Hello Kiran!'),
    answer('Still asking.'),
  ]);
  const r1 = await runInChat({
    store,
    workspace: ws,
    chat,
    prompt: 'hello?',
    agentOptions: agentOptions(first.callModel),
  });
  assert.equal(r1.status, 'done');
  assert.match(
    nth(first.requests, 0).system,
    /<workspace_instructions>\nAlways answer in simple English\.\n<\/workspace_instructions>/,
  );
  assert.match(
    nth(nth(first.requests, 0).messages, 0).content,
    /Saved memories[\s\S]*Kiran[\s\S]*\n\nhello\?$/,
  );
  assert.equal(
    await fs.readFile(path.join(ws.path, 'notes.txt'), 'utf8'),
    'hi',
    "files go in the workspace's folder",
  );

  // The next request in the same chat starts from what was saved.
  const saved = await store.getChat(chat.id);
  assert.ok(saved);
  assert.equal(saved.plan?.goal, 'Greet');
  assert.match(saved.memoryShown ?? '', /Kiran/);
  const second = scriptedModel([answer('You said hello.')]);
  await runInChat({
    store,
    workspace: ws,
    chat: saved,
    prompt: 'what did I say?',
    agentOptions: agentOptions(second.callModel),
  });
  const sent = nth(second.requests, 0).messages;
  assert.equal(nth(sent, -1).content, 'what did I say?', "memories aren't repeated when unchanged");
  assert.equal(sent.filter((m) => m.role === 'tool').length, 2);
  assert.ok(sent.some((m) => m.role === 'assistant' && m.content === 'Hello Kiran!'));

  // What the UI shows after a reload: what the user typed, no internal check message, and each run's cost.
  const history = historyForUi(await store.loadMessages(chat.id), await store.loadRuns(chat.id));
  const label = (h: HistoryItem) =>
    h.role === 'meta' || h.role === 'compaction'
      ? h.role
      : `${h.role}:${h.role === 'tool' ? h.name : h.text}`;
  assert.deepEqual(history.map(label), [
    'user:hello?',
    'tool:create_plan',
    'tool:write_file',
    'assistant:Hello Kiran!',
    'assistant:Still asking.',
    'meta',
    'user:what did I say?',
    'assistant:You said hello.',
    'meta',
  ]);
  const meta = nth(history, 5);
  assert.ok(meta.role === 'meta');
  assert.equal(meta.steps, 4);
  assert.equal(meta.inputTokens, 4 * 10, 'input tokens of every model call');
  assert.equal(meta.outputTokens, 4 * 5, 'output tokens of every model call');

  const chats = await store.listChats(ws.id);
  assert.equal(nth(chats, 0).id, chat.id);
  const saved2 = path.join(ws.path, '.code-ai', workspaceSlug(ws.name), 'chats', chat.id);
  assert.ok((await fs.stat(path.join(saved2, 'messages.jsonl'))).isFile(), 'saved in the folder');
  assert.equal(nth(await store.listWorkspaces(), -1).chatCount, 1);
});

test('a failed request still saves what happened', async () => {
  const store = db();
  const ws = await store.createWorkspace({ name: 'Errors', path: folder('errors') });
  const chat = await store.createChat(ws.id, 'x');
  const failing: CallModel = async () => {
    throw new Error('server down');
  };
  await assert.rejects(
    runInChat({ store, workspace: ws, chat, prompt: 'hi', agentOptions: agentOptions(failing) }),
    /server down/,
  );
  const rows = await store.loadMessages(chat.id);
  assert.deepEqual(
    rows.map((r) => [r.role, r.display ?? r.content, r.internal]),
    [
      ['user', 'hi', false],
      // Closed with a hidden note, so the next request doesn't answer this one instead.
      [
        'assistant',
        '(No answer: this request failed with "server down". If the user asks again, start that request over.)',
        true,
      ],
    ],
  );
  const [run] = (await store.loadRuns(chat.id)).values();
  assert.ok(run);
  assert.equal(run.status, 'error');
});

test('deleting a workspace deletes its chats and memories, not its files', async () => {
  const store = db();
  const ws = await store.createWorkspace({ name: 'Temporary', path: folder('temporary') });
  const chat = await store.createChat(ws.id, 'x');
  await store.memory(ws).add('fact');
  await fs.writeFile(path.join(ws.path, 'keep.txt'), 'mine');
  assert.equal(await store.deleteWorkspace(ws.id), true);
  assert.equal(await store.getChat(chat.id), null);
  assert.deepEqual(await store.memory(ws).all(), []);
  await assert.rejects(fs.access(path.join(ws.path, '.code-ai')));
  assert.equal(await fs.readFile(path.join(ws.path, 'keep.txt'), 'utf8'), 'mine');
  assert.equal(await store.getWorkspace('not-a-uuid'), null);
});

test('an app-written title never replaces one the user chose', async () => {
  const store = db();
  const ws = await store.createWorkspace({ name: 'Titles', path: folder('titles') });
  const chat = await store.createChat(ws.id, 'hello');

  assert.equal((await store.setAutoTitle(chat.id, 'Flights to Dubai'))?.title, 'Flights to Dubai');
  assert.equal(await store.setAutoTitle(chat.id, 'Flights to Dubai'), null, 'unchanged: no update');

  await store.renameChat(chat.id, 'My trip');
  assert.equal(await store.setAutoTitle(chat.id, 'Something else'), null);
  assert.equal((await store.getChat(chat.id))?.title, 'My trip');
});

test('MCP servers are kept app-wide and imported once from old workspace files', async () => {
  // Its own app home, so the test never touches the real ~/.code-ai.
  const appHome = path.join(tmp, 'mcp-home');
  const trustFile = path.join(appHome, 'mcp-trust.json');
  const store = new Store({ appHome });
  assert.deepEqual(await store.mcpServers.list(), []);
  await store.mcpServers.add('docs', { command: 'node' });
  await assert.rejects(store.mcpServers.add('docs', { command: 'node' }), /already an MCP server/);

  // An approved old-style mcp.json: its servers move to the app's list, on as they were.
  const ws = await store.createWorkspace({ name: 'Old MCP', path: folder('old-mcp') });
  const data = new WorkspaceData(ws.path, ws.name);
  await data.ensure();
  const legacy = {
    mcpServers: {
      docs: { command: 'node' }, // same settings as the app's: reused
      github: { url: 'https://example.com/mcp' },
      off: { command: 'x', disabled: true },
    },
  };
  await fs.writeFile(data.mcpFile, JSON.stringify(legacy));
  await new McpTrust(trustFile).trust(data.dir, legacy); // the user had approved the old file
  const notes = await store.importLegacyMcp();
  assert.match(notes.join('\n'), /Old MCP: imported 3 MCP server\(s\), 2 on/);
  assert.deepEqual((await store.mcpServers.list()).map((s) => s.name).sort(), [
    'docs',
    'github',
    'off',
  ]);
  assert.deepEqual((await store.mcp(ws).read()).enabled.sort(), ['docs', 'github']);
  assert.deepEqual(await store.importLegacyMcp(), [], 'only once');

  // Renaming keeps it on in the workspaces that use it.
  await store.mcpServers.replace('github', 'gh', { url: 'https://example.com/mcp' });
  await store.renameMcpServer('github', 'gh');
  assert.deepEqual((await store.mcp(ws).read()).enabled.sort(), ['docs', 'gh']);
});

test('workspaces with different names share a folder, each with its own data', async () => {
  const store = db();
  const shared = folder('shared');
  const alpha = await store.createWorkspace({ name: 'Alpha', path: shared, instructions: 'A' });
  const beta = await store.createWorkspace({ name: 'Beta Site', path: shared });
  assert.equal(alpha.path, beta.path);
  const chatA = await store.createChat(alpha.id, 'Alpha chat');
  const chatB = await store.createChat(beta.id, 'Beta chat');
  await store.memory(alpha).add('alpha fact');
  await store.skills(beta).create({ name: 'beta-skill', description: 'When beta.', body: 'x' });

  assert.deepEqual(
    (await store.listChats(alpha.id)).map((c) => c.title),
    ['Alpha chat'],
  );
  assert.deepEqual(
    (await store.listChats(beta.id)).map((c) => c.title),
    ['Beta chat'],
  );
  assert.equal((await store.getWorkspace(beta.id))?.instructions, '', 'settings are separate');
  assert.deepEqual(await store.memory(beta).all(), [], 'so is memory');
  assert.deepEqual(await store.skills(alpha).list(), [], 'and skills');
  assert.equal((await store.skills(beta).list()).length, 1);
  const root = path.join(alpha.path, '.code-ai');
  assert.deepEqual((await fs.readdir(root)).sort(), ['.gitignore', 'alpha', 'beta-site']);

  // A name with the same slug can't share it.
  await assert.rejects(store.createWorkspace({ name: 'ALPHA!', path: shared }), {
    name: 'InputError',
    message:
      /"Alpha" already uses that folder with a name that's too similar\. Pick another name\./,
  });
  await assert.rejects(store.updateWorkspace(beta.id, { name: 'alpha' }), { name: 'InputError' });

  // Renaming moves its data; its chats still load, and its MCP approval goes along.
  await store.mcpServers.add('shared-docs', { command: 'node' }).catch(() => {});
  await store.mcp(alpha).setEnabled('shared-docs', true);
  const renamed = await store.updateWorkspace(alpha.id, { name: 'Alpha Two' });
  assert.ok(renamed);
  assert.equal((await store.getChat(chatA.id))?.title, 'Alpha chat');
  assert.deepEqual(
    (await store.memory(renamed).all()).map((m) => m.fact),
    ['alpha fact'],
  );
  assert.equal(renamed.instructions, 'A');
  assert.equal((await store.mcp(renamed).read()).isTrusted, true, 'still approved');
  assert.deepEqual((await fs.readdir(root)).sort(), ['.gitignore', 'alpha-two', 'beta-site']);
  // Rename and move at once.
  const moved = await store.updateWorkspace(alpha.id, { name: 'Alpha', path: folder('alpha-own') });
  assert.ok(moved);
  assert.equal((await store.getChat(chatA.id))?.title, 'Alpha chat');
  assert.ok((await fs.stat(path.join(moved.path, '.code-ai', 'alpha', 'chats'))).isDirectory());
  assert.deepEqual((await fs.readdir(root)).sort(), ['.gitignore', 'beta-site']);
  // And back to the shared folder.
  await store.updateWorkspace(alpha.id, { path: shared });
  assert.equal((await store.getChat(chatA.id))?.title, 'Alpha chat');
  await assert.rejects(fs.access(path.join(moved.path, '.code-ai')), 'nothing left behind');

  // Deleting one leaves the other's data.
  assert.equal(await store.deleteWorkspace(beta.id), true);
  assert.equal(await store.getChat(chatB.id), null);
  assert.equal((await store.getChat(chatA.id))?.title, 'Alpha chat');
  assert.deepEqual((await fs.readdir(root)).sort(), ['.gitignore', 'alpha']);

  assert.equal(await store.deleteWorkspace(alpha.id), true);
  await assert.rejects(fs.access(root), '.code-ai goes with the last workspace');
});

test('re-adding a workspace by name on its folder brings its chats back', async () => {
  const store = db();
  const target = folder('readd');
  const ws = await store.createWorkspace({ name: 'Readd Me', path: target });
  const chat = await store.createChat(ws.id, 'Remember me');
  const other = await store.createWorkspace({ name: 'Neighbour', path: target });
  // Removed from the list only (as on another machine): the data stays in its subfolder.
  const listFile = path.join(tmp, 'home', 'workspaces.json');
  const list = JSON.parse(await fs.readFile(listFile, 'utf8')) as {
    workspaces: { id: string }[];
  };
  list.workspaces = list.workspaces.filter((w) => w.id !== ws.id);
  await fs.writeFile(listFile, JSON.stringify(list));

  const back = await store.createWorkspace({ name: 'readd me', path: target });
  assert.deepEqual(
    (await store.listChats(back.id)).map((c) => c.id),
    [chat.id],
  );
  assert.deepEqual(await store.listChats(other.id), [], 'the neighbour gets none of them');
});

test('on start, old flat data moves into the workspace subfolder, with its MCP approval', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flat-test-'));
  const appHome = path.join(root, 'home');
  const project = path.join(root, 'project');
  const store = new Store({ appHome });
  const ws = await store.createWorkspace({ name: 'Old Project', path: project });
  const other = await store.createWorkspace({ name: 'Second', path: project });
  await fs.rm(path.join(ws.path, '.code-ai'), { recursive: true });

  // The old layout: one workspace's files right in .code-ai/.
  const flat = path.join(ws.path, '.code-ai');
  const chatId = '11111111-1111-4111-8111-111111111111';
  await fs.mkdir(path.join(flat, 'chats', chatId), { recursive: true });
  await fs.writeFile(
    path.join(flat, 'chats', chatId, 'chat.json'),
    JSON.stringify({ id: chatId, title: 'Old chat', createdAt: null, updatedAt: null }),
  );
  await fs.writeFile(path.join(flat, 'settings.json'), JSON.stringify({ instructions: 'old' }));
  await fs.writeFile(path.join(flat, '.gitignore'), '*\n');
  await fs.mkdir(path.join(flat, 'skills'));
  const mcpFile = { enabled: ['docs'] };
  await fs.writeFile(path.join(flat, 'mcp.json'), JSON.stringify(mcpFile));
  // A file the new place already has stays where it is.
  await fs.writeFile(path.join(flat, 'memory.json'), '{"old":true}');
  const slugDir = path.join(flat, 'old-project');
  await fs.mkdir(slugDir);
  await fs.writeFile(path.join(slugDir, 'memory.json'), '{"new":true}');
  // The user had approved the old file, keyed by the folder.
  await new McpTrust(path.join(appHome, 'mcp-trust.json')).trust(ws.path, mcpFile);

  const notes = await store.moveLegacyFolders();
  assert.match(notes.join('\n'), /Moved settings\.json, mcp\.json, chats, skills from/);
  assert.match(notes.join('\n'), /Left memory\.json in/);
  assert.match(notes.join('\n'), /Moved the MCP approval/);
  assert.equal((await store.getChat(chatId))?.title, 'Old chat');
  assert.deepEqual(await store.listChats(other.id), [], 'only the first workspace gets it');
  assert.equal((await store.getWorkspace(ws.id))?.instructions, 'old');
  assert.equal(await fs.readFile(path.join(slugDir, 'memory.json'), 'utf8'), '{"new":true}');
  assert.equal(await fs.readFile(path.join(flat, 'memory.json'), 'utf8'), '{"old":true}');
  assert.equal((await store.mcp(ws).read()).isTrusted, true, 'the approval came along');
  await fs.access(path.join(slugDir, '.gitignore'));

  const again = await store.moveLegacyFolders();
  assert.equal(again.length, 1, 'only the kept old file is noted again');
  assert.match(again[0] ?? '', /Left memory\.json/);
  assert.equal((await store.getChat(chatId))?.title, 'Old chat');
});

test('sidebar folders collect workspaces and give them back when deleted', async () => {
  const store = db();
  const a = await store.createWorkspace({ name: 'Group A', path: folder('group-a') });
  const b = await store.createWorkspace({ name: 'Group B', path: folder('group-b') });
  assert.equal(a.groupId, null, 'a new workspace starts at the top level');

  const work = await store.createWorkspaceGroup('  Client   work ');
  assert.equal(work.name, 'Client work');
  await assert.rejects(store.createWorkspaceGroup('  '), { message: /Give the folder a name/ });

  const filed = await store.updateWorkspace(a.id, { groupId: work.id });
  assert.equal(filed?.groupId, work.id);
  assert.equal((await store.getWorkspace(a.id))?.groupId, work.id, 'it is saved');
  await assert.rejects(
    store.updateWorkspace(b.id, { groupId: '00000000-0000-4000-8000-000000000000' }),
    { message: /doesn't exist/ },
  );

  const renamed = await store.renameWorkspaceGroup(work.id, 'Clients');
  assert.equal(renamed?.name, 'Clients');
  assert.deepEqual(
    (await store.listWorkspaceGroups()).map((g) => g.name),
    ['Clients'],
  );

  const back = await store.updateWorkspace(a.id, { groupId: null });
  assert.equal(back?.groupId, null, 'null moves it back to the top level');

  await store.updateWorkspace(b.id, { groupId: work.id });
  assert.equal(await store.deleteWorkspaceGroup(work.id), true);
  assert.deepEqual(await store.listWorkspaceGroups(), []);
  const kept = await store.getWorkspace(b.id);
  assert.equal(kept?.groupId, null, 'its workspaces stay, at the top level');
  assert.equal(await store.deleteWorkspaceGroup(work.id), false);
});

test('a chat keeps its own settings, through a request and apart from other chats', async () => {
  const store = db();
  const ws = await store.createWorkspace({ name: 'Settings', path: folder('chat-settings') });
  const first = await store.createChat(ws.id, 'First');
  const second = await store.createChat(ws.id, 'Second');
  assert.equal(first.settings, null);

  const settings = {
    modelId: '3f1c2b0a-1d2e-4f5a-8b9c-0d1e2f3a4b5c',
    reasoningEffort: 'high',
    autoApprove: true,
  } as const;
  const updated = await store.setChatSettings(first.id, settings);
  assert.deepEqual(updated?.settings, settings);
  // Saving settings isn't activity: the chat keeps its place in the list.
  assert.equal(updated?.updatedAt, first.updatedAt);

  const { callModel } = scriptedModel([answer('ok')]);
  await runInChat({
    store,
    workspace: ws,
    chat: first,
    prompt: 'hi',
    agentOptions: agentOptions(callModel),
  });
  assert.deepEqual((await store.getChat(first.id))?.settings, settings);
  assert.equal((await store.getChat(second.id))?.settings, null);
  assert.equal(await store.setChatSettings('3f1c2b0a-0000-4000-8000-000000000000', settings), null);
});
