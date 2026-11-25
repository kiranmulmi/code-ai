// Secrets: the agent's tools can't read secret files or this app's data folder, and secrets in
// any tool's output are masked before the model, the chat, the stream or the logs see them.
// Run with: npm run test -w @app/agent
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  REDACTED,
  isSecretFile,
  redactSecrets,
  refuseCommand,
  refuseSecretAccess,
} from '../src/guardrails.js';
import { createAgent } from '../src/agent.js';
import type { AgentLogger } from '../src/logger.js';
import type { CallModel, ModelReply, ModelRequest } from '../src/llm.js';
import { LongTermMemory } from '../src/memory/long-term.js';
import { Planner } from '../src/planner.js';
import { defineTool, type ToolContext } from '../src/tools/define.js';
import { readFile } from '../src/tools/files/read-file.js';
import { searchFiles } from '../src/tools/files/search-files.js';
import { copyPath } from '../src/tools/files/copy-path.js';
import { movePath } from '../src/tools/files/move-path.js';
import { runCommand } from '../src/tools/run-command.js';

// Fake tokens in the real formats, built here so no token-shaped string sits in the repo.
const fake = (prefix: string, length: number) =>
  `${prefix}${'a1B2c3D4e5'.repeat(8).slice(0, length)}`;
const GITHUB = fake('ghp_', 36);
const GITLAB = fake('glpat-', 26);
const OPENAI = fake('sk-proj-', 40);

const silentLogger: AgentLogger = {
  file: null,
  record() {},
  warn() {},
  error() {},
  scoped: () => silentLogger,
};

async function workspace(): Promise<{ dir: string; ctx: ToolContext }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-secrets-'));
  const write = (file: string, content: string) => fs.writeFile(path.join(dir, file), content);
  await write('.env', `OPENAI_API_KEY=${OPENAI}\n`);
  await write('.env.example', 'OPENAI_API_KEY=\n');
  await write('.mcp.json', `{ "headers": { "Authorization": "Bearer ${GITHUB}" } }`);
  await write('server.key', 'not really a key');
  await write('config.ts', `export const apiKey = process.env.OPENAI_API_KEY;\n`);
  const ctx: ToolContext = {
    planner: new Planner(),
    longTermMemory: new LongTermMemory(path.join(dir, 'unused-memory.json')),
    workspace: dir,
    searxngUrl: 'http://127.0.0.1:1',
    attachments: null,
    skills: null,
    loadTools: null,
    tasks: null,
    askUser: null,
    showImage: () => {},
  };
  return { dir, ctx };
}

test('isSecretFile: env files, MCP configs, credentials and keys, but not templates', () => {
  for (const file of [
    '.env',
    '.env.local',
    'apps/api/.env.production',
    '.mcp.json',
    '.npmrc',
    '.netrc',
    '.git-credentials',
    'aws/credentials',
    'certs/server.pem',
    'tls.key',
    '.ssh/id_ed25519',
  ]) {
    assert.ok(isSecretFile(file), file);
  }
  for (const file of [
    '.env.example',
    '.env.sample',
    '.env.template',
    'env.ts',
    'src/keys.ts',
    'package.json',
    'id_ed25519.pub',
    'README.md',
  ]) {
    assert.ok(!isSecretFile(file), file);
  }
});

test('read_file, search_files, copy_path and move_path keep secret files out', async () => {
  const { ctx } = await workspace();
  const refused = /holds keys or passwords/;
  await assert.rejects(readFile.run({ path: '.env' }, ctx), refused);
  await assert.rejects(readFile.run({ path: './.mcp.json' }, ctx), refused);
  await assert.rejects(readFile.run({ path: 'server.key' }, ctx), refused);
  assert.match(String(await readFile.run({ path: '.env.example' }, ctx)), /OPENAI_API_KEY=/);

  // A folder search skips them; naming one directly is refused.
  const found = String(await searchFiles.run({ query: 'OPENAI_API_KEY' }, ctx));
  assert.match(found, /\.env\.example:1/);
  assert.match(found, /config\.ts:1/);
  assert.doesNotMatch(found, /^\.env:/m);
  assert.ok(!found.includes(OPENAI));
  assert.doesNotMatch(String(await searchFiles.run({ query: 'Bearer' }, ctx)), /mcp\.json/);
  await assert.rejects(searchFiles.run({ query: 'KEY', path: '.env' }, ctx), refused);

  // No renaming a secret into something readable.
  await assert.rejects(copyPath.run({ from: '.env', to: 'env.txt' }, ctx), refused);
  await assert.rejects(movePath.run({ from: '.mcp.json', to: 'mcp.txt' }, ctx), refused);
});

test("run_command can't touch the app's data folders; the user's own terminal check is unchanged", async () => {
  for (const command of [
    'cat ~/.code-ai/models.json',
    'cat $HOME/.code-ai/mcp-servers.json',
    'ls -la .code-ai',
    'grep -r token ~/.Code-AI/',
  ]) {
    assert.ok(refuseSecretAccess(command), command);
    assert.equal(
      refuseCommand(command),
      null,
      `refuseCommand (shared with the terminal tab): ${command}`,
    );
  }
  for (const command of ['npm test', 'cat package.json', 'git status', 'ls -la']) {
    assert.equal(refuseSecretAccess(command), null, command);
  }
  const { ctx } = await workspace();
  await assert.rejects(runCommand.run({ command: 'cat ~/.code-ai/models.json' }, ctx), /not run/);
});

test('redactSecrets masks known token formats anywhere', () => {
  const jwt = `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.${'d1F2'.repeat(6)}`;
  const text = [
    `"credential": "${GITLAB}"`,
    `"Authorization": "Bearer ${GITHUB}"`,
    `token=${GITHUB}`,
    `key ${OPENAI} in the logs`,
    `github_pat_${'A1b2C3d4E5'.repeat(4)}`,
    `aws AKIA${'ABCD1234EFGH5678'}`,
    `session ${jwt}`,
    '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----',
  ].join('\n');
  const out = redactSecrets(text);
  for (const secret of [
    GITLAB,
    GITHUB,
    OPENAI,
    jwt,
    'b3BlbnNzaC1rZXktdjEAAAAA',
    'AKIAABCD1234EFGH5678',
  ]) {
    assert.ok(!out.includes(secret), `still shows ${secret.slice(0, 12)}…`);
  }
  assert.match(out, /"Authorization": "Bearer \[redacted\]"/);
  assert.match(out, /key \[redacted\] in the logs/);
});

test('redactSecrets masks values named as secrets, URL passwords, and leaves code alone', () => {
  const out = redactSecrets(
    [
      'DATABASE_PASSWORD=Xk29fjQ02mzpL',
      'export STRIPE_SECRET=Ab12Cd34Ef56Gh',
      `"apiKey": "f3a9c1e07b5d42e8a1c6"`,
      "client_secret: 'Zq81mN0pLw3e'",
      'postgres://admin:S3cr3tPass@db.local:5432/app',
    ].join('\n'),
  );
  for (const secret of [
    'Xk29fjQ02mzpL',
    'Ab12Cd34Ef56Gh',
    'f3a9c1e07b5d42e8a1c6',
    'Zq81mN0pLw3e',
    'S3cr3tPass',
  ]) {
    assert.ok(!out.includes(secret), secret);
  }
  assert.match(out, /postgres:\/\/admin:\[redacted\]@db\.local/);

  // Ordinary code and docs read as they are.
  const code = [
    'const token = await getToken();',
    'password: string;',
    `"apiKey": "not-set"`,
    'OPENAI_API_KEY=',
    'const secretName = "auth.session.token";',
    'see https://example.com/docs',
    'git@github.com:org/repo.git',
  ].join('\n');
  assert.equal(redactSecrets(code), code);
  assert.equal(redactSecrets(REDACTED), REDACTED);
});

test('the agent masks secrets in tool output before the model, the stream and the logs', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-secrets-data-'));
  const { dir } = await workspace();
  // An MCP-style tool that prints a secret, and one whose error message carries one.
  const leaky = defineTool<{ key: string }>({
    name: 'mcp__demo__show',
    description: 'Show a config.',
    properties: { key: { type: 'string', description: 'Which one.' } },
    async run({ key }) {
      if (key === 'fail') throw new Error(`401 for Bearer ${GITHUB}`);
      return `{ "credential": "${GITLAB}", "name": "demo" }`;
    },
  });
  const requests: ModelRequest[] = [];
  const replies: ModelReply[] = [
    {
      role: 'assistant',
      content: '',
      refusal: null,
      tool_calls: [
        {
          id: 't1',
          type: 'function',
          function: { name: 'mcp__demo__show', arguments: '{"key":"a"}' },
        },
        {
          id: 't2',
          type: 'function',
          function: { name: 'mcp__demo__show', arguments: '{"key":"fail"}' },
        },
      ],
    },
    { role: 'assistant', content: 'Done.', refusal: null, tool_calls: [] },
  ];
  const callModel: CallModel = async (request) => {
    requests.push(
      structuredClone({
        ...request,
        onText: undefined,
        onOutput: undefined,
        onReasoning: undefined,
      }),
    );
    const message = replies.shift();
    if (!message) throw new Error('fake model ran out of replies');
    return {
      message,
      finishReason: message.tool_calls?.length ? 'tool_calls' : 'stop',
      model: 'fake',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  };
  const logged: string[] = [];
  const streamed: string[] = [];
  const agent = createAgent({
    filesDir: dir,
    longTermMemory: new LongTermMemory(path.join(dataDir, 'memory.json')),
    extraTools: [leaky],
    callModel,
    config: { planning: 'off', review: 'off', approval: 'auto' },
    logger: { ...silentLogger, record: (entry) => void logged.push(JSON.stringify(entry)) },
    onEvent: (event) => void streamed.push(JSON.stringify(event)),
  });
  const result = await agent.run('Show the demo config.');
  assert.equal(result.status, 'done');

  const sent = JSON.stringify(requests.at(-1)?.messages ?? []);
  assert.match(sent, /"credential\\": \\"\[redacted\]\\"/);
  assert.match(sent, /401 for Bearer \[redacted\]/);
  for (const [where, text] of [
    ['model', sent],
    ['stream', streamed.join('\n')],
    ['log', logged.join('\n')],
  ] as const) {
    assert.ok(!text.includes(GITLAB), `${where} shows the GitLab token`);
    assert.ok(!text.includes(GITHUB), `${where} shows the GitHub token`);
  }
});
