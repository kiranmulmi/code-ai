// A workspace's skills, in one of two layouts:
//
//   <folder>/.nimbrio-ai/skills/<name>.md            written in the Skills tab
//
//   <folder>/.nimbrio-ai/skills/<name>/SKILL.md      uploaded as a folder, with files of its
//   <folder>/.nimbrio-ai/skills/<name>/references/…  own beside it (references, templates,
//   <folder>/.nimbrio-ai/skills/<name>/assets/…      assets: anything SKILL.md points to)
//
//   ---
//   name: jira-ticket-fix
//   description: When the user gives a Jira ticket to check or fix.
//   ---
//
//   The instructions…
//
// The file (or folder) name is the skill's name (the `name:` line is written for readers and
// other tools, and ignored when it disagrees; an upload takes its name from it). Written from
// the Skills tab; the agent reads them through the SkillStore interface, and its file tools
// can't reach .nimbrio-ai/. Links are never followed, so a skill folder can't lead outside.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  SKILL_LIMITS,
  SKILL_MAIN_FILE,
  SKILL_NAME_PATTERN,
  type Skill,
  type SkillFile,
  type SkillInput,
} from '@app/shared';
import {
  APP_DATA_FOLDER,
  errorCode,
  serialized,
  writeFileAtomic,
  type SkillStore,
} from '@app/agent';
import { InputError } from './errors.js';
import { WorkspaceData } from './workspace-data.js';

/** A skill file is read only up to this size: anything longer can't be a valid skill. */
const MAX_FILE_BYTES = SKILL_LIMITS.readBytes;

/** Left out of an upload and of a folder's file list: system clutter, not part of a skill. */
const JUNK_FILES = new Set(['thumbs.db', 'desktop.ini', '__macosx']);

/** The name is taken by another skill (the API answers 409). */
export class SkillExistsError extends Error {
  override name = 'SkillExistsError';
}

/** One file of an uploaded skill folder, its path as the browser gave it. */
export interface SkillUploadFile {
  path: string;
  bytes: Buffer;
}

export class WorkspaceSkills implements SkillStore {
  /** <folder>/.nimbrio-ai/skills */
  readonly dir: string;

  constructor(readonly folder: string) {
    this.dir = path.join(folder, APP_DATA_FOLDER, 'skills');
  }

  async list(): Promise<Skill[]> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(this.dir, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
    const names = new Set<string>();
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) names.add(entry.name.slice(0, -3));
      else if (entry.isDirectory()) names.add(entry.name);
    }
    const skills = await Promise.all(
      [...names].filter((name) => SKILL_NAME_PATTERN.test(name)).map((name) => this.get(name)),
    );
    return skills
      .filter((skill): skill is Skill => skill !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, SKILL_LIMITS.count);
  }

  /** A folder skill when `<name>/SKILL.md` is there, else `<name>.md`. */
  async get(name: string): Promise<Skill | null> {
    if (!this.#isValidName(name)) return null;
    const folder = await this.#folderOf(name);
    if (folder) {
      const read = await readTextFile(path.join(folder, SKILL_MAIN_FILE));
      if (!read) return null;
      return {
        name,
        ...parseSkillFile(read.text),
        updatedAt: read.updatedAt,
        files: await listFolderFiles(folder),
      };
    }
    const read = await readTextFile(path.join(this.dir, `${name}.md`));
    return read ? { name, ...parseSkillFile(read.text), updatedAt: read.updatedAt } : null;
  }

  /**
   * One of a folder skill's files. null when the skill or file isn't there, when `relPath`
   * tries to leave the folder, or when any part of it is a link.
   */
  async readFile(name: string, relPath: string): Promise<Buffer | null> {
    if (!this.#isValidName(name)) return null;
    const folder = await this.#folderOf(name);
    const parts = folder ? splitSkillPath(relPath) : null;
    if (!folder || !parts || parts.length === 0) return null;
    // Every part is checked as it is, so a link anywhere along the way counts as missing.
    let current = folder;
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      const info = await fs.lstat(current).catch(() => null);
      const isLast = index === parts.length - 1;
      if (!info || info.isSymbolicLink()) return null;
      if (isLast ? !info.isFile() : !info.isDirectory()) return null;
      if (isLast && info.size > SKILL_LIMITS.fileBytes) return null;
    }
    try {
      const handle = await fs.open(current, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        return await handle.readFile();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (['ENOENT', 'ELOOP', 'EMLINK'].includes(errorCode(error) ?? '')) return null;
      throw error;
    }
  }

  /** Throws SkillExistsError when the name is taken. */
  async create(input: SkillInput): Promise<Skill> {
    return serialized(this.dir, async () => {
      if (await this.get(input.name)) throw this.#taken(input.name);
      await this.#checkRoom();
      await this.#prepare();
      await fs.writeFile(path.join(this.dir, `${input.name}.md`), formatSkillFile(input), {
        flag: 'wx',
      });
      return this.#require(input.name);
    });
  }

  /**
   * Saves `name` as `input` (a different `input.name` renames it). Null when it's gone. A folder
   * skill keeps its files: only its SKILL.md is rewritten (and the folder renamed).
   */
  async update(name: string, input: SkillInput): Promise<Skill | null> {
    return serialized(this.dir, async () => {
      if (!(await this.get(name))) return null;
      const isRename = input.name !== name;
      if (isRename && (await this.get(input.name))) throw this.#taken(input.name);
      const folder = await this.#folderOf(name);
      if (folder) {
        const target = isRename ? path.join(this.dir, input.name) : folder;
        if (isRename) await fs.rename(folder, target);
        await writeFileAtomic(path.join(target, SKILL_MAIN_FILE), formatSkillFile(input));
      } else {
        const file = path.join(this.dir, `${input.name}.md`);
        if (isRename) {
          await fs.writeFile(file, formatSkillFile(input), { flag: 'wx' });
          await fs.unlink(path.join(this.dir, `${name}.md`));
        } else {
          await writeFileAtomic(file, formatSkillFile(input));
        }
      }
      return this.#require(input.name);
    });
  }

  /** False when there was no such skill. Removes a folder skill with all its files. */
  async remove(name: string): Promise<boolean> {
    if (!this.#isValidName(name)) return false;
    let removed = false;
    const folder = await this.#folderOf(name, { needsMain: false });
    if (folder) {
      await fs.rm(folder, { recursive: true, force: true });
      removed = true;
    }
    try {
      await fs.unlink(path.join(this.dir, `${name}.md`));
      removed = true;
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
    return removed;
  }

  /**
   * Saves an uploaded skill folder as `<name>/`, its name and description from SKILL.md.
   * Paths may start with the folder's own name (as a browser's folder picker gives them).
   * Throws InputError for anything unsafe or invalid, SkillExistsError when the name is taken
   * and `replace` is off. The folder appears whole or not at all.
   */
  async upload(
    files: readonly SkillUploadFile[],
    { replace = false }: { replace?: boolean } = {},
  ): Promise<Skill> {
    const { name, entries } = checkUpload(files);
    return serialized(this.dir, async () => {
      const existing = await this.get(name);
      if (existing && !replace) throw this.#taken(name);
      if (!existing) await this.#checkRoom();
      await this.#prepare();

      // Written beside the skills under a hidden name (never listed), then moved into place.
      const staging = path.join(this.dir, `.upload-${randomUUID().slice(0, 8)}`);
      try {
        for (const entry of entries) {
          const target = path.join(staging, ...entry.parts);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, entry.bytes, { flag: 'wx' });
        }
        if (existing) await this.remove(name);
        await fs.rename(staging, path.join(this.dir, name));
      } catch (error) {
        await fs.rm(staging, { recursive: true, force: true });
        throw error;
      }
      return this.#require(name);
    });
  }

  #isValidName(name: string): boolean {
    return SKILL_NAME_PATTERN.test(name) && name.length <= SKILL_LIMITS.nameLength;
  }

  /** `<dir>/<name>` when it is a real folder (not a link) with a SKILL.md in it; else null. */
  async #folderOf(name: string, { needsMain = true } = {}): Promise<string | null> {
    const folder = path.join(this.dir, name);
    const info = await fs.lstat(folder).catch(() => null);
    if (!info?.isDirectory()) return null;
    if (!needsMain) return folder;
    const main = await fs.lstat(path.join(folder, SKILL_MAIN_FILE)).catch(() => null);
    return main?.isFile() ? folder : null;
  }

  async #checkRoom(): Promise<void> {
    if ((await this.list()).length >= SKILL_LIMITS.count) {
      throw new InputError(`A workspace can have at most ${SKILL_LIMITS.count} skills.`);
    }
  }

  /** The data folder (with its .gitignore) and the skills folder. */
  async #prepare(): Promise<void> {
    await new WorkspaceData(this.folder).ensure();
    await fs.mkdir(this.dir, { recursive: true });
  }

  async #require(name: string): Promise<Skill> {
    const skill = await this.get(name);
    if (!skill) throw new Error(`The skill "${name}" couldn't be read back after saving.`);
    return skill;
  }

  #taken(name: string): SkillExistsError {
    return new SkillExistsError(`A skill called "${name}" already exists. Pick another name.`);
  }
}

/** A text file's contents and when it changed; null when missing, a link or too large. */
async function readTextFile(file: string): Promise<{ text: string; updatedAt: string } | null> {
  try {
    const handle = await fs.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
      return { text: await handle.readFile('utf8'), updatedAt: info.mtime.toISOString() };
    } finally {
      await handle.close();
    }
  } catch (error) {
    // Missing, or a link (O_NOFOLLOW): not a skill.
    if (['ENOENT', 'ELOOP', 'EMLINK'].includes(errorCode(error) ?? '')) return null;
    throw error;
  }
}

/** A folder skill's files besides SKILL.md, sorted. Links, hidden files and clutter are left out. */
async function listFolderFiles(folder: string): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= SKILL_LIMITS.fileCount) return;
      if (isJunk(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else if (entry.isFile() && rel !== SKILL_MAIN_FILE) {
        const info = await fs.lstat(path.join(dir, entry.name)).catch(() => null);
        if (info?.isFile()) files.push({ path: rel, size: info.size });
      }
    }
  };
  await walk(folder, '');
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Hidden files (.DS_Store, .git) and system clutter. */
function isJunk(name: string): boolean {
  return name.startsWith('.') || JUNK_FILES.has(name.toLowerCase());
}

/**
 * A relative path inside a skill folder, as its parts; null when it could leave the folder or
 * isn't a plain path ("..", absolute, a drive letter, empty parts, control characters).
 */
export function splitSkillPath(relPath: string): string[] | null {
  // eslint-disable-next-line no-control-regex
  if (typeof relPath !== 'string' || /[\u0000-\u001f]/.test(relPath)) return null;
  const normalized = relPath.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..' || part.includes(':'))) {
    return null;
  }
  return parts;
}

interface CheckedEntry {
  parts: string[];
  bytes: Buffer;
}

/** An upload's skill name and files, checked; throws InputError with what's wrong. */
export function checkUpload(files: readonly SkillUploadFile[]): {
  name: string;
  entries: CheckedEntry[];
} {
  if (files.length === 0) throw new InputError('Pick a skill folder.');
  let entries: CheckedEntry[] = [];
  for (const file of files) {
    const parts = splitSkillPath(file.path);
    if (!parts) throw new InputError(`"${file.path}" isn't a valid path inside a skill folder.`);
    if (parts.some(isJunk)) continue;
    entries.push({ parts, bytes: file.bytes });
  }

  // A picked folder gives paths starting with its own name: drop it when all of them share it.
  const isMain = (entry: CheckedEntry) =>
    entry.parts.length === 1 && entry.parts[0]?.toLowerCase() === SKILL_MAIN_FILE.toLowerCase();
  let folderName: string | null = null;
  if (!entries.some(isMain)) {
    const first = entries[0]?.parts[0];
    if (first && entries.every((entry) => entry.parts.length > 1 && entry.parts[0] === first)) {
      folderName = first;
      entries = entries.map((entry) => ({ ...entry, parts: entry.parts.slice(1) }));
    }
  }

  const main = entries.find(isMain);
  if (!main) {
    throw new InputError(
      `A skill folder needs a ${SKILL_MAIN_FILE} at its top, with the skill's name, description and instructions.`,
    );
  }
  main.parts = [SKILL_MAIN_FILE];

  if (entries.length > SKILL_LIMITS.fileCount) {
    throw new InputError(`A skill can have at most ${SKILL_LIMITS.fileCount} files.`);
  }
  const seen = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    const rel = entry.parts.join('/');
    if (rel.length > SKILL_LIMITS.pathLength) {
      throw new InputError(`The path "${rel}" is too long.`);
    }
    // Case-insensitive, since macOS and Windows disks are.
    if (seen.has(rel.toLowerCase())) throw new InputError(`"${rel}" is in the upload twice.`);
    seen.add(rel.toLowerCase());
    if (entry.bytes.length > SKILL_LIMITS.fileBytes) {
      throw new InputError(
        `"${rel}" is too large: files can be at most ${mb(SKILL_LIMITS.fileBytes)}.`,
      );
    }
    total += entry.bytes.length;
  }
  if (total > SKILL_LIMITS.totalBytes) {
    throw new InputError(`The skill is too large: at most ${mb(SKILL_LIMITS.totalBytes)} in all.`);
  }
  // A file and a folder of the same name ("a" and "a/b") can't both be written.
  for (const entry of entries) {
    for (let i = 1; i < entry.parts.length; i += 1) {
      if (seen.has(entry.parts.slice(0, i).join('/').toLowerCase())) {
        throw new InputError(`"${entry.parts.slice(0, i).join('/')}" is both a file and a folder.`);
      }
    }
  }

  if (main.bytes.length > MAX_FILE_BYTES) {
    throw new InputError(`${SKILL_MAIN_FILE} is too large to be a skill's instructions.`);
  }
  const text = main.bytes.toString('utf8');
  const { description, body } = parseSkillFile(text);
  const name = (skillFileName(text) || folderName || '').trim();
  if (!name) {
    throw new InputError(
      `Give the skill a name: a "name:" line in ${SKILL_MAIN_FILE}'s front matter.`,
    );
  }
  if (!SKILL_NAME_PATTERN.test(name) || name.length > SKILL_LIMITS.nameLength) {
    throw new InputError(
      `"${name}" can't be a skill name: use lower-case letters, digits and single hyphens (at most ${SKILL_LIMITS.nameLength} characters).`,
    );
  }
  if (!description) {
    throw new InputError(
      `${SKILL_MAIN_FILE} needs a "description:" line in its front matter saying when to use the skill: this is how the agent decides.`,
    );
  }
  if (description.length > SKILL_LIMITS.descriptionLength) {
    throw new InputError(
      `The description is too long: keep it to ${SKILL_LIMITS.descriptionLength} characters.`,
    );
  }
  if (!body) throw new InputError(`${SKILL_MAIN_FILE} has no instructions after its front matter.`);
  if (body.length > SKILL_LIMITS.bodyChars) {
    throw new InputError(
      `The instructions are too long: keep them to ${SKILL_LIMITS.bodyChars} characters.`,
    );
  }
  return { name, entries };
}

function mb(bytes: number): string {
  return `${bytes / (1024 * 1024)} MB`;
}

/** The file's text: front matter with the name and a one-line description, then the body. */
export function formatSkillFile({ name, description, body }: SkillInput): string {
  const line = description.replace(/\s+/g, ' ').trim();
  return `---\nname: ${name}\ndescription: ${line}\n---\n\n${body.trim()}\n`;
}

/** Reads a skill file; one without front matter is all body, with no description. */
export function parseSkillFile(text: string): Pick<Skill, 'description' | 'body'> {
  const { head, body } = splitFrontMatter(text);
  return { description: frontMatterValue(head, 'description'), body };
}

/** The `name:` in a skill file's front matter; empty when there is none. */
export function skillFileName(text: string): string {
  return frontMatterValue(splitFrontMatter(text).head, 'name');
}

function splitFrontMatter(text: string): { head: string; body: string } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!match) return { head: '', body: normalized.trim() };
  return { head: match[1] ?? '', body: (match[2] ?? '').trim() };
}

/**
 * One top-level value from YAML front matter: `key: text`, quoted, or a block (`key: >` or
 * `key: |`, its indented lines joined into one line).
 */
function frontMatterValue(head: string, key: string): string {
  const lines = head.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index === -1) return '';
  const value = (lines[index] ?? '').slice(key.length + 1).trim();
  if (/^[>|][-+]?$/.test(value)) {
    const block: string[] = [];
    for (const line of lines.slice(index + 1)) {
      if (line.trim() && !/^\s/.test(line)) break;
      block.push(line.trim());
    }
    return block.join(' ').replace(/\s+/g, ' ').trim();
  }
  return unquote(value);
}

/** `"text"` or `'text'` as written by hand in YAML. */
function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? (quoted[2] ?? '') : value;
}
