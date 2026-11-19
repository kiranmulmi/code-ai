// Offline tests for sub-agent and review events in the chat. Run with: npm run test -w @app/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conversationReducer,
  initialConversation,
  type ConversationAction,
  type FlowItem,
} from '../src/features/chat/conversation';
import { delegateInfo, describeActivity, specialistTitle } from '../src/features/chat/tools';

const at = Date.parse('2026-11-07T10:00:00.000Z');
const play = (actions: ConversationAction[]) =>
  actions.reduce(conversationReducer, initialConversation);
const flowOf = (state: ReturnType<typeof play>): FlowItem[] => {
  const turn = state.turns.at(-1);
  return turn?.role === 'agent' ? turn.flow : [];
};

test("a sub-agent's tool calls show under its delegate_task step", () => {
  const args = JSON.stringify({ task: 'Read it', label: 'Reader' });
  const state = play([
    { type: 'send', text: 'Go', attachments: [], skills: [], at },
    { type: 'event', event: { type: 'tool_call', id: 'd1', name: 'delegate_task', args }, at },
    {
      type: 'event',
      event: {
        type: 'subagent',
        callId: 'd1',
        event: { type: 'tool_call', id: 'c1', name: 'read_file', args: '{"path":"a.ts"}' },
      },
      at,
    },
    {
      type: 'event',
      event: {
        type: 'subagent',
        callId: 'd1',
        event: { type: 'tool_result', id: 'c1', name: 'read_file', ok: true, preview: 'x' },
      },
      at,
    },
  ]);
  const step = flowOf(state).find((item) => item.kind === 'tool');
  assert.ok(step?.kind === 'tool');
  assert.deepEqual(
    step.subagent?.tools.map((t) => [t.name, t.state]),
    [['read_file', 'ok']],
  );
  assert.match(step.subagent?.status ?? '', /Reading a\.ts/);

  const done = conversationReducer(state, {
    type: 'event',
    event: { type: 'tool_result', id: 'd1', name: 'delegate_task', ok: true, preview: 'report' },
    at,
  });
  const finished = flowOf(done).find((item) => item.kind === 'tool');
  assert.ok(finished?.kind === 'tool');
  assert.equal(finished.state, 'ok');
  assert.equal(finished.subagent?.status, null);
  assert.equal(finished.subagent?.tools.length, 1);
});

test("a sub-agent's approval card names it", () => {
  const state = play([
    { type: 'send', text: 'Go', attachments: [], skills: [], at },
    {
      type: 'event',
      event: { type: 'approval', id: 'a1', tool: 'write_file', input: {}, subagent: 'Writer' },
      at,
    },
  ]);
  const card = flowOf(state).find((item) => item.kind === 'approval');
  assert.ok(card?.kind === 'approval');
  assert.equal(card.subagent, 'Writer');
  assert.equal(card.specialist, null);
});

test("a sub-agent's approval card names its specialist too", () => {
  const state = play([
    { type: 'send', text: 'Go', attachments: [], skills: [], at },
    {
      type: 'event',
      event: {
        type: 'approval',
        id: 'a1',
        tool: 'run_command',
        input: {},
        subagent: 'Fix tests',
        specialist: 'coder',
      },
      at,
    },
  ]);
  const card = flowOf(state).find((item) => item.kind === 'approval');
  assert.ok(card?.kind === 'approval');
  assert.equal(card.specialist, 'coder');
});

test('delegate_task steps read their specialist and label from the args', () => {
  assert.deepEqual(
    delegateInfo(JSON.stringify({ task: 'Find prices', agent: 'researcher', label: 'Prices' })),
    { specialist: 'researcher', label: 'Prices' },
  );
  // Older chats: no agent (a general sub-agent), no label (the task, shortened).
  assert.deepEqual(delegateInfo(JSON.stringify({ task: 'Do it' })), {
    specialist: 'general',
    label: 'Do it',
  });
  assert.equal(specialistTitle('security-auditor'), 'Security auditor');
  assert.equal(
    describeActivity('delegate_task', JSON.stringify({ agent: 'writer', label: 'Draft' })),
    'Writer: Draft',
  );
});

test('a review that asks for changes shows its issues as a note', () => {
  const state = play([
    { type: 'send', text: 'Go', attachments: [], skills: [], at },
    { type: 'event', event: { type: 'text_delta', text: 'Draft.' }, at },
    { type: 'event', event: { type: 'reviewing' }, at },
    {
      type: 'event',
      event: { type: 'review', verdict: 'revise', issues: ['Cite a source'] },
      at,
    },
  ]);
  const note = flowOf(state).find((item) => item.kind === 'note');
  assert.ok(note?.kind === 'note');
  assert.match(note.text, /1 issue[\s\S]*- Cite a source/);
});
