// Offline tests for questions the agent asks mid-run (ask_user). Run with: npm run test -w @app/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conversationReducer,
  initialConversation,
  type ConversationAction,
  type ConversationState,
} from '../src/features/chat/conversation';

const at = Date.parse('2026-11-13T10:00:00.000Z');
const play = (actions: ConversationAction[], from: ConversationState = initialConversation) =>
  actions.reduce(conversationReducer, from);

const options = [{ label: 'fix: hardening', description: 'Short' }, { label: 'Keep it' }];
const asked: ConversationAction[] = [
  { type: 'send', text: 'Suggest a PR title', attachments: [], skills: [], at },
  {
    type: 'event',
    event: { type: 'tool_call', id: 't1', name: 'ask_user', args: '{}' },
    at,
  },
  { type: 'event', event: { type: 'question', id: 'q1', question: 'Which title?', options }, at },
];

test('a question opens over the message box until the stream closes it', () => {
  const open = play(asked);
  assert.deepEqual(open.question, {
    id: 'q1',
    question: 'Which title?',
    options,
    isSending: false,
    error: null,
  });
  const agent = open.turns.at(-1);
  assert.equal(agent?.role === 'agent' && agent.status, 'Waiting for your answer…');

  const closed = play(
    [
      {
        type: 'event',
        event: {
          type: 'question_closed',
          id: 'q1',
          answer: { type: 'answered', text: 'Keep it' },
        },
        at,
      },
    ],
    open,
  );
  assert.equal(closed.question, null);
});

test('sending an answer marks it, a failure shows the error, and the run ending closes it', () => {
  const sending = play([...asked, { type: 'question_sending', questionId: 'q1' }]);
  assert.equal(sending.question?.isSending, true);

  const failed = play(
    [{ type: 'question_failed', questionId: 'q1', message: 'No longer waiting.' }],
    sending,
  );
  assert.equal(failed.question?.isSending, false);
  assert.equal(failed.question?.error, 'No longer waiting.');

  const other = play([{ type: 'question_sending', questionId: 'q-old' }], failed);
  assert.equal(other, failed, 'an answer to another question changes nothing');

  const finished = play([{ type: 'finish', at }], failed);
  assert.equal(finished.question, null);
});
