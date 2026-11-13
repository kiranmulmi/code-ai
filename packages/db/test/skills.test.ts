// Offline tests for a workspace's skills: .nimbrio-ai/skills/<name>.md, and skill folders
// uploaded as <name>/SKILL.md with files of their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SKILL_LIMITS } from '@app/shared';
import { InputError } from '../src/errors.js';
import {
  SkillExistsError,
  WorkspaceSkills,
  parseSkillFile,
  splitSkillPath,
  type SkillUploadFile,
} from '../src/workspace-skills.js';

async function tempSkills(): Promise<WorkspaceSkills> {
  return new WorkspaceSkills(await fs.mkdtemp(path.join(os.tmpdir(), 'agent-skills-test-')));
}

const FIX = {
  name: 'jira-ticket-fix',
  description: 'When the user gives a Jira ticket\nto check or fix.',
  body: 'Phase 1: verify.\n\nPhase 2: propose, then stop.',
};

test('a skill is saved as Markdown with front matter and read back', async () => {
  const skills = await tempSkills();
  const created = await skills.create(FIX);
  assert.equal(created.description, 'When the user gives a Jira ticket to check or fix.');
  assert.equal(created.body, FIX.body);
  assert.ok(created.updatedAt);

  const text = await fs.readFile(path.join(skills.dir, 'jira-ticket-fix.md'), 'utf8');
  assert.equal(
    text,
    '---\nname: jira-ticket-fix\ndescription: When the user gives a Jira ticket to check or fix.\n---\n\nPhase 1: verify.\n\nPhase 2: propose, then stop.\n',
  );
  const ignore = path.join(skills.folder, '.nimbrio-ai', '.gitignore');
  assert.ok(await fs.stat(ignore), 'the data folder keeps its .gitignore');
  assert.deepEqual(
    (await skills.list()).map((s) => s.name),
    ['jira-ticket-fix'],
  );
});

test('names are unique, renames move the file, and removing reports what happened', async () => {
  const skills = await tempSkills();
  await skills.create(FIX);
  await skills.create({ ...FIX, name: 'code-review' });
  await assert.rejects(skills.create(FIX), SkillExistsError);
  await assert.rejects(skills.update('code-review', FIX), SkillExistsError);

  const renamed = await skills.update('jira-ticket-fix', { ...FIX, name: 'ticket-fix' });
  assert.equal(renamed?.name, 'ticket-fix');
  assert.equal(await skills.get('jira-ticket-fix'), null);
  assert.equal(await skills.update('gone', FIX), null);

  assert.equal(await skills.remove('ticket-fix'), true);
  assert.equal(await skills.remove('ticket-fix'), false);
  assert.deepEqual(
    (await skills.list()).map((s) => s.name),
    ['code-review'],
  );
});

test('only valid names map to files, links are not followed, and hand-written files are read', async () => {
  const skills = await tempSkills();
  assert.equal(await skills.get('../settings'), null);
  assert.equal(await skills.remove('../../etc/passwd'), false);

  await fs.mkdir(skills.dir, { recursive: true });
  const outside = path.join(skills.folder, 'secret.md');
  await fs.writeFile(outside, 'not a skill');
  await fs.symlink(outside, path.join(skills.dir, 'linked.md'));
  await fs.writeFile(path.join(skills.dir, 'Bad Name.md'), 'ignored');
  await fs.writeFile(
    path.join(skills.dir, 'by-hand.md'),
    '---\r\nname: whatever\r\ndescription: "Quoted, by hand"\r\n---\r\nDo it this way.\r\n',
  );
  await fs.writeFile(path.join(skills.dir, 'plain.md'), 'No front matter at all.');

  assert.equal(await skills.get('linked'), null);
  const list = await skills.list();
  assert.deepEqual(
    list.map((s) => [s.name, s.description, s.body]),
    [
      ['by-hand', 'Quoted, by hand', 'Do it this way.'],
      ['plain', '', 'No front matter at all.'],
    ],
  );
  assert.deepEqual(parseSkillFile('---\ndescription: x\n---\n'), { description: 'x', body: '' });
});

// ---------- Skill folders ----------

const MAIN = `---
name: corporate-navy-teal
description: Design system for corporate sites in navy and teal.
---

# Corporate Navy & Teal

Start with \`assets/design-system.css\`. Read \`references/tokens.md\` before rebranding.
`;

const file = (filePath: string, text: string): SkillUploadFile => ({
  path: filePath,
  bytes: Buffer.from(text),
});

/** A folder as a browser's folder picker gives it: every path starts with the folder's name. */
const FOLDER = [
  file('corporate-navy-teal/SKILL.md', MAIN),
  file('corporate-navy-teal/assets/design-system.css', ':root { --c-primary: #14305d; }'),
  file('corporate-navy-teal/references/tokens.md', '# Tokens\nNavy #14305d'),
  file('corporate-navy-teal/.DS_Store', 'junk'),
];

test('a skill folder is uploaded whole, listed with its files, and its files are read back', async () => {
  const skills = await tempSkills();
  await skills.create(FIX); // a single-file skill lives beside it
  const skill = await skills.upload(FOLDER);

  assert.equal(skill.name, 'corporate-navy-teal');
  assert.equal(skill.description, 'Design system for corporate sites in navy and teal.');
  assert.match(skill.body, /^# Corporate Navy & Teal/);
  assert.deepEqual(
    skill.files?.map((f) => f.path),
    ['assets/design-system.css', 'references/tokens.md'],
  );
  const folder = path.join(skills.dir, 'corporate-navy-teal');
  assert.ok((await fs.stat(path.join(folder, 'SKILL.md'))).isFile());
  await assert.rejects(fs.stat(path.join(folder, '.DS_Store')), /ENOENT/);

  assert.deepEqual(
    (await skills.list()).map((s) => [s.name, s.files?.length ?? 0]),
    [
      ['corporate-navy-teal', 2],
      ['jira-ticket-fix', 0],
    ],
  );
  assert.equal(
    (await skills.readFile('corporate-navy-teal', 'references/tokens.md'))?.toString(),
    '# Tokens\nNavy #14305d',
  );
  assert.equal(await skills.readFile('corporate-navy-teal', 'references/missing.md'), null);
  assert.equal(await skills.readFile('jira-ticket-fix', 'anything.md'), null);
  // No staging folder is left behind.
  assert.deepEqual(
    (await fs.readdir(skills.dir)).filter((n) => n.startsWith('.')),
    [],
  );
});

test('a skill folder without the folder name in its paths works too, named by its front matter', async () => {
  const skills = await tempSkills();
  const skill = await skills.upload([
    file('SKILL.md', MAIN.replace('corporate-navy-teal', 'brand-kit')),
    file('notes/a.md', 'A'),
  ]);
  assert.equal(skill.name, 'brand-kit');
  assert.deepEqual(
    skill.files?.map((f) => f.path),
    ['notes/a.md'],
  );
});

test('reading a skill file never leaves the skill folder or follows a link', async () => {
  const skills = await tempSkills();
  await skills.upload(FOLDER);
  const folder = path.join(skills.dir, 'corporate-navy-teal');
  await fs.writeFile(path.join(skills.folder, 'secret.txt'), 'secret');
  await fs.symlink(path.join(skills.folder, 'secret.txt'), path.join(folder, 'linked.txt'));
  await fs.symlink(skills.folder, path.join(folder, 'up'));

  for (const bad of [
    '../../../secret.txt',
    'references/../../memory.json',
    '/etc/passwd',
    'C:/Windows/win.ini',
    'linked.txt',
    'up/secret.txt',
    'references',
    '',
  ]) {
    assert.equal(await skills.readFile('corporate-navy-teal', bad), null, bad);
  }
  assert.equal(await skills.readFile('../skills', 'SKILL.md'), null);
  // Links are not listed as the skill's files either.
  assert.deepEqual(
    (await skills.get('corporate-navy-teal'))?.files?.map((f) => f.path),
    ['assets/design-system.css', 'references/tokens.md'],
  );
});

test('unsafe or invalid uploads are refused with what is wrong, and leave nothing behind', async () => {
  const skills = await tempSkills();
  const cases: [SkillUploadFile[], RegExp][] = [
    [[file('readme.md', 'x')], /needs a SKILL\.md at its top/],
    [[file('kit/docs/SKILL.md', MAIN)], /needs a SKILL\.md at its top/],
    [[file('SKILL.md', MAIN), file('../escape.md', 'x')], /isn't a valid path/],
    [[file('SKILL.md', MAIN), file('/etc/passwd', 'x')], /isn't a valid path/],
    [[file('SKILL.md', MAIN), file('a/./b.md', 'x')], /isn't a valid path/],
    [
      [file('SKILL.md', '---\nname: Bad Name\ndescription: x\n---\nDo it.')],
      /can't be a skill name/,
    ],
    [[file('SKILL.md', '---\nname: no-description\n---\nDo it.')], /needs a "description:" line/],
    [[file('SKILL.md', '---\nname: no-body\ndescription: x\n---\n')], /has no instructions/],
    [[file('SKILL.md', MAIN), file('a.md', '1'), file('A.md', '2')], /in the upload twice/],
    [[file('SKILL.md', MAIN), file('a', '1'), file('a/b.md', '2')], /both a file and a folder/],
    [
      [
        file('SKILL.md', MAIN),
        { path: 'big.bin', bytes: Buffer.alloc(SKILL_LIMITS.fileBytes + 1) },
      ],
      /too large/,
    ],
    [
      [
        file('SKILL.md', MAIN),
        ...Array.from({ length: SKILL_LIMITS.fileCount }, (_, i) => file(`f${i}.md`, 'x')),
      ],
      /at most \d+ files/,
    ],
  ];
  for (const [files, message] of cases) {
    await assert.rejects(skills.upload(files), (error: unknown) => {
      assert.ok(error instanceof InputError, String(error));
      assert.match(error.message, message);
      return true;
    });
  }
  assert.deepEqual(await skills.list(), []);
  assert.equal(splitSkillPath('./assets/a.css')?.join('/'), 'assets/a.css');
  assert.equal(splitSkillPath('assets\\a.css')?.join('/'), 'assets/a.css');
});

test('a taken name needs replace, which swaps the whole folder; edits keep the files', async () => {
  const skills = await tempSkills();
  await skills.upload(FOLDER);
  await assert.rejects(skills.upload(FOLDER), SkillExistsError);
  await skills.create({ ...FIX, name: 'brand-kit' });
  await assert.rejects(
    skills.upload([file('SKILL.md', MAIN.replace('corporate-navy-teal', 'brand-kit'))]),
    SkillExistsError,
  );

  const replaced = await skills.upload(
    [file('kit/SKILL.md', MAIN), file('kit/references/layouts.md', '# Layouts')],
    { replace: true },
  );
  assert.deepEqual(
    replaced.files?.map((f) => f.path),
    ['references/layouts.md'],
  );
  assert.equal(await skills.readFile('corporate-navy-teal', 'references/tokens.md'), null);

  // Editing in the Skills tab rewrites SKILL.md only; a rename moves the folder.
  const edited = await skills.update('corporate-navy-teal', {
    name: 'navy-teal',
    description: 'Edited.',
    body: 'New instructions.',
  });
  assert.equal(edited?.body, 'New instructions.');
  assert.deepEqual(
    edited?.files?.map((f) => f.path),
    ['references/layouts.md'],
  );
  assert.equal(await skills.get('corporate-navy-teal'), null);
  assert.equal(
    (await skills.readFile('navy-teal', 'references/layouts.md'))?.toString(),
    '# Layouts',
  );

  // Removing a folder skill removes its files.
  assert.equal(await skills.remove('navy-teal'), true);
  await assert.rejects(fs.stat(path.join(skills.dir, 'navy-teal')), /ENOENT/);
  assert.deepEqual(
    (await skills.list()).map((s) => s.name),
    ['brand-kit'],
  );
});

test('front matter descriptions written as YAML blocks are read as one line', async () => {
  assert.equal(
    parseSkillFile(
      '---\nname: x\ndescription: >\n  Use when building\n  a corporate site.\nother: y\n---\nBody',
    ).description,
    'Use when building a corporate site.',
  );
});
