// Offline tests for a workspace's own specialist sub-agents: .nimbrio-ai/agents/<name>.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { specialistInputSchema, type SpecialistInput } from '@app/shared';
import { InputError } from '../src/errors.js';
import {
  AGENT_LIMITS,
  AgentExistsError,
  WorkspaceAgents,
  formatAgentFile,
  parseAgentFile,
} from '../src/workspace-agents.js';

async function tempAgents(files: Record<string, string> = {}): Promise<WorkspaceAgents> {
  const agents = new WorkspaceAgents(await fs.mkdtemp(path.join(os.tmpdir(), 'agents-test-')));
  if (Object.keys(files).length) await fs.mkdir(agents.dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    await fs.writeFile(path.join(agents.dir, name), text);
  }
  return agents;
}

const AUDITOR = `---
name: security-auditor
description: >
  Checking code for security problems:
  injection, secrets, unsafe input.
tools: files, web
read_only: true
model: review
---

You are the team's security auditor.`;

test('a specialist file is read with its tools, read-only flag, model and role', () => {
  assert.deepEqual(parseAgentFile('security-auditor', AUDITOR), {
    name: 'security-auditor',
    description: 'Checking code for security problems: injection, secrets, unsafe input.',
    instructions: "You are the team's security auditor.",
    toolGroups: ['files', 'web'],
    readOnly: true,
    model: 'review',
  });
});

test('left-out fields fall back: every tool group, may change things, the sub-agent model', () => {
  const parsed = parseAgentFile('helper', '---\ndescription: Anything.\n---\nHelp.');
  assert.deepEqual(parsed, {
    name: 'helper',
    description: 'Anything.',
    instructions: 'Help.',
    toolGroups: ['files', 'commands', 'web', 'memory', 'plans'],
  });
  // The YAML list form works too.
  const listed = parseAgentFile('x', '---\ndescription: d\ntools: [web, memory]\n---\n');
  assert.ok(!('problem' in listed));
  assert.deepEqual(listed.toolGroups, ['web', 'memory']);
});

test('broken files say what is wrong', () => {
  const problem = (name: string, text: string) => {
    const parsed = parseAgentFile(name, text);
    return 'problem' in parsed ? parsed.problem : '';
  };
  assert.match(problem('Bad Name', '---\ndescription: d\n---\n'), /file name/);
  assert.match(problem('x', 'no front matter at all'), /description/);
  assert.match(problem('x', '---\ndescription: d\ntools: files, wifi\n---\n'), /"wifi"/);
  assert.match(problem('x', '---\ndescription: d\nread_only: maybe\n---\n'), /read_only/);
  assert.match(problem('x', '---\ndescription: d\nmodel: gpt-5\n---\n'), /model/);
  assert.match(
    problem('x', `---\ndescription: ${'x'.repeat(AGENT_LIMITS.descriptionLength + 1)}\n---\n`),
    /under/,
  );
});

test('the folder lists good specialists by name and reports the rest', async () => {
  const agents = await tempAgents({
    'security-auditor.md': AUDITOR,
    'broken.md': 'nothing here',
    'notes.txt': 'not a specialist',
  });
  assert.deepEqual(
    (await agents.list()).map((s) => s.name),
    ['security-auditor'],
  );
  const problems = await agents.problems();
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.file, 'broken.md');
});

test('no agents folder: no specialists', async () => {
  const agents = await tempAgents();
  assert.deepEqual(await agents.list(), []);
  assert.deepEqual(await agents.problems(), []);
});

test('links are not followed', async () => {
  const agents = await tempAgents({ 'real.md': '---\ndescription: d\n---\n' });
  const outside = path.join(agents.folder, 'outside.md');
  await fs.writeFile(outside, '---\ndescription: from outside\n---\n');
  await fs.symlink(outside, path.join(agents.dir, 'linked.md'));
  assert.deepEqual(
    (await agents.list()).map((s) => s.name),
    ['real'],
  );
});

// ---------- Saving from the Agents tab ----------

const input = (overrides: Partial<SpecialistInput> = {}) =>
  specialistInputSchema.parse({
    name: 'security-auditor',
    description: 'Checking code for\n security problems.',
    instructions: "You are the team's security auditor.",
    toolGroups: ['web', 'files'],
    readOnly: true,
    model: 'review',
    ...overrides,
  });

test('a saved specialist is written with every field and reads back the same', async () => {
  const agents = await tempAgents();
  const created = await agents.create(input());
  assert.deepEqual(
    { ...created, updatedAt: null },
    {
      name: 'security-auditor',
      description: 'Checking code for security problems.',
      instructions: "You are the team's security auditor.",
      // Kept in the app's order, whatever order they were picked in.
      toolGroups: ['files', 'web'],
      readOnly: true,
      model: 'review',
      isBuiltIn: false,
      updatedAt: null,
    },
  );
  assert.equal(
    await fs.readFile(path.join(agents.dir, 'security-auditor.md'), 'utf8'),
    "---\nname: security-auditor\ndescription: Checking code for security problems.\ntools: files, web\nread_only: true\nmodel: review\n---\n\nYou are the team's security auditor.\n",
  );
  // The data folder ignores itself in git, as for skills.
  await fs.access(path.join(agents.folder, '.nimbrio-ai', '.gitignore'));
  // What the file says is what the agent gets.
  const parsed = parseAgentFile('x', formatAgentFile(input({ name: 'x', instructions: '' })));
  assert.ok(!('problem' in parsed));
  assert.equal(parsed.instructions, '');
});

test('names are unique, renames move the file, and missing ones are null', async () => {
  const agents = await tempAgents();
  await agents.create(input());
  await assert.rejects(agents.create(input()), AgentExistsError);
  await agents.create(input({ name: 'other' }));
  await assert.rejects(agents.update('other', input()), AgentExistsError);

  const renamed = await agents.update('other', input({ name: 'auditor-two', readOnly: false }));
  assert.equal(renamed?.name, 'auditor-two');
  assert.equal(renamed?.readOnly, false);
  assert.deepEqual(
    (await agents.list()).map((s) => s.name),
    ['auditor-two', 'security-auditor'],
  );
  assert.equal(await agents.update('nobody', input()), null);
  assert.equal(await agents.get('nobody'), null);
});

test('saving fixes a broken file, and a broken file can be deleted by its file name', async () => {
  const agents = await tempAgents({ 'broken.md': 'no front matter', 'Bad_Name.md': 'x' });
  assert.equal((await agents.problems()).length, 2);
  assert.equal(await agents.get('broken'), null);

  const fixed = await agents.update('broken', input({ name: 'broken' }));
  assert.equal(fixed?.name, 'broken');
  assert.equal(await agents.remove('Bad_Name.md'), true);
  assert.deepEqual(await agents.problems(), []);

  assert.equal(await agents.remove('broken'), true);
  assert.equal(await agents.remove('broken'), false);
  // Only file names in the folder.
  assert.equal(await agents.remove('../settings.json'), false);
  assert.equal(await agents.remove('.hidden.md'), false);
});

test('deleting a link removes the link, not the file it points to', async () => {
  const agents = await tempAgents({ 'real.md': '---\ndescription: d\n---\n' });
  const outside = path.join(agents.folder, 'outside.md');
  await fs.writeFile(outside, 'keep me');
  await fs.symlink(outside, path.join(agents.dir, 'linked.md'));
  assert.equal((await agents.problems())[0]?.file, 'linked.md');
  assert.equal(await agents.remove('linked.md'), true);
  assert.equal(await fs.readFile(outside, 'utf8'), 'keep me');
});

test('the overview lists own specialists, then built-ins they do not replace, and problems', async () => {
  const agents = await tempAgents({ 'broken.md': 'nothing' });
  await agents.create(input());
  await agents.create(input({ name: 'coder', description: 'Our own coder.' }));
  const { specialists, problems } = await agents.overview();
  assert.deepEqual(
    specialists.map((s) => [s.name, s.isBuiltIn, s.replacesBuiltIn ?? false]),
    [
      ['coder', false, true],
      ['security-auditor', false, false],
      ['general', true, false],
      ['researcher', true, false],
      ['reviewer', true, false],
      ['writer', true, false],
    ],
  );
  assert.deepEqual(
    problems.map((p) => p.file),
    ['broken.md'],
  );
});

test('a workspace has room for a limited number of specialists', async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < AGENT_LIMITS.count; i++) files[`a${i}.md`] = '---\ndescription: d\n---\n';
  const agents = await tempAgents(files);
  await assert.rejects(agents.create(input()), InputError);
});
