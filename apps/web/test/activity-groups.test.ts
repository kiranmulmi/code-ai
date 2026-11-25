// Offline tests for how a turn splits into activity cards and the answer around them.
// Run with: npm run test -w @app/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityGroups, activityStats } from '../src/features/chat/activityGroups';
import type { Block } from '../src/features/chat/flowSections';
import type { TextItem, ToolItem } from '../src/features/chat/conversation';

const text = (key: string, extra: Partial<TextItem> = {}): TextItem => ({
  kind: 'text',
  key,
  text: key,
  isOpen: false,
  isInterim: false,
  isError: false,
  ...extra,
});
const tool = (key: string, state: ToolItem['state'] = 'ok'): ToolItem => ({
  kind: 'tool',
  key,
  callId: key,
  name: 'read_file',
  args: '{}',
  state,
  result: '',
});
const tools = (key: string, ...items: ToolItem[]): Block => ({ kind: 'tools', key, items });

test('narration and tool calls share one card; the answer stands alone after it', () => {
  const groups = activityGroups([
    { kind: 'thought', key: 't', startedAt: null, durationMs: 2000 },
    text('n1', { isInterim: true }),
    tools('r1', tool('a'), tool('b')),
    text('n2', { isInterim: true }),
    tools('r2', tool('c', 'error')),
    text('answer'),
  ]);
  assert.deepEqual(
    groups.map((g) => (g.kind === 'activity' ? `activity×${g.sections.length}` : g.key)),
    ['activity×5', 'answer'],
  );
  const first = groups[0];
  assert.equal(first?.kind, 'activity');
  if (first?.kind !== 'activity') return;
  const stats = activityStats(first.sections);
  assert.equal(stats.tools.length, 3);
  assert.equal(stats.failed, 1);
  assert.equal(stats.thoughtMs, 2000);
});

test('an approval or error splits the work into separate cards', () => {
  const groups = activityGroups([
    tools('r1', tool('a')),
    {
      kind: 'approval',
      key: 'ap',
      approvalId: 'x',
      tool: 'run_command',
      input: {},
      subagent: null,
      specialist: null,
      state: 'pending',
      error: null,
    },
    tools('r2', tool('b')),
    text('err', { isError: true }),
  ]);
  assert.deepEqual(
    groups.map((g) => g.kind),
    ['activity', 'standalone', 'activity', 'standalone'],
  );
});

test('plan steps count toward the card and their tools are summed', () => {
  const groups = activityGroups([
    {
      kind: 'section',
      key: 's1',
      step: { kind: 'step', key: 's1', callId: null, planKey: null, number: 1 },
      blocks: [tools('r1', tool('a'), tool('b'))],
    },
    {
      kind: 'section',
      key: 's2',
      step: { kind: 'step', key: 's2', callId: null, planKey: null, number: 2 },
      blocks: [],
    },
  ]);
  assert.equal(groups.length, 1);
  const only = groups[0];
  if (only?.kind !== 'activity') return assert.fail('expected an activity card');
  const stats = activityStats(only.sections);
  assert.equal(stats.steps, 2);
  assert.equal(stats.tools.length, 2);
});
