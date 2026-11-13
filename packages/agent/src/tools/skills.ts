// The workspace's skills: load one (use_skill), and read or copy the files a skill uploaded as
// a folder comes with (read_skill_file, copy_skill_file). Skills live in the app's data folder,
// which the file tools can't reach, so these go through the SkillStore and only ever see the
// skill's own files.
import fs from 'node:fs/promises';
import path from 'node:path';
import { formatBytes, type Skill } from '@app/shared';
import { assertCanChange } from '../guardrails.js';
import { defineTool, type ToolContext } from './define.js';
import { isBinary, locate } from './files/walk.js';

/** Kept under the tool output limit, so a long file is cut at a line, with a note. */
const MAX_CHARS = 18_000;

async function findSkill(ctx: ToolContext, name: string): Promise<Skill> {
  if (!ctx.skills) throw new Error('This workspace has no skills.');
  const skill = await ctx.skills.get(name.trim());
  if (skill) return skill;
  const names = (await ctx.skills.list()).map((s) => s.name);
  throw new Error(
    `No skill is called "${name}". ${names.length ? `The skills are: ${names.join(', ')}.` : 'This workspace has no skills.'}`,
  );
}

/** The bytes of one of the skill's files, or an error naming the files there are. */
async function skillFileBytes(ctx: ToolContext, skill: Skill, file: string): Promise<Buffer> {
  const wanted = file.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const files = skill.files ?? [];
  const listed = files.find((f) => f.path === wanted);
  const bytes = listed ? await ctx.skills?.readFile?.(skill.name, listed.path) : null;
  if (bytes) return bytes;
  throw new Error(
    files.length
      ? `The skill "${skill.name}" has no file "${file}". Its files are: ${files.map((f) => f.path).join(', ')}.`
      : `The skill "${skill.name}" has no files besides its instructions.`,
  );
}

/** A skill's files, as listed after its instructions (use_skill and picked skills). */
export function skillFilesNote(skill: Pick<Skill, 'name' | 'files'>): string {
  const files = skill.files ?? [];
  if (!files.length) return '';
  const lines = files.map((f) => `- ${f.path} (${formatBytes(f.size)})`);
  return `\n[Files in skill "${skill.name}". Paths in its instructions are relative to the skill's folder. Read one with read_skill_file when the instructions call for it; copy one into the workspace with copy_skill_file. The file tools can't reach them.]\n${lines.join('\n')}`;
}

export const useSkill = defineTool<{ name: string }>({
  name: 'use_skill',
  description:
    'Load one of the workspace\'s skills: instructions the user wrote for a kind of task (a workflow, a checklist, a house style). Call this before starting a task that matches a skill listed under "Skills in this workspace", then follow what it says. Don\'t call it for skills the user already picked for the message: those are in the message in full.',
  properties: {
    name: {
      type: 'string',
      description: 'The skill\'s name, exactly as listed, e.g. "jira-ticket-fix".',
    },
  },
  async run({ name }, ctx) {
    const skill = await findSkill(ctx, name);
    return `[Skill "${skill.name}", written by the user. Follow it for this task.]\n${skill.body}\n[End of skill "${skill.name}"]${skillFilesNote(skill)}`;
  },
});

export const readSkillFile = defineTool<{ skill: string; path: string; start_line?: number }>({
  name: 'read_skill_file',
  description:
    "Read one of the files a skill comes with (references, templates, examples), listed after the skill's instructions when you load it with use_skill. Call this when the skill's instructions point to one of its files. Long files come back in parts; continue with start_line.",
  properties: {
    skill: { type: 'string', description: 'The skill\'s name, e.g. "corporate-navy-teal".' },
    path: {
      type: 'string',
      description: 'The file\'s path inside the skill, as listed, e.g. "references/tokens.md".',
    },
    start_line: { type: 'integer', description: 'First line to read (1-based). Default 1.' },
  },
  optional: ['start_line'],
  async run({ skill: name, path: file, start_line: startLine }, ctx) {
    const skill = await findSkill(ctx, name);
    const bytes = await skillFileBytes(ctx, skill, file);
    const shown = `${skill.name}/${file.trim()}`;
    if (isBinary(bytes)) {
      return `"${shown}" is a binary file (${formatBytes(bytes.length)}). Copy it into the workspace with copy_skill_file if the project needs it.`;
    }
    const lines = bytes.toString('utf8').split('\n');
    const first = Math.max(startLine ?? 1, 1);
    if (first > lines.length) {
      throw new Error(`"${shown}" has ${lines.length} lines; start_line ${first} is past the end.`);
    }
    const taken: string[] = [];
    let chars = 0;
    for (let i = first - 1; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (chars + line.length > MAX_CHARS && taken.length > 0) break;
      taken.push(line);
      chars += line.length + 1;
    }
    const last = first + taken.length - 1;
    if (first === 1 && last === lines.length) return taken.join('\n');
    const more = last < lines.length ? ` Continue with start_line ${last + 1}.` : '';
    return `[${shown}: lines ${first}-${last} of ${lines.length}.${more}]\n${taken.join('\n')}`;
  },
});

export const copySkillFile = defineTool<{ skill: string; path: string; to: string }>({
  name: 'copy_skill_file',
  description:
    'Copy one of the files a skill comes with (a stylesheet, a template, an image) into the workspace folder, unchanged. Call this when the skill says to add one of its files to the project. Never overwrites: it fails if the destination exists.',
  properties: {
    skill: { type: 'string', description: 'The skill\'s name, e.g. "corporate-navy-teal".' },
    path: {
      type: 'string',
      description: 'The file\'s path inside the skill, as listed, e.g. "assets/design-system.css".',
    },
    to: {
      type: 'string',
      description: 'Where to put the copy, relative to the workspace folder, with the file name.',
    },
  },
  needsApproval: true,
  async run({ skill: name, path: file, to }, ctx) {
    const skill = await findSkill(ctx, name);
    const bytes = await skillFileBytes(ctx, skill, file);
    const destination = await locate(ctx, to);
    await assertCanChange(destination.root, destination.target);
    if (await fs.stat(destination.target).catch(() => null)) {
      throw new Error(`"${destination.shown}" already exists. Pick another path.`);
    }
    await fs.mkdir(path.dirname(destination.target), { recursive: true });
    await fs.writeFile(destination.target, bytes, { flag: 'wx' });
    return `Copied "${file.trim()}" from the skill "${skill.name}" (${formatBytes(bytes.length)}) to ${destination.shown}.`;
  },
});
