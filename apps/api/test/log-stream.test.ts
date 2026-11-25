import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayPath, prettyLogLine } from '../src/log-stream.js';

const ID = 'dad25a73-736c-47de-b766-a54e1c94cae4';
const at = new Date(2025, 0, 1, 14, 2, 43).getTime();

test('a request reads as time, http, method, short path, status and duration', () => {
  const line = prettyLogLine(
    JSON.stringify({
      level: 30,
      time: at,
      pid: 1,
      hostname: 'mac',
      req: { id: 1, method: 'GET', url: `/v1/chats/${ID}` },
      res: { statusCode: 200 },
      responseTime: 78,
      msg: 'GET ...',
    }),
    false,
  );
  assert.match(line, /^14:02:43 {2}http +GET +\/chats\/dad25a73 +200 +78ms$/);
  assert.ok(!line.includes('hostname') && !line.includes('pid'));
});

test('a failed request shows its error and stack under it', () => {
  const err = { message: 'boom', stack: 'Error: boom\n    at handler (app.ts:1:1)' };
  const line = prettyLogLine(
    JSON.stringify({
      level: 50,
      time: at,
      req: { method: 'POST', url: '/v1/x' },
      res: { statusCode: 500 },
      responseTime: 3,
      err,
    }),
    false,
  );
  assert.match(line, /✖ POST +\/x +500 +3ms {2}boom/);
  assert.match(line, /│ +at handler \(app\.ts:1:1\)/);
});

test('other lines show the message and their own fields, and plain text passes through', () => {
  const line = prettyLogLine(JSON.stringify({ level: 40, time: at, msg: 'careful', n: 2 }), false);
  assert.match(line, /server +▲ careful +n=2$/);
  assert.equal(prettyLogLine('not json', false), 'not json');
});

test('paths lose the /v1 prefix and keep the first 8 characters of ids', () => {
  assert.equal(displayPath(`/v1/workspaces/${ID}/tasks`), '/workspaces/dad25a73/tasks');
  assert.equal(displayPath('/v1'), '/');
});
