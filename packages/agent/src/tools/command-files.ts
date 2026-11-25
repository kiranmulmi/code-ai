// What a run_command did to the workspace's files, for the model and the chat: the files it
// changed (each file's size and times compared before and after the command) and the files
// it read (a guess from the command line: cat, head, grep, … and the existing files they name).
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import { TOOL_LIMITS, type CommandFiles } from '@app/shared';
import { isInAppData } from '../guardrails.js';
import { SKIPPED_FOLDERS } from './files/walk.js';

const MAX_TRACKED = TOOL_LIMITS.runCommand.maxFilesTracked;
/** files stat-ed at once */
const STAT_BATCH = 64;

/** A file as last seen: a change to any of these means the file changed. */
interface Seen {
  size: number;
  mtimeMs: number;
  ino: number;
}

/** The workspace's files, by path relative to the workspace folder ("/"-separated). */
export type FileSnapshot = Map<string, Seen>;

/**
 * Every file in the workspace (generated folders like node_modules left out) with its size and
 * times. Null for a workspace too big to compare quickly: then changes aren't listed.
 */
export async function snapshotFiles(root: string): Promise<FileSnapshot | null> {
  const files: string[] = [];
  let level: string[] = [''];
  while (level.length > 0) {
    const next: string[] = [];
    for (const relative of level) {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(relative ? path.join(root, relative) : root, {
          withFileTypes: true,
        });
      } catch {
        continue; // unreadable folder
      }
      for (const entry of entries) {
        if (isInAppData(entry.name)) continue;
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!SKIPPED_FOLDERS.has(entry.name)) next.push(child);
        } else if (entry.isFile()) {
          if (files.length === MAX_TRACKED) return null;
          files.push(child);
        }
      }
    }
    level = next;
  }
  const snapshot: FileSnapshot = new Map();
  for (let i = 0; i < files.length; i += STAT_BATCH) {
    const batch = files.slice(i, i + STAT_BATCH);
    const stats = await Promise.all(
      batch.map((file) => fs.lstat(path.join(root, file)).catch(() => null)),
    );
    batch.forEach((file, index) => {
      const stat = stats[index];
      if (stat) snapshot.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino });
    });
  }
  return snapshot;
}

/** The files added, modified or deleted between two snapshots, sorted by path. */
export function compareSnapshots(
  before: FileSnapshot,
  after: FileSnapshot,
): CommandFiles['changed'] {
  const changed: CommandFiles['changed'] = [];
  for (const [file, now] of after) {
    const was = before.get(file);
    if (!was) changed.push({ path: file, change: 'added' });
    else if (was.size !== now.size || was.mtimeMs !== now.mtimeMs || was.ino !== now.ino) {
      changed.push({ path: file, change: 'modified' });
    }
  }
  for (const file of before.keys()) {
    if (!after.has(file)) changed.push({ path: file, change: 'deleted' });
  }
  return changed.sort((a, b) => a.path.localeCompare(b.path));
}

/** Commands whose file arguments are files they read. */
const READERS: ReadonlySet<string> = new Set([
  'cat',
  'bat',
  'head',
  'tail',
  'less',
  'more',
  'nl',
  'wc',
  'sed',
  'awk',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'ag',
  'diff',
  'cmp',
  'sort',
  'uniq',
  'cut',
  'jq',
  'yq',
  'xxd',
  'hexdump',
  'od',
  'strings',
  'md5sum',
  'shasum',
  'sha256sum',
]);

/** Splits a command line into simple commands (on && || ; | and newlines), each as words. */
function simpleCommands(command: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = '';
  let hasWord = false;
  let quote: '"' | "'" | null = null;
  const endWord = () => {
    if (hasWord) words.push(word);
    word = '';
    hasWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i += 1) {
    const char = command.charAt(i);
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && i + 1 < command.length)
        word += command.charAt(++i);
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      hasWord = true;
    } else if (char === '\\' && i + 1 < command.length) {
      word += command.charAt(++i);
      hasWord = true;
    } else if (char === ' ' || char === '\t') endWord();
    else if (
      char === ';' ||
      char === '|' ||
      char === '&' ||
      char === '\n' ||
      char === '(' ||
      char === ')'
    ) {
      endCommand();
    } else if (char === '<' || char === '>') {
      // A redirection is its own word, so "<file" and "< file" read the same.
      endWord();
      let op = char;
      while (command.charAt(i + 1) === '>' || command.charAt(i + 1) === '&')
        op += command.charAt(++i);
      words.push(op);
    } else {
      word += char;
      hasWord = true;
    }
  }
  endCommand();
  return commands;
}

/**
 * The existing workspace files a command line reads, as far as can be told from the text: the
 * file arguments of commands like cat, head, sed and grep, and files fed in with "<". Follows
 * "cd folder" between commands. Paths relative to the workspace folder.
 */
export async function guessReadFiles(
  command: string,
  root: string,
  cwd: string,
): Promise<string[]> {
  const found = new Set<string>();
  let dir = cwd;
  for (const words of simpleCommands(command)) {
    let start = 0;
    while (start < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[start] ?? '')) start += 1;
    const name = path.basename(words[start] ?? '');
    if (name === 'cd') {
      const to = words[start + 1];
      if (to && !to.startsWith('-')) dir = path.resolve(dir, to);
      continue;
    }
    const candidates: string[] = [];
    for (let i = start; i < words.length; i += 1) {
      const word = words[i] ?? '';
      if (word === '<' && words[i + 1]) candidates.push(words[(i += 1)] ?? '');
      else if (word.startsWith('>')) i += 1; // the file written to, not read
    }
    if (READERS.has(name)) {
      for (const word of words.slice(start + 1)) {
        if (word && !word.startsWith('-') && !word.startsWith('<') && !word.startsWith('>')) {
          candidates.push(word);
        }
      }
    }
    for (const candidate of candidates) {
      if (/[*?$`~]/.test(candidate)) continue; // globs and expansions: can't tell which files
      const absolute = path.resolve(dir, candidate);
      const relative = path.relative(root, absolute);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
      if (isInAppData(relative)) continue;
      const stat = await fs.stat(absolute).catch(() => null);
      if (stat?.isFile()) found.add(relative.split(path.sep).join('/'));
    }
  }
  return [...found];
}
