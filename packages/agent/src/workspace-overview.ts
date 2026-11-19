// The workspace overview: a short, factual snapshot of the workspace folder (what's in it, the
// start of its README or agent notes, its package name, its git branch). It is data, not
// instructions: it gives every model, however weak, the same starting point a person gets from
// opening the folder, without it having to think of calling a tool first.
//
// Built once per request from the folder as it is then. It only changes when the files do, so
// the system prompt it sits in stays cacheable between requests.
import fs from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_OVERVIEW } from '@app/shared';
import { walk } from './tools/files/walk.js';

/** The project's notes, in the order they're looked for: agent notes before the README. */
const DOC_NAMES = [
  'CLAUDE.md',
  'AGENTS.md',
  'README.md',
  'README.markdown',
  'README.txt',
  'README',
];

export interface OverviewOptions {
  maxEntries?: number;
  maxDepth?: number;
  docChars?: number;
}

/**
 * The overview of a workspace folder, as plain text, or '' when the folder can't be read
 * or is empty. Never throws: a missing overview must never stop a request.
 */
export async function workspaceOverview(
  dir: string,
  {
    maxEntries = WORKSPACE_OVERVIEW.maxEntries,
    maxDepth = WORKSPACE_OVERVIEW.maxDepth,
    docChars = WORKSPACE_OVERVIEW.docChars,
  }: OverviewOptions = {},
): Promise<string> {
  try {
    const root = await fs.realpath(dir);
    const [tree, doc, pkg, branch] = await Promise.all([
      listTree(root, maxEntries, maxDepth),
      readDoc(root, docChars),
      readPackage(root),
      readGitBranch(root),
    ]);
    if (!tree.lines.length) return '';
    const facts = [
      `Folder: ${path.basename(root)}`,
      pkg ? `Package: ${pkg}` : null,
      branch ? `Git branch: ${branch}` : null,
    ].filter(Boolean);
    const parts = [
      facts.join('\n'),
      `Files (top level first${tree.isTruncated ? ', not all shown' : ''}):\n${tree.lines.join('\n')}`,
      doc ? `Start of ${doc.name}:\n${doc.text}` : null,
    ];
    return parts.filter(Boolean).join('\n\n');
  } catch {
    return '';
  }
}

/** Files and folders, breadth-first so the top level is always complete before deeper ones. */
async function listTree(
  root: string,
  maxEntries: number,
  maxDepth: number,
): Promise<{ lines: string[]; isTruncated: boolean }> {
  const byDepth = new Map<number, { relative: string; isDirectory: boolean }[]>();
  const perFolder = new Map<string, number>();
  const hiddenIn = new Map<string, number>();
  for await (const entry of walk(root, { maxDepth })) {
    if (entry.depth > maxDepth || entry.relative === '.git') continue; // the branch says enough
    const parent = entry.relative.includes('/')
      ? entry.relative.slice(0, entry.relative.lastIndexOf('/'))
      : '';
    // Deeper folders show their first few entries only: enough to see what they hold.
    const count = (perFolder.get(parent) ?? 0) + 1;
    perFolder.set(parent, count);
    if (parent && count > WORKSPACE_OVERVIEW.maxPerFolder) {
      hiddenIn.set(parent, (hiddenIn.get(parent) ?? 0) + 1);
      continue;
    }
    const level = byDepth.get(entry.depth) ?? [];
    level.push({ relative: entry.relative, isDirectory: entry.isDirectory });
    byDepth.set(entry.depth, level);
  }
  const chosen: { relative: string; isDirectory: boolean }[] = [];
  let isTruncated = hiddenIn.size > 0;
  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    for (const entry of byDepth.get(depth) ?? []) {
      if (chosen.length >= maxEntries) {
        isTruncated = true;
        break;
      }
      chosen.push(entry);
    }
  }
  // Shown as a sorted list of paths, folders marked with a trailing "/".
  chosen.sort((a, b) => a.relative.localeCompare(b.relative));
  const lines = chosen.map(({ relative, isDirectory }) => {
    const more = hiddenIn.get(relative);
    return `${relative}${isDirectory ? '/' : ''}${more ? ` (+${more} more)` : ''}`;
  });
  return { lines, isTruncated };
}

/** The start of the first notes file found at the top level (any case). */
async function readDoc(
  root: string,
  maxChars: number,
): Promise<{ name: string; text: string } | null> {
  if (maxChars <= 0) return null;
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    return null;
  }
  for (const wanted of DOC_NAMES) {
    const name = names.find((n) => n.toLowerCase() === wanted.toLowerCase());
    if (!name) continue;
    const file = path.join(root, name);
    try {
      const stat = await fs.lstat(file); // a symlink could point outside the workspace
      if (!stat.isFile() || stat.size > WORKSPACE_OVERVIEW.maxDocBytes) continue;
      const text = (await fs.readFile(file, 'utf8')).trim();
      if (!text) continue;
      return {
        name,
        text: text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}\n…` : text,
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** "name: description" from package.json, if there is one. */
async function readPackage(root: string): Promise<string | null> {
  try {
    const file = path.join(root, 'package.json');
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > WORKSPACE_OVERVIEW.maxDocBytes) return null;
    const data: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!data || typeof data !== 'object') return null;
    const { name, description } = data as { name?: unknown; description?: unknown };
    const parts = [name, description].filter(
      (part): part is string => typeof part === 'string' && part.trim() !== '',
    );
    return parts.length ? parts.map((part) => part.trim().slice(0, 200)).join(': ') : null;
  } catch {
    return null;
  }
}

/** The checked-out branch, read from .git/HEAD (no git command needed). */
async function readGitBranch(root: string): Promise<string | null> {
  try {
    const head = (await fs.readFile(path.join(root, '.git', 'HEAD'), 'utf8')).trim();
    const match = /^ref: refs\/heads\/(.+)$/.exec(head);
    if (match?.[1]) return match[1];
    return /^[0-9a-f]{7,}$/i.test(head) ? `detached at ${head.slice(0, 7)}` : null;
  } catch {
    return null;
  }
}
