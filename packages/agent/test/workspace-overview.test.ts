import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { workspaceOverview } from '../src/workspace-overview.js';
import { decide } from '../src/planner.js';
import { systemPromptSections } from '../src/prompt.js';
import { APP_DATA_FOLDER } from '../src/guardrails.js';

async function tempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'overview-'));
  await fs.mkdir(path.join(dir, 'src', 'routes'), { recursive: true });
  await fs.mkdir(path.join(dir, 'node_modules', 'left-pad'), { recursive: true });
  await fs.mkdir(path.join(dir, '.git'));
  await fs.mkdir(path.join(dir, APP_DATA_FOLDER));
  await fs.writeFile(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n');
  await fs.writeFile(path.join(dir, APP_DATA_FOLDER, 'secret.json'), '{}');
  await fs.writeFile(path.join(dir, 'node_modules', 'left-pad', 'index.js'), '');
  await fs.writeFile(path.join(dir, 'src', 'index.ts'), 'export {};');
  await fs.writeFile(path.join(dir, 'src', 'routes', 'notify.ts'), 'export {};');
  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'mt-notification-service', description: 'Sends notifications' }),
  );
  await fs.writeFile(path.join(dir, 'README.md'), '# Readme\nThe readme.');
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), '# Notes\nA notification service.');
  return dir;
}

test('the overview lists the project, its notes, package and branch', async () => {
  const dir = await tempProject();
  const text = await workspaceOverview(dir);
  assert.match(text, /^Folder: overview-/);
  assert.match(text, /Package: mt-notification-service: Sends notifications/);
  assert.match(text, /Git branch: feature\/x/);
  assert.match(text, /^src\/$/m);
  assert.match(text, /^src\/index\.ts$/m);
  assert.match(text, /^src\/routes\/$/m);
  assert.doesNotMatch(text, /notify\.ts/, 'only two levels deep');
  assert.match(text, /^node_modules\/$/m, 'generated folders listed...');
  assert.doesNotMatch(text, /left-pad/, '...but not entered');
  assert.doesNotMatch(text, /\.git\//);
  assert.ok(!text.includes(APP_DATA_FOLDER), "the app's data stays out");
  assert.doesNotMatch(text, /secret\.json/);
  assert.match(
    text,
    /Start of CLAUDE\.md:\n# Notes\nA notification service\./,
    'agent notes first',
  );
  assert.doesNotMatch(text, /The readme/);
});

test('the overview is bounded and never throws', async () => {
  const dir = await tempProject();
  for (let i = 0; i < 30; i++) await fs.writeFile(path.join(dir, `file-${i}.txt`), '');
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), 'x'.repeat(5_000));
  const text = await workspaceOverview(dir, { maxEntries: 10, docChars: 100 });
  assert.match(text, /not all shown/);
  const files = text.split('Files')[1]?.split('\n\n')[0] ?? '';
  assert.equal(files.split('\n').length - 1, 10);
  assert.match(text, /x{100}\n…$/);
  assert.equal(await workspaceOverview(path.join(dir, 'missing')), '');
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'overview-empty-'));
  assert.equal(await workspaceOverview(empty), '');
});

test('the overview reaches the system prompt and the planner as data', async () => {
  const sections = systemPromptSections(null, '/w', '', '', [], { overview: 'Folder: w' });
  const section = sections.find((s) => s.label === 'Workspace overview');
  assert.ok(section);
  assert.match(section.text, /<workspace_overview>\nFolder: w\n<\/workspace_overview>/);
  assert.ok(
    !systemPromptSections(null, '/w').some((s) => s.label === 'Workspace overview'),
    'no section without an overview',
  );

  let seen = '';
  await decide({
    callModel: async (request) => {
      seen = String(request.messages[0]?.content ?? '');
      return {
        message: { role: 'assistant', content: '{"mode":"direct","reason":"x"}' },
        usage: { input: 0, output: 0 },
      } as never;
    },
    system: 'planner',
    request: 'what is this project about?',
    history: [],
    currentPlan: null,
    overview: 'Folder: w',
  });
  assert.match(seen, /The workspace folder the agent works in:\nFolder: w/);
});
