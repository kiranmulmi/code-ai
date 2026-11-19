// Offline tests for the multi-agent team: specialists, the shared team notes, and sub-agents
// started in one step running at the same time (capped by maxParallelSubagents).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgent } from '../src/agent.js';
import { LongTermMemory } from '../src/memory/long-term.js';
import { Board } from '../src/team/board.js';
import { oneAtATime } from '../src/one-at-a-time.js';
import { buildToolset } from '../src/tools/index.js';
import type { AgentLogger } from '../src/logger.js';
import type { CallModel, ModelReply, ModelRequest } from '../src/llm.js';
import type { ToolCall } from '../src/memory/short-term.js';

const silentLogger: AgentLogger = { file: null, event() {}, step() {}, warn() {}, error() {} };

async function tempSetup() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-test-'));
  const filesDir = path.join(tmp, 'workspace');
  await fs.mkdir(filesDir, { recursive: true });
  return { filesDir, longTermMemory: new LongTermMemory(path.join(tmp, 'data', 'memory.json')) };
}

type Request = Omit<ModelRequest, 'onText' | 'onOutput' | 'onReasoning'>;

const say = (content: string): ModelReply => ({ role: 'assistant', content });
const calls = (...list: [id: string, name: string, input: unknown][]): ModelReply => ({
  role: 'assistant',
  content: null,
  tool_calls: list.map(
    ([id, name, input]) =>
      ({ id, type: 'function', function: { name, arguments: JSON.stringify(input) } }) as ToolCall,
  ),
});
const toolNames = (req: Request) => (req.tools ?? []).map((t) => t.function.name);
const systemOf = (req: Request) => req.system;
const taskOf = (req: Request) => String(req.messages.find((m) => m.role === 'user')?.content ?? '');
const reply = (message: ModelReply) => ({
  model: 'fake',
  usage: { inputTokens: 10, outputTokens: 5 },
  finishReason: message.tool_calls?.length ? 'tool_calls' : 'stop',
  message,
});

/** A fake model: replies in order, and records each request. */
function scriptedModel(replies: ModelReply[]) {
  const requests: Request[] = [];
  const callModel: CallModel = async (req) => {
    const { onText: _t, onOutput: _o, onReasoning: _r, ...rest } = req;
    requests.push(structuredClone(rest));
    const message = replies.shift();
    if (!message) throw new Error('fake model ran out of responses');
    return reply(message);
  };
  return { callModel, requests };
}

/**
 * A fake sub-agent model that serves several sub-agents at once: each conversation (told
 * apart by its first user message) gets its own script.
 */
function routedModel(scripts: Record<string, ModelReply[]>, delayMs = 0) {
  const requests: Request[] = [];
  let running = 0;
  let maxRunning = 0;
  const callModel: CallModel = async (req) => {
    const { onText: _t, onOutput: _o, onReasoning: _r, ...rest } = req;
    requests.push(structuredClone(rest));
    const first = String(req.messages.find((m) => m.role === 'user')?.content ?? '');
    const key = Object.keys(scripts).find((k) => first.includes(k));
    const message = key ? scripts[key]?.shift() : undefined;
    if (!message) throw new Error(`no scripted reply for: ${first.slice(0, 60)}`);
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    running -= 1;
    return reply(message);
  };
  return { callModel, requests, maxRunning: () => maxRunning };
}

// ---------- Board ----------

test('the board numbers notes, filters by topic and id, and rejects empty ones', () => {
  const board = new Board();
  board.post('Research A', 'Pricing', 'Plan A costs $10.');
  board.post('Research B', 'auth', 'Login uses OAuth.');
  board.post('Research A', 'pricing tiers', 'Pro costs $20.');
  assert.equal(board.size, 3);
  assert.deepEqual(
    board.read({ topic: 'pricing' }).map((n) => n.id),
    [1, 3],
  );
  assert.deepEqual(
    board.read({ afterId: 2 }).map((n) => n.text),
    ['Pro costs $20.'],
  );
  assert.throws(() => board.post('x', 'y', '  '), /empty/);
});

// ---------- Toolsets ----------

test('the notes tools come with sub-agents; read-only specialists get no writing tools', () => {
  const off = buildToolset([], [], {});
  assert.ok(!off.byName.has('post_note') && !off.byName.has('delegate_task'));
  const lead = buildToolset([], [], { subagents: true });
  for (const name of ['post_note', 'read_notes', 'delegate_task']) assert.ok(lead.byName.has(name));
  const reader = buildToolset([], [], { notes: true, readOnly: true });
  for (const name of ['write_file', 'run_command', 'remember', 'forget', 'delete_path']) {
    assert.ok(!reader.byName.has(name), name);
  }
  for (const name of ['read_file', 'web_search', 'post_note', 'read_notes']) {
    assert.ok(reader.byName.has(name), name);
  }
});

test('delegate_task lists the specialists and refuses unknown ones', async () => {
  const setup = await tempSetup();
  const parent = scriptedModel([
    calls(['d1', 'delegate_task', { task: 'x', agent: 'astrologer' }]),
    say('ok'),
  ]);
  await createAgent({
    ...setup,
    callModel: parent.callModel,
    logger: silentLogger,
    config: { planning: 'off', review: 'off', subagents: true },
  }).run('go');
  const first = parent.requests[0] as Request;
  const def = first.tools?.find((t) => t.function.name === 'delegate_task');
  const description = def?.function.description ?? '';
  for (const name of ['researcher', 'coder', 'reviewer', 'writer', 'general']) {
    assert.match(description, new RegExp(`- ${name}:`));
  }
  assert.match(systemOf(first), /Working with sub-agents/);
  const toolResult = parent.requests[1]?.messages.at(-1);
  assert.match(String(toolResult?.content), /astrologer|must be one of/i);
});

// ---------- Specialists and the team notes ----------

test('a specialist gets its role and only its tools, and shares notes with the next one', async () => {
  const setup = await tempSetup();
  const parent = scriptedModel([
    calls([
      'd1',
      'delegate_task',
      { task: 'TASK-R find the price', agent: 'researcher', label: 'Research' },
    ]),
    calls(['d2', 'delegate_task', { task: 'TASK-W write it up', agent: 'writer', label: 'Write' }]),
    calls(['r1', 'read_notes', {}]),
    say('Done: $10.'),
  ]);
  const child = routedModel({
    'TASK-R': [
      calls(['c1', 'post_note', { topic: 'price', text: 'Plan A costs $10 (example.com).' }]),
      say('Plan A costs $10.'),
    ],
    'TASK-W': [calls(['c2', 'read_notes', { topic: 'price' }]), say('Summary: $10.')],
  });
  const result = await createAgent({
    ...setup,
    callModel: parent.callModel,
    subagentCallModel: child.callModel,
    logger: silentLogger,
    config: { planning: 'off', review: 'off', subagents: true },
  }).run('Find the price and write it up');

  assert.equal(result.status, 'done');
  const researcher = child.requests.find((r) => taskOf(r).includes('TASK-R'));
  const writer = child.requests.find((r) => taskOf(r).includes('TASK-W'));
  assert.ok(researcher && writer);
  // Roles in the system prompt.
  assert.match(systemOf(researcher), /Your role \(researcher\)/);
  assert.match(systemOf(writer), /Your role \(writer\)/);
  // Tools: the researcher reads and searches but can't write or delegate; the writer has no web.
  const rTools = toolNames(researcher);
  assert.ok(rTools.includes('web_search') && rTools.includes('post_note'));
  assert.ok(!rTools.includes('write_file') && !rTools.includes('delegate_task'));
  assert.ok(!toolNames(writer).includes('web_search'));
  // The writer read the researcher's note, by its label.
  const writerSaw = child.requests
    .filter((r) => taskOf(r).includes('TASK-W'))
    .at(-1)
    ?.messages.at(-1);
  assert.match(String(writerSaw?.content), /#1 \[price\] by Research:\nPlan A costs \$10/);
  // And so does the main agent.
  assert.match(String(parent.requests[3]?.messages.at(-1)?.content), /Plan A costs \$10/);
});

test('the team notes start empty on each request', async () => {
  const setup = await tempSetup();
  const parent = scriptedModel([
    calls(['p1', 'post_note', { topic: 't', text: 'first request' }]),
    say('ok'),
    calls(['r1', 'read_notes', {}]),
    say('ok'),
  ]);
  const agent = createAgent({
    ...setup,
    callModel: parent.callModel,
    logger: silentLogger,
    config: { planning: 'off', review: 'off', subagents: true },
  });
  await agent.run('one');
  await agent.run('two');
  assert.match(String(parent.requests[3]?.messages.at(-1)?.content), /empty/);
});

// ---------- Parallel sub-agents ----------

test('delegate_task calls in one step run at the same time, at most maxParallelSubagents', async () => {
  const setup = await tempSetup();
  const tasks = ['TASK-1', 'TASK-2', 'TASK-3', 'TASK-4'];
  const parent = scriptedModel([
    calls(
      ...tasks.map((t, i): [string, string, unknown] => [
        `d${i}`,
        'delegate_task',
        { task: `${t} research`, agent: 'researcher', label: t },
      ]),
    ),
    say('All done.'),
  ]);
  const child = routedModel(Object.fromEntries(tasks.map((t) => [t, [say(`${t} result`)]])), 30);
  const result = await createAgent({
    ...setup,
    callModel: parent.callModel,
    subagentCallModel: child.callModel,
    logger: silentLogger,
    config: { planning: 'off', review: 'off', subagents: true, maxParallelSubagents: 2 },
  }).run('Research four topics');

  assert.equal(result.status, 'done');
  assert.equal(child.maxRunning(), 2);
  // Every call got its own result, in the order the model asked.
  const results = (parent.requests[1]?.messages ?? []).filter((m) => m.role === 'tool');
  assert.deepEqual(
    results.map((m) => String(m.content)),
    tasks.map((t) => `${t} result`),
  );
});

test('a reviewer runs on the review model when one is set', async () => {
  const setup = await tempSetup();
  const parent = scriptedModel([
    calls(['d1', 'delegate_task', { task: 'check a.txt', agent: 'reviewer' }]),
    say('Reviewed.'),
  ]);
  const subagentModel = scriptedModel([]);
  const reviewModel = scriptedModel([say('Looks fine.')]);
  await createAgent({
    ...setup,
    callModel: parent.callModel,
    subagentCallModel: subagentModel.callModel,
    reviewCallModel: reviewModel.callModel,
    logger: silentLogger,
    config: { planning: 'off', review: 'off', subagents: true },
  }).run('Review a.txt');
  assert.equal(subagentModel.requests.length, 0);
  assert.equal(reviewModel.requests.length, 1);
  assert.match(String(parent.requests[1]?.messages.at(-1)?.content), /Looks fine/);
});

// ---------- Prompts from sub-agents working at the same time ----------

test('oneAtATime runs calls in order, one after another, even when one fails', async () => {
  const queue = oneAtATime();
  const log: string[] = [];
  const step = (name: string, ms: number, fail = false) =>
    queue(async () => {
      log.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`end ${name}`);
      if (fail) throw new Error(name);
      return name;
    });
  const results = await Promise.allSettled([step('a', 20, true), step('b', 5), step('c', 1)]);
  assert.deepEqual(log, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  assert.deepEqual(
    results.map((r) => r.status),
    ['rejected', 'fulfilled', 'fulfilled'],
  );
});

test('sub-agents working at once take turns with approval prompts and questions', async () => {
  const setup = await tempSetup();
  const parent = scriptedModel([
    calls(
      ['d1', 'delegate_task', { task: 'TASK-A write a', agent: 'coder', label: 'A' }],
      ['d2', 'delegate_task', { task: 'TASK-B write b', agent: 'coder', label: 'B' }],
    ),
    say('Both done.'),
  ]);
  const child = routedModel(
    {
      'TASK-A': [
        calls([
          'a1',
          'ask_user',
          { question: 'Name for a?', options: [{ label: 'x' }, { label: 'y' }] },
        ]),
        calls(['a2', 'write_file', { path: 'a.txt', content: 'a' }]),
        say('Wrote a.'),
      ],
      'TASK-B': [
        calls([
          'b1',
          'ask_user',
          { question: 'Name for b?', options: [{ label: 'x' }, { label: 'y' }] },
        ]),
        calls(['b2', 'write_file', { path: 'b.txt', content: 'b' }]),
        say('Wrote b.'),
      ],
    },
    5,
  );
  // Counts prompts open at once, per kind and in all.
  const open = { approval: 0, question: 0, all: 0 };
  const maxOpen = { approval: 0, question: 0, all: 0 };
  const prompted: string[] = [];
  const prompt = async (kind: 'approval' | 'question', text: string, answer: string) => {
    open[kind] += 1;
    open.all += 1;
    maxOpen[kind] = Math.max(maxOpen[kind], open[kind]);
    maxOpen.all = Math.max(maxOpen.all, open.all);
    prompted.push(text);
    await new Promise((resolve) => setTimeout(resolve, 15));
    open[kind] -= 1;
    open.all -= 1;
    return answer;
  };
  const run = (terminal: <T>(task: () => Promise<T>) => Promise<T>) =>
    createAgent({
      ...setup,
      callModel: parent.callModel,
      subagentCallModel: child.callModel,
      logger: silentLogger,
      ask: (text) => terminal(() => prompt('approval', text, 'y')),
      askUser: async ({ question }) => ({
        type: 'answered',
        text: await terminal(() => prompt('question', question, 'x')),
      }),
      config: {
        planning: 'off',
        review: 'off',
        subagents: true,
        approval: 'ask',
        maxParallelSubagents: 2,
      },
    }).run('Write a and b');

  // The agent itself: never two approval prompts, or two questions, open at once.
  const result = await run((task) => task());
  assert.equal(result.status, 'done');
  assert.equal(maxOpen.approval, 1);
  assert.equal(maxOpen.question, 1);
  assert.equal(prompted.filter((p) => p.startsWith('Name for')).length, 2);
  const approvals = prompted.filter((p) => p.includes('wants to run write_file'));
  assert.equal(approvals.length, 2);
  assert.ok(approvals.some((p) => p.includes('"A" (coder)')));
  assert.equal(await fs.readFile(path.join(setup.filesDir, 'b.txt'), 'utf8'), 'b');
});

test('with one shared terminal queue (the CLI), approvals and questions never overlap', async () => {
  const setup = await tempSetup();
  const parent = scriptedModel([
    calls(
      ['d1', 'delegate_task', { task: 'TASK-A', agent: 'coder', label: 'A' }],
      ['d2', 'delegate_task', { task: 'TASK-B', agent: 'coder', label: 'B' }],
    ),
    say('Both done.'),
  ]);
  const ask = (q: string) =>
    calls(['q', 'ask_user', { question: q, options: [{ label: 'x' }, { label: 'y' }] }]);
  const child = routedModel(
    {
      'TASK-A': [
        ask('Name for a?'),
        calls(['w', 'write_file', { path: 'a.txt', content: 'a' }]),
        say('a'),
      ],
      'TASK-B': [
        calls(['w', 'write_file', { path: 'b.txt', content: 'b' }]),
        ask('Name for b?'),
        say('b'),
      ],
    },
    5,
  );
  let open = 0;
  let maxOpen = 0;
  const prompt = async (answer: string) => {
    open += 1;
    maxOpen = Math.max(maxOpen, open);
    await new Promise((resolve) => setTimeout(resolve, 15));
    open -= 1;
    return answer;
  };
  const terminal = oneAtATime();
  const result = await createAgent({
    ...setup,
    callModel: parent.callModel,
    subagentCallModel: child.callModel,
    logger: silentLogger,
    ask: () => terminal(() => prompt('y')),
    askUser: async () => ({ type: 'answered', text: await terminal(() => prompt('x')) }),
    config: {
      planning: 'off',
      review: 'off',
      subagents: true,
      approval: 'ask',
      maxParallelSubagents: 2,
    },
  }).run('Write a and b');
  assert.equal(result.status, 'done');
  assert.equal(maxOpen, 1);
});
