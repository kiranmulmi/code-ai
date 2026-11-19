// Offline tests for the live elapsed time shown while a request runs.
// Run with: npm run test -w @app/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conversationReducer,
  initialConversation,
  type ConversationAction,
} from '../src/features/chat/conversation';
import { formatElapsed } from '../src/lib/format';

const send = (at: number): ConversationAction => ({
  type: 'send',
  text: 'Do it',
  attachments: [],
  skills: [],
  at,
});

test('formatElapsed reads as seconds, then minutes, then hours', () => {
  assert.equal(formatElapsed(0), '0s');
  assert.equal(formatElapsed(8.9), '8s');
  assert.equal(formatElapsed(65), '1m 05s');
  assert.equal(formatElapsed(3_725), '1h 02m');
  assert.equal(formatElapsed(-3), '0s');
});

test('a request is timed from when it was sent until it finishes', () => {
  const running = conversationReducer(initialConversation, send(5_000));
  assert.equal(running.runStartedAt, 5_000);

  // A message sent while it runs doesn't restart the clock.
  const again = conversationReducer(running, send(9_000));
  assert.equal(again.runStartedAt, 5_000);

  const finished = conversationReducer(again, { type: 'finish', at: 20_000 });
  assert.equal(finished.runStartedAt, null);

  const next = conversationReducer(finished, send(30_000));
  assert.equal(next.runStartedAt, 30_000);
});

test('the done event stops the clock too', () => {
  const running = conversationReducer(initialConversation, send(1_000));
  const done = conversationReducer(running, {
    type: 'event',
    at: 4_000,
    event: {
      type: 'done',
      result: {
        status: 'done',
        text: 'Done.',
        steps: 1,
        usage: { inputTokens: 1, outputTokens: 1 },
        calls: [],
      },
    } as unknown as Extract<ConversationAction, { type: 'event' }>['event'],
  });
  assert.equal(done.runStartedAt, null);
});
