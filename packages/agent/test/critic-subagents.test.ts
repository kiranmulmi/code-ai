// Offline tests for the reviewer (critic) and delegate_task sub-agents, with scripted models.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent } from '@app/shared';
import { createAgent, type ApprovalSource } from '../src/agent.js';
import { parseReview, reviewMessage, reviseMessage, REVIEW_PROMPT } from '../src/critic.js';
import { LongTermMemory } from '../src/memory/long-term.js';
import type { AgentLogger } from '../src/logger.js';
import type { CallModel, ModelReply, ModelRequest } from '../src/llm.js';
import type { ToolCall } from '../src/memory/short-term.js';

const silentLogger: AgentLogger = { file: null, event() {}, step() {}, warn() {}, error() {} };

async function tempSetup() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-critic-test-'));
  const filesDir = path.join(tmp, 'workspace');
  await fs.mkdir(filesDir, { recursive: true });
  return { filesDir, longTermMemory: new LongTermMemory(path.join(tmp, 'data', 'memory.json')) };
}

type Request = Omit<ModelRequest, 'onText' | 'onOutput' | 'onReasoning'>;

/** A fake model: replies in order, and records each request. */
function scriptedModel(replies: ModelReply[]) {
  const requests: Request[] = [];
  const callModel: CallModel = async (req) => {
    const { onText, onOutput: _o, onReasoning: _r, ...rest } = req;
    requests.push(structuredClone(rest));
    const message = replies.shift();
    if (!message) throw new Error('fake model ran out of responses');
    if (message.content) onText?.(message.content);
    return {
      model: 'fake',
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: message.tool_calls?.length ? 'tool_calls' : 'stop',
      message,
    };
  };
  return { callModel, requests };
}

const say = (content: string): ModelReply => ({ role: 'assistant', content });
const call = (id: string, name: string, input: unknown): ModelReply => ({
  role: 'assistant',
  content: null,
  tool_calls: [
    { id, type: 'function', function: { name, arguments: JSON.stringify(input) } } as ToolCall,
  ],
});
const toolNames = (req: Request) => (req.tools ?? []).map((t) => t.function.name);

// ---------- parseReview and messages ----------

test('parseReview reads a verdict and issues, even around other text', () => {
  assert.deepEqual(parseReview('{"verdict":"pass","issues":[]}'), { verdict: 'pass', issues: [] });
  assert.deepEqual(
    parseReview('Sure:\n```json\n{"verdict": "revise", "issues": ["Cite the source", " "]}\n```'),
    { verdict: 'revise', issues: ['Cite the source'] },
  );
});

test('parseReview passes anything unusable, and revise without issues', () => {
  for (const text of [
    '',
    'looks fine',
    '{not json}',
    '[1,2]',
    '{"verdict":"revise","issues":[]}',
  ]) {
    assert.deepEqual(parseReview(text), { verdict: 'pass', issues: [] }, text);
  }
});

test('parseReview keeps at most five issues and shortens long ones', () => {
  const issues = Array.from({ length: 8 }, (_, i) => `issue ${i} ${'x'.repeat(i === 0 ? 900 : 1)}`);
  const review = parseReview(JSON.stringify({ verdict: 'revise', issues }));
  assert.equal(review.issues.length, 5);
  assert.ok((review.issues[0] ?? '').length <= 400);
});

test('the review message holds the request, findings and answer; revise lists the issues', () => {
  const text = reviewMessage({ request: 'Q?', plan: null, findings: '', answer: 'A.' });
  assert.match(text, /<request>\nQ\?\n<\/request>/);
  assert.match(text, /used no tools/);
  assert.doesNotMatch(text, /<plan>/);
  assert.match(reviseMessage(['one', 'two']), /1\. one\n2\. two/);
  assert.match(REVIEW_PROMPT, /JSON only/);
});

// ---------- Review in the agent loop ----------

test('review "always": a revise sends the issues back once, and the fixed answer is final', async () => {
  const setup = await tempSetup();
  const agentModel = scriptedModel([say('Paris is in Spain.'), say('Paris is in France.')]);
  const reviewer = scriptedModel([
    say('{"verdict":"revise","issues":["Paris is in France, not Spain."]}'),
  ]);
  const events: AgentEvent[] = [];
  const result = await createAgent({
    ...setup,
    callModel: agentModel.callModel,
    reviewCallModel: reviewer.callModel,
    logger: silentLogger,
    onEvent: (event) => events.push(event),
    config: { planning: 'off', review: 'always' },
  }).run('Where is Paris?');

  assert.equal(result.status, 'done');
  assert.match(result.text, /France/);
  // maxReviews = 1: the second answer isn't reviewed again (the reviewer had one reply).
  assert.equal(reviewer.requests.length, 1);
  const reviewed = reviewer.requests[0];
  assert.ok(reviewed);
  assert.deepEqual(toolNames(reviewed), []);
  assert.equal(reviewed.messages.length, 1);
  assert.match(String(reviewed.messages[0]?.content), /Paris is in Spain/);
  // The agent's second call saw the issues as an internal message.
  const last = agentModel.requests[1]?.messages.at(-1);
  assert.match(String(last?.content), /Paris is in France, not Spain/);
  assert.deepEqual(
    events.filter((e) => e.type === 'reviewing' || e.type === 'review').map((e) => e.type),
    ['reviewing', 'review'],
  );
  assert.ok(result.calls.some((c) => c.kind === 'review'));
});

test('review "tasks" skips answers made without tools; "off" never reviews', async () => {
  for (const review of ['tasks', 'off'] as const) {
    const setup = await tempSetup();
    const agentModel = scriptedModel([say('Hello!')]);
    const reviewer = scriptedModel([]);
    const result = await createAgent({
      ...setup,
      callModel: agentModel.callModel,
      reviewCallModel: reviewer.callModel,
      logger: silentLogger,
      config: { planning: 'off', review },
    }).run('hi');
    assert.equal(result.text, 'Hello!');
    assert.equal(reviewer.requests.length, 0, review);
  }
});

test('review "tasks" reviews after tools; a failing reviewer lets the answer stand', async () => {
  const setup = await tempSetup();
  const agentModel = scriptedModel([call('t1', 'recall', { query: 'x' }), say('Nothing saved.')]);
  const reviewer = scriptedModel([]); // throws: out of responses
  const result = await createAgent({
    ...setup,
    callModel: agentModel.callModel,
    reviewCallModel: reviewer.callModel,
    logger: silentLogger,
    config: { planning: 'off', review: 'tasks' },
  }).run('What do you remember about x?');
  assert.equal(result.status, 'done');
  assert.equal(result.text, 'Nothing saved.');
  assert.equal(reviewer.requests.length, 1);
});

// ---------- Sub-agents ----------

test('delegate_task is only offered when sub-agents are on', async () => {
  for (const subagents of [false, true]) {
    const setup = await tempSetup();
    const model = scriptedModel([say('ok')]);
    await createAgent({
      ...setup,
      callModel: model.callModel,
      logger: silentLogger,
      config: { planning: 'off', subagents },
    }).run('hi');
    assert.equal(toolNames(model.requests[0] as Request).includes('delegate_task'), subagents);
  }
});

test('a sub-agent runs on its own model and context, and reports back', async () => {
  const setup = await tempSetup();
  const parent = scriptedModel([
    call('d1', 'delegate_task', { task: 'Find the answer to life.', label: 'Research' }),
    say('The sub-agent says 42.'),
  ]);
  const child = scriptedModel([call('c1', 'recall', { query: 'life' }), say('42')]);
  const events: AgentEvent[] = [];
  const result = await createAgent({
    ...setup,
    callModel: parent.callModel,
    subagentCallModel: child.callModel,
    logger: silentLogger,
    onEvent: (event) => events.push(event),
    config: { planning: 'off', subagents: true },
  }).run('What is the answer to life?');

  assert.equal(result.status, 'done');
  assert.equal(result.text, 'The sub-agent says 42.');
  // The child starts fresh with just the task, and can't delegate again.
  const first = child.requests[0];
  assert.ok(first);
  assert.equal(first.messages.length, 1);
  assert.match(String(first.messages[0]?.content), /Find the answer to life/);
  assert.ok(!toolNames(first).includes('delegate_task'));
  // Its report is the delegate_task result the parent sees.
  const toolResult = parent.requests[1]?.messages.at(-1);
  assert.equal(toolResult?.role, 'tool');
  assert.match(String(toolResult?.content), /42/);
  // Its events come wrapped with the parent's call id; its calls count toward the run.
  const wrapped = events.filter((e) => e.type === 'subagent');
  assert.ok(wrapped.length > 0);
  assert.ok(wrapped.every((e) => e.type === 'subagent' && e.callId === 'd1'));
  assert.ok(
    wrapped.some(
      (e) => e.type === 'subagent' && e.event.type === 'tool_call' && e.event.name === 'recall',
    ),
  );
  assert.equal(result.calls.filter((c) => c.kind === 'subagent').length, 2);
});

test("a sub-agent's approvals are labelled with its name", async () => {
  const setup = await tempSetup();
  const parent = scriptedModel([
    call('d1', 'delegate_task', { task: 'Write hi to a.txt', label: 'Writer' }),
    say('Done.'),
  ]);
  const child = scriptedModel([
    call('c1', 'write_file', { path: 'a.txt', content: 'hi' }),
    say('Wrote it.'),
  ]);
  const asked: { tool: string; from: ApprovalSource | undefined }[] = [];
  await createAgent({
    ...setup,
    callModel: parent.callModel,
    subagentCallModel: child.callModel,
    logger: silentLogger,
    approve: async (tool, _input, from) => {
      asked.push({ tool, from });
      return true;
    },
    config: { planning: 'off', subagents: true, approval: 'ask' },
  }).run('Save hi to a.txt using a sub-agent');

  assert.deepEqual(asked, [
    { tool: 'write_file', from: { subagent: 'Writer', specialist: 'general' } },
  ]);
  assert.equal(await fs.readFile(path.join(setup.filesDir, 'a.txt'), 'utf8'), 'hi');
});
