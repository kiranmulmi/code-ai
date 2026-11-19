// A workspace's own specialist sub-agents, one Markdown file each:
//
//   <folder>/.hamro-ai/<workspace>/agents/<name>.md
//
//   ---
//   name: security-auditor
//   description: Checking code for security problems: injection, secrets, unsafe input.
//   tools: files, web
//   read_only: true
//   model: review
//   ---
//
//   You are the team's security auditor. …   (its role, added to its system prompt)
//
// The main agent can hand work to any of them with delegate_task, next to the built-in
// specialists (researcher, coder, reviewer, writer, general); one with a built-in's name
// replaces it. `description` is required: it is how the main agent picks. `tools` lists tool
// groups (files, commands, web, memory, plans); left out, it gets all of them. `read_only`
// (default false) leaves out every tool that changes things. `model` is `subagent` (the
// default: Settings → Agent → Sub-agent model) or `review` (the reviewer's model).
// A file that breaks these rules is left out, and `problems()` says why.
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AGENT_LIMITS,
  AGENT_NAME_PATTERN,
  TOOL_GROUPS,
  type AgentFileProblem,
  type SpecialistData,
  type SpecialistInfo,
  type SpecialistList,
  type ToolGroup,
} from '@app/shared';
import {
  BUILT_IN_SPECIALISTS,
  errorCode,
  serialized,
  writeFileAtomic,
  type Specialist,
} from '@app/agent';
import { InputError } from './errors.js';
import { WorkspaceData, workspaceDataDir } from './workspace-data.js';
import { frontMatterValue, splitFrontMatter } from './workspace-skills.js';

export { AGENT_LIMITS, type AgentFileProblem };

/** The name is taken by another of the workspace's specialists (the API answers 409). */
export class AgentExistsError extends Error {
  override name = 'AgentExistsError';
}

/** One specialist file, read and checked. */
type ReadFile =
  { file: string; specialist: Specialist; updatedAt: string } | { file: string; problem: string };

export class WorkspaceAgents {
  /** <folder>/.hamro-ai/<workspace>/agents */
  readonly dir: string;

  /** `name`: the workspace's, which names its data subfolder in `folder` */
  constructor(
    readonly folder: string,
    readonly name: string,
  ) {
    this.dir = path.join(workspaceDataDir(folder, name), 'agents');
  }

  /** The workspace's specialists, by name, for the agent. Broken files are left out. */
  async list(): Promise<Specialist[]> {
    const specialists: Specialist[] = [];
    for (const read of await this.#readAll()) {
      if ('specialist' in read) specialists.push(read.specialist);
    }
    return specialists;
  }

  /** Files in the agents folder that couldn't be used, and why. */
  async problems(): Promise<AgentFileProblem[]> {
    return (await this.#readAll()).flatMap((read) =>
      'problem' in read ? [{ file: read.file, problem: read.problem }] : [],
    );
  }

  /**
   * For the Agents tab: the workspace's own specialists first, then the built-ins they don't
   * replace, and the files that couldn't be used.
   */
  async overview(): Promise<SpecialistList> {
    const own: SpecialistInfo[] = [];
    const problems: AgentFileProblem[] = [];
    const builtInNames = new Set(BUILT_IN_SPECIALISTS.map((s) => s.name));
    for (const read of await this.#readAll()) {
      if ('problem' in read) {
        problems.push({ file: read.file, problem: read.problem });
        continue;
      }
      own.push({
        ...toInfo(read.specialist, false, read.updatedAt),
        ...(builtInNames.has(read.specialist.name) ? { replacesBuiltIn: true } : {}),
      });
    }
    const ownNames = new Set(own.map((s) => s.name));
    const builtIns = BUILT_IN_SPECIALISTS.filter((s) => !ownNames.has(s.name)).map((s) =>
      toInfo(s, true, null),
    );
    return { specialists: [...own, ...builtIns], problems };
  }

  /** One of the workspace's own specialists; null when there's none (or its file is broken). */
  async get(name: string): Promise<SpecialistInfo | null> {
    if (!isValidName(name)) return null;
    const text = await readSmallFile(this.#file(name));
    if (text === null) return null;
    const parsed = parseAgentFile(name, text.text);
    return 'problem' in parsed ? null : toInfo(parsed, false, text.updatedAt);
  }

  /** Throws AgentExistsError when the name is taken, InputError when the folder is full. */
  async create(input: SpecialistData): Promise<SpecialistInfo> {
    return serialized(this.dir, async () => {
      if (await this.#exists(input.name)) throw taken(input.name);
      if ((await this.#mdFiles()).length >= AGENT_LIMITS.count) {
        throw new InputError(
          `A workspace can have at most ${AGENT_LIMITS.count} specialists of its own.`,
        );
      }
      await this.#prepare();
      await fs.writeFile(this.#file(input.name), formatAgentFile(input), { flag: 'wx' });
      return this.#require(input.name);
    });
  }

  /**
   * Saves `name` as `input` (a different `input.name` renames it). Also fixes a broken file
   * with that name. Null when there's no such file.
   */
  async update(name: string, input: SpecialistData): Promise<SpecialistInfo | null> {
    return serialized(this.dir, async () => {
      if (!isValidName(name) || !(await this.#exists(name))) return null;
      const isRename = input.name !== name;
      if (isRename && (await this.#exists(input.name))) throw taken(input.name);
      if (isRename) {
        await fs.writeFile(this.#file(input.name), formatAgentFile(input), { flag: 'wx' });
        await fs.unlink(this.#file(name));
      } else {
        await writeFileAtomic(this.#file(name), formatAgentFile(input));
      }
      return this.#require(input.name);
    });
  }

  /**
   * Deletes one file from the agents folder by its file name ("security-auditor.md"), so a
   * broken file can be removed too. False when there was none.
   */
  async remove(fileOrName: string): Promise<boolean> {
    const file = fileOrName.endsWith('.md') ? fileOrName : `${fileOrName}.md`;
    // Only a plain file name in the folder: no paths, no hidden files.
    if (file !== path.basename(file) || file.startsWith('.') || file.length > 255) return false;
    return serialized(this.dir, async () => {
      const target = path.join(this.dir, file);
      const info = await fs.lstat(target).catch(() => null);
      // A link is removed itself (never what it points to); a folder isn't touched.
      if (!info || info.isDirectory()) return false;
      await fs.unlink(target);
      return true;
    });
  }

  #file(name: string): string {
    return path.join(this.dir, `${name}.md`);
  }

  async #exists(name: string): Promise<boolean> {
    return (await fs.lstat(this.#file(name)).catch(() => null)) !== null;
  }

  async #prepare(): Promise<void> {
    await new WorkspaceData(this.folder, this.name).ensure();
    await fs.mkdir(this.dir, { recursive: true });
  }

  async #require(name: string): Promise<SpecialistInfo> {
    const saved = await this.get(name);
    if (!saved) throw new Error(`The specialist "${name}" couldn't be read back after saving.`);
    return saved;
  }

  /** The .md file names in the folder, sorted; none when there's no folder. */
  async #mdFiles(): Promise<string[]> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(this.dir, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return [];
      throw error;
    }
    return entries
      .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort();
  }

  async #readAll(): Promise<ReadFile[]> {
    const results: ReadFile[] = [];
    let used = 0;
    for (const file of await this.#mdFiles()) {
      if (used >= AGENT_LIMITS.count) {
        results.push({ file, problem: `Only the first ${AGENT_LIMITS.count} are used.` });
        continue;
      }
      const read = await readSmallFile(path.join(this.dir, file));
      if (read === null) {
        results.push({
          file,
          problem: `Not a plain file (a link?), unreadable, or over ${AGENT_LIMITS.fileBytes / 1024} KB.`,
        });
        continue;
      }
      const parsed = parseAgentFile(file.slice(0, -3), read.text);
      if ('problem' in parsed) {
        results.push({ file, problem: parsed.problem });
      } else {
        used += 1;
        results.push({ file, specialist: parsed, updatedAt: read.updatedAt });
      }
    }
    return results;
  }
}

function isValidName(name: string): boolean {
  return AGENT_NAME_PATTERN.test(name) && name.length <= AGENT_LIMITS.nameLength;
}

function taken(name: string): AgentExistsError {
  return new AgentExistsError(
    `A specialist called "${name}" already exists in this workspace. Pick another name.`,
  );
}

function toInfo(s: Specialist, isBuiltIn: boolean, updatedAt: string | null): SpecialistInfo {
  return {
    name: s.name,
    description: s.description,
    instructions: s.instructions,
    toolGroups: [...s.toolGroups],
    readOnly: s.readOnly ?? false,
    model: s.model ?? 'subagent',
    isBuiltIn,
    updatedAt,
  };
}

/**
 * The file's text: front matter, then the role. Every field is written out, so the file says
 * exactly what the specialist may do.
 */
export function formatAgentFile(input: SpecialistData): string {
  const head = [
    '---',
    `name: ${input.name}`,
    `description: ${input.description.replace(/\s+/g, ' ').trim()}`,
    `tools: ${input.toolGroups.join(', ')}`,
    `read_only: ${input.readOnly}`,
    `model: ${input.model}`,
    '---',
  ].join('\n');
  const body = input.instructions.trim();
  return body ? `${head}\n\n${body}\n` : `${head}\n`;
}

/** A specialist from its file's name and text, or what is wrong with it. */
export function parseAgentFile(name: string, text: string): Specialist | { problem: string } {
  if (!isValidName(name)) {
    return {
      problem: `The file name must be lower-case words joined by hyphens (up to ${AGENT_LIMITS.nameLength} characters), like security-auditor.md.`,
    };
  }
  const { head, body } = splitFrontMatter(text);
  const description = frontMatterValue(head, 'description').replace(/\s+/g, ' ').trim();
  if (!description) {
    return { problem: 'Add a "description:" line saying when to use it: the agent picks by it.' };
  }
  if (description.length > AGENT_LIMITS.descriptionLength) {
    return {
      problem: `Keep the description under ${AGENT_LIMITS.descriptionLength} characters.`,
    };
  }

  if (body.length > AGENT_LIMITS.instructionsChars) {
    return {
      problem: `Keep the role under ${AGENT_LIMITS.instructionsChars.toLocaleString('en')} characters.`,
    };
  }

  const toolsText = frontMatterValue(head, 'tools')
    .replace(/^\[|\]$/g, '')
    .trim();
  let toolGroups: readonly ToolGroup[] = TOOL_GROUPS;
  if (toolsText) {
    const listed = toolsText
      .split(/[,\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const unknown = listed.filter((t) => !(TOOL_GROUPS as readonly string[]).includes(t));
    if (unknown.length) {
      return {
        problem: `Unknown tool group ${unknown.map((t) => `"${t}"`).join(', ')}. Use: ${TOOL_GROUPS.join(', ')}.`,
      };
    }
    toolGroups = TOOL_GROUPS.filter((group) => listed.includes(group));
  }

  const readOnlyText = frontMatterValue(head, 'read_only').toLowerCase();
  if (readOnlyText && !['true', 'false', 'yes', 'no'].includes(readOnlyText)) {
    return { problem: '"read_only" must be true or false.' };
  }
  const modelText = frontMatterValue(head, 'model').toLowerCase();
  if (modelText && modelText !== 'subagent' && modelText !== 'review') {
    return { problem: '"model" must be subagent or review.' };
  }

  return {
    name,
    description,
    instructions: body,
    toolGroups,
    ...(readOnlyText === 'true' || readOnlyText === 'yes' ? { readOnly: true } : {}),
    ...(modelText === 'review' ? { model: 'review' as const } : {}),
  };
}

async function readSmallFile(file: string): Promise<{ text: string; updatedAt: string } | null> {
  try {
    const handle = await fs.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > AGENT_LIMITS.fileBytes) return null;
      return { text: await handle.readFile('utf8'), updatedAt: info.mtime.toISOString() };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (['ENOENT', 'ELOOP', 'EMLINK'].includes(errorCode(error) ?? '')) return null;
    throw error;
  }
}
