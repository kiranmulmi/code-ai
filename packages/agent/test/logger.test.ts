import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLogger } from '../src/logger.js';
import { describeArgs, formatDuration, formatLine, shortId } from '../src/log-format.js';

function capture(level: 'debug' | 'info' | 'silent' = 'info') {
  const lines: string[] = [];
  const logger = createLogger({ level, color: false, write: (line) => void lines.push(line) });
  return { logger, lines };
}

const usage = { inputTokens: 52_300, outputTokens: 1_900, cachedInputTokens: 40_000 };

test('a run reads as a timeline scoped by chat and sub-agent', () => {
  const { logger, lines } = capture();
  const chat = logger.scoped('c57da5a3');
  chat.record({
    type: 'run_start',
    prompt: 'fix the login bug',
    model: 'GPT 4.1',
    attachments: 1,
    skills: [],
  });
  chat.record({
    type: 'tool',
    name: 'read_file',
    args: '{"path":"src/auth.ts"}',
    ok: true,
    durationMs: 12,
    chars: 4200,
  });
  chat.scoped('researcher').record({ type: 'steer', text: 'also check signup' });
  chat.record({ type: 'run_end', status: 'done', steps: 6, tools: 9, durationMs: 61_000, usage });

  assert.match(lines[0] ?? '', /c57da5a3 +▶ "fix the login bug" +GPT 4\.1 · 1 file$/);
  assert.match(lines[1] ?? '', /▸ read_file {2}src\/auth\.ts +✓ 12ms · 4\.2k chars$/);
  assert.match(lines[2] ?? '', /c57da5a3 › researcher +✎ user added/);
  assert.match(
    lines[3] ?? '',
    /■ done +6 steps · 9 tools · 1m 1s · 52k in \(40k cached\) \/ 1\.9k out$/,
  );
});

test('model calls show only at debug; warnings always; silent shows nothing', () => {
  const call = {
    type: 'model_call' as const,
    kind: 'step' as const,
    model: 'gpt-4.1',
    durationMs: 2300,
    usage,
    finishReason: 'tool_calls',
    toolCalls: ['read_file'],
  };
  const info = capture('info');
  info.logger.record(call);
  info.logger.warn('careful');
  assert.equal(info.lines.length, 1);
  assert.match(info.lines[0] ?? '', /▲ careful/);

  const debug = capture('debug');
  debug.logger.record(call);
  assert.match(debug.lines[0] ?? '', /step → read_file +gpt-4\.1 · 2\.3s/);

  const silent = capture('silent');
  silent.logger.error('boom');
  assert.equal(silent.lines.length, 0);
});

test('a failed tool shows its error', () => {
  const { logger, lines } = capture();
  logger.record({
    type: 'tool',
    name: 'edit_file',
    args: '{"path":"a.ts"}',
    ok: false,
    durationMs: 3,
    chars: 30,
    error: 'old text not found',
    isRepeat: true,
  });
  assert.match(lines[0] ?? '', /✗ 3ms · old text not found · repeated$/);
});

test('helpers: ids, durations, arguments, colour only when asked', () => {
  assert.equal(shortId('/chats/c57da5a3-34b9-4674-ab4a-a3c8c2d7a0cd/x'), '/chats/c57da5a3/x');
  assert.equal(formatDuration(78), '78ms');
  assert.equal(formatDuration(1500), '1.5s');
  assert.equal(describeArgs('{"command":"npm test","timeout":5}'), 'npm test');
  assert.equal(describeArgs('{"a":1,"b":[2]}'), 'a=1 b=[2]');
  const line = { level: 'info' as const, scope: ['http'], text: 'x', time: new Date() };
  assert.ok(!formatLine(line, { color: false }).includes('\x1b['));
  assert.ok(formatLine(line, { color: true }).includes('\x1b['));
});
