// Offline tests for the token usage breakdown. Run with: npm run test -w @app/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatDetail, ModelCallUsage } from '@app/shared';
import {
  conversationReducer,
  initialConversation,
  type ConversationAction,
} from '../src/features/chat/conversation';
import { mergeGroups, messageUsages, sumUsage, usageParts } from '../src/features/chat/tokenUsage';

const at = Date.parse('2026-11-08T10:00:00.000Z');

const call = (kind: ModelCallUsage['kind'], input: number, output: number): ModelCallUsage => ({
  kind,
  model: 'm',
  durationMs: 500,
  toolCalls: [],
  input: [],
  output: [],
  inputTokens: input,
  outputTokens: output,
  cachedInputTokens: 0,
});

test('a finished reply keeps its calls, labelled with the message that asked for it', () => {
  const calls = [call('planner', 50, 10), call('step', 100, 20)];
  const actions: ConversationAction[] = [
    { type: 'send', text: 'Fix the bug\nwith details', attachments: [], skills: [], at },
    {
      type: 'event',
      event: {
        type: 'done',
        result: {
          text: 'Fixed.',
          status: 'done',
          steps: 2,
          toolsUsed: [],
          usage: { inputTokens: 150, outputTokens: 30 },
          calls,
        },
      },
      at,
    },
  ];
  const state = actions.reduce(conversationReducer, initialConversation);
  const [row, ...rest] = messageUsages(state.turns);
  assert.equal(rest.length, 0);
  assert.equal(row?.label, 'Fix the bug');
  assert.equal(row?.steps, 2);
  assert.deepEqual(row?.calls, calls);
});

test('a saved chat shows each reply once, a steered message joining the run it was sent to', () => {
  const meta = (input: number, calls: ModelCallUsage[]) =>
    ({
      role: 'meta',
      status: 'done',
      steps: calls.length,
      inputTokens: input,
      outputTokens: 10,
      cachedInputTokens: 40,
      cacheWriteTokens: 0,
      calls,
      finishedAt: null,
    }) as const;
  const detail: ChatDetail = {
    chat: {
      id: 'c',
      workspaceId: 'w',
      title: 't',
      createdAt: null,
      updatedAt: null,
      isRunning: false,
    },
    history: [
      { role: 'user', text: 'First', attachments: [], skills: [], sentAt: null },
      { role: 'assistant', text: 'One' },
      meta(100, [call('step', 100, 10)]),
      { role: 'user', text: 'Second', attachments: [], skills: [], sentAt: null },
      { role: 'assistant', text: 'Working' },
      { role: 'user', text: 'also this', attachments: [], skills: [], sentAt: null, steer: true },
      { role: 'assistant', text: 'Two' },
      meta(300, []), // saved before calls were kept
    ],
    plan: null,
    earlierPlans: [],
  };
  const state = conversationReducer(initialConversation, { type: 'load', detail });
  const rows = messageUsages(state.turns);
  assert.deepEqual(
    rows.map((row) => [row.label, row.usage.inputTokens, row.calls.length]),
    [
      ['First', 100, 1],
      ['Second', 300, 0],
    ],
  );
  assert.deepEqual(sumUsage(rows.map((row) => row.usage)), {
    inputTokens: 400,
    outputTokens: 20,
    cachedInputTokens: 80,
    cacheWriteTokens: 0,
  });
});

test('a usage splits into cached input, new input and output', () => {
  assert.deepEqual(usageParts({ inputTokens: 1000, outputTokens: 50, cachedInputTokens: 800 }), {
    cached: 800,
    freshInput: 200,
    output: 50,
    total: 1050,
  });
  // A server reporting more cached than read can't make new input negative.
  assert.equal(
    usageParts({ inputTokens: 10, outputTokens: 0, cachedInputTokens: 50 }).freshInput,
    0,
  );
});

test('breakdowns add up across requests: a result re-sent each step counts every time', () => {
  const step = (resultTokens: number) => [
    {
      id: 'system' as const,
      tokens: 100,
      items: [{ label: 'Agent instructions', tokens: 100, count: 1 }],
    },
    {
      id: 'results' as const,
      tokens: resultTokens,
      items: [
        { label: 'read_file: big.ts', tokens: resultTokens - 5, count: 1 },
        { label: 'Others', tokens: 5, count: 2 },
      ],
    },
  ];
  const merged = mergeGroups([step(1000), step(1000)]);
  assert.deepEqual(
    merged.map((group) => [group.id, group.tokens]),
    [
      ['results', 2000],
      ['system', 200],
    ],
  );
  assert.deepEqual(merged[0]?.items, [
    { label: 'read_file: big.ts', tokens: 1990, count: 2 },
    { label: 'Others', tokens: 10, count: 4 },
  ]);
});

test('tokens count live while a run works, and the end does not count them twice', () => {
  const usage = (input: number, output: number) => ({ inputTokens: input, outputTokens: output });
  const run = (actions: ConversationAction[]) =>
    actions.reduce(conversationReducer, initialConversation);
  const send: ConversationAction = { type: 'send', text: 'Go', attachments: [], skills: [], at };
  const live = (steps: number, input: number, output: number): ConversationAction => ({
    type: 'event',
    event: { type: 'usage', steps, usage: usage(input, output) },
    at,
  });

  const working = run([send, live(1, 100, 10), live(2, 250, 30)]);
  assert.equal(working.usage.inputTokens, 250);
  assert.equal(working.usage.outputTokens, 30);
  const reply = working.turns.at(-1);
  assert.equal(reply?.role === 'agent' && reply.liveMeta, '2 steps · 280 tokens');

  const done = conversationReducer(working, {
    type: 'event',
    event: {
      type: 'done',
      result: {
        text: 'Done.',
        status: 'done',
        steps: 2,
        toolsUsed: [],
        usage: usage(250, 30),
        calls: [],
      },
    },
    at,
  });
  assert.equal(done.usage.inputTokens, 250);
  assert.equal(done.usage.outputTokens, 30);
  assert.equal(done.runUsage, null);
  const finished = done.turns.at(-1);
  assert.equal(finished?.role === 'agent' && finished.liveMeta, null);

  // A run that fails keeps the tokens it spent in the chat's total.
  const failed = run([
    send,
    live(1, 100, 10),
    { type: 'fail', message: 'x' },
    { type: 'finish', at },
  ]);
  assert.equal(failed.usage.inputTokens, 100);
  assert.equal(failed.runUsage, null);
});
