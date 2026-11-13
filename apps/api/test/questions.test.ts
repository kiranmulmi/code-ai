// Offline tests for the questions a run asks (ask_user): sent on the stream, answered by id.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StreamEvent } from '@app/shared';
import { RunRegistry } from '../src/features/runs/run-registry.js';

const question = { question: 'Which title?', options: [{ label: 'A' }, { label: 'B' }] };

function openQuestion(sent: StreamEvent[]): string {
  const event = sent.find((e) => e.type === 'question');
  assert.ok(event?.type === 'question', 'a question event was sent');
  return event.id;
}

test('a question waits for its answer, which closes it on the stream', async () => {
  const registry = new RunRegistry();
  const sent: StreamEvent[] = [];
  const { askUser } = registry.createAsker((event) => sent.push(event));

  const pending = askUser(question);
  const id = openQuestion(sent);
  assert.deepEqual(sent[0], { type: 'question', id, ...question });

  assert.equal(registry.answer(id, { type: 'answered', text: 'B' }), true);
  assert.deepEqual(await pending, { type: 'answered', text: 'B' });
  assert.deepEqual(sent[1], {
    type: 'question_closed',
    id,
    answer: { type: 'answered', text: 'B' },
  });
  assert.equal(registry.answer(id, { type: 'skipped' }), false, 'answered only once');
});

test('when the tab goes away or the run stops, open questions count as skipped', async () => {
  const registry = new RunRegistry();
  const sent: StreamEvent[] = [];
  const { askUser, skipAll } = registry.createAsker((event) => sent.push(event));

  const pending = askUser(question);
  const id = openQuestion(sent);
  skipAll();
  assert.deepEqual(await pending, { type: 'skipped' });
  assert.equal(registry.answer(id, { type: 'answered', text: 'A' }), false);
});
