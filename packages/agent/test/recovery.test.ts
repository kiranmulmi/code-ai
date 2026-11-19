// Recovering from model server failures: transient errors are retried, and a request that
// still fails is closed in the history so the next one doesn't follow an unanswered question.
// Run with: npm run test -w @app/agent
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createAgent } from '../src/agent.js';
import { createModelCaller, type CallModel } from '../src/llm.js';
import { Conversation } from '../src/memory/short-term.js';
import { LongTermMemory } from '../src/memory/long-term.js';
import type { AgentLogger } from '../src/logger.js';

const silentLogger = new Proxy({} as AgentLogger, {
  get: (_target, key) => (key === 'file' ? null : () => {}),
});

async function tempSetup() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-recovery-'));
  const filesDir = path.join(tmp, 'workspace');
  await fs.mkdir(filesDir, { recursive: true });
  return {
    filesDir,
    dataDir: path.join(tmp, 'data'),
    longTermMemory: new LongTermMemory(path.join(tmp, 'data', 'memory.json')),
  };
}

/** A fake Chat Completions server: each request gets the next scripted SSE body. */
async function fakeServer(bodies: string[]) {
  let hits = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const body = bodies[Math.min(hits, bodies.length - 1)] ?? '';
      hits++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    hits: () => hits,
    close: () => server.close(),
  };
}

const sse = (...events: unknown[]) =>
  events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
const timedOut = sse({ error: { message: 'Cloudflare Playground timed out' } });
const reply = (text: string) =>
  sse(
    { model: 'm', choices: [{ index: 0, delta: { content: text } }] },
    { model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  );

function caller(url: string): CallModel {
  return createModelCaller({
    label: 'Test',
    baseURL: url,
    apiKey: 'k',
    model: 'm',
    maxTokens: null,
    contextWindow: null,
    reasoningEffort: null,
  });
}

test('an error inside the stream before any output is retried', async () => {
  const server = await fakeServer([timedOut, reply('Hello.')]);
  try {
    const response = await caller(server.url)({
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(response.message.content, 'Hello.');
    assert.equal(server.hits(), 2);
  } finally {
    server.close();
  }
});

test('a server that keeps failing gives up with a readable error (no "undefined")', async () => {
  const server = await fakeServer([timedOut]);
  try {
    await assert.rejects(
      caller(server.url)({ system: 's', messages: [{ role: 'user', content: 'hi' }] }),
      (error: Error) => {
        assert.equal(error.message, 'Model server error: Cloudflare Playground timed out');
        return true;
      },
    );
    assert.equal(server.hits(), 3); // the first try and two retries
  } finally {
    server.close();
  }
});

test('a failed request is closed in the history, hidden from the chat', async () => {
  const setup = await tempSetup();
  const conversation = new Conversation();
  const seen: { messages: { role: string; content: unknown }[] }[] = [];
  let calls = 0;
  const callModel: CallModel = async (req) => {
    seen.push({ messages: structuredClone(req.messages) });
    if (calls++ === 0) throw new Error('Model server error: Cloudflare Playground timed out');
    return {
      model: 'fake',
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: 'stop',
      message: { role: 'assistant', content: 'Yes, I am here.' },
    };
  };
  const options = {
    ...setup,
    conversation,
    callModel,
    logger: silentLogger,
    config: { planning: 'off' as const, review: 'off' as const },
  };
  await assert.rejects(createAgent(options).run('what is this project about?'), /timed out/);
  await createAgent(options).run('hello are you still working?');

  // The second request sees the first one answered by a note that it failed.
  const sent = seen[1]?.messages ?? [];
  const note = sent.findIndex(
    (m) => m.role === 'assistant' && /No answer: this request failed/.test(String(m.content)),
  );
  assert.ok(note > 0, 'the failure note is sent to the model');
  assert.match(String(sent[note - 1]?.content), /what is this project about\?/);
  // The chat itself shows only what the user and the agent really said.
  assert.deepEqual(
    conversation.visible().map((m) => m.role),
    ['user', 'user', 'assistant'],
  );
  // And it survives a save and reload.
  const restored = Conversation.fromRows(conversation.rows());
  assert.equal(restored.visible().length, 3);
});
