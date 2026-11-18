import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stepSummary } from '../src/features/chat/tools';

test('a call with a reason is summarized by its reason', () => {
  const args = JSON.stringify({ command: 'grep -rn foo .', reason: '  Find where foo is used.  ' });
  assert.deepEqual(stepSummary(args), { text: 'Find where foo is used.', isReason: true });
});

test('a call without a reason falls back to its arguments', () => {
  assert.deepEqual(stepSummary(JSON.stringify({ command: 'ls' })), {
    text: 'command: ls',
    isReason: false,
  });
  assert.deepEqual(stepSummary(JSON.stringify({ command: 'ls', reason: ' ' })), {
    text: 'command: ls, reason:  ',
    isReason: false,
  });
});
