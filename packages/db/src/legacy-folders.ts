// The app used to be called agentic-ai, then Nimbrio AI, and kept its data in `.agentic-ai`, then
// `.nimbrio-ai` folders (in the home folder and in each workspace). And a workspace's data used
// to sit right in its folder's .hamro-ai/, one workspace per folder; now each has a subfolder
// there (workspace-data.ts). Store.moveLegacyFolders moves both to the new places on start.
import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_DATA_FOLDER, LEGACY_APP_DATA_FOLDERS, errorCode } from '@app/agent';
import type { McpTrust } from './mcp-trust.js';
import { workspaceDataDir } from './workspace-data.js';

/** What a workspace kept right in .hamro-ai/ before each got its own subfolder. */
const FLAT_ENTRIES = [
  'settings.json',
  'memory.json',
  'mcp.json',
  'mcp.imported.json',
  'chats',
  'uploads',
  'skills',
  'agents',
];

/**
 * Move the old data folders next to `appHome` (~/.nimbrio-ai, ~/.agentic-ai) into `appHome`,
 * and each workspace folder's into its APP_DATA_FOLDER, newest name first. A file both have
 * stays in the old folder.
 * @returns what happened, one line each, for the log
 */
export async function moveLegacyFolders(
  appHome: string,
  workspaceFolders: string[],
): Promise<string[]> {
  const moves = LEGACY_APP_DATA_FOLDERS.flatMap((legacy) => [
    { from: path.join(path.dirname(appHome), legacy), to: appHome },
    ...workspaceFolders.map((folder) => ({
      from: path.join(folder, legacy),
      to: path.join(folder, APP_DATA_FOLDER),
    })),
  ]);
  const notes: string[] = [];
  for (const { from, to } of moves) {
    const leftBehind = await moveFolderContents(from, to);
    if (leftBehind === null) continue;
    notes.push(
      leftBehind.length === 0
        ? `Moved ${from} to ${to}.`
        : `Moved ${from} to ${to}, except ${leftBehind.join(', ')}: already there, so the old copies stay in ${from}.`,
    );
  }
  return notes;
}

/**
 * Move everything in the folder `from` into the folder `to` (created when missing), leaving
 * alone anything `to` already has, then remove `from` if that emptied it. A `from` that is
 * missing or isn't a real folder (a symlink, say) is left as it is.
 * @returns null when there was nothing to move, else the names left behind in `from`
 */
async function moveFolderContents(from: string, to: string): Promise<string[] | null> {
  if (!(await isRealFolder(from))) return null;
  if (!(await exists(to))) {
    await fs.rename(from, to);
    return [];
  }
  const leftBehind: string[] = [];
  for (const name of await fs.readdir(from)) {
    const target = path.join(to, name);
    if (await exists(target)) leftBehind.push(name);
    else await fs.rename(path.join(from, name), target);
  }
  if (leftBehind.length === 0) await fs.rmdir(from);
  return leftBehind;
}

async function isRealFolder(folder: string): Promise<boolean> {
  try {
    return (await fs.lstat(folder)).isDirectory();
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return false;
    throw error;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Move each folder's old flat data (.hamro-ai/settings.json, chats/, ...) into the subfolder
 * of the workspace that uses the folder, with its mcp.json approval (once keyed by folder).
 * Only one workspace could use a folder then, so the first listed on it gets the data. An
 * entry the subfolder already has stays where it is. Run after moveLegacyFolders.
 * @returns what happened, one line each, for the log
 */
export async function moveFlatWorkspaceData(
  workspaces: readonly { path: string; name: string }[],
  trust: McpTrust,
): Promise<string[]> {
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const { path: folder, name } of workspaces) {
    if (seen.has(folder)) continue;
    seen.add(folder);
    const root = path.join(folder, APP_DATA_FOLDER);
    const dataDir = workspaceDataDir(folder, name);
    if (await isRealFolder(root)) {
      const moved: string[] = [];
      const leftBehind: string[] = [];
      for (const entry of FLAT_ENTRIES) {
        const from = path.join(root, entry);
        if (!(await exists(from))) continue;
        const to = path.join(dataDir, entry);
        if (await exists(to)) {
          leftBehind.push(entry);
          continue;
        }
        await fs.mkdir(dataDir, { recursive: true });
        await fs.rename(from, to);
        moved.push(entry);
      }
      if (moved.length > 0) {
        await copyIfMissing(path.join(root, '.gitignore'), path.join(dataDir, '.gitignore'));
        notes.push(`Moved ${moved.join(', ')} from ${root} to ${dataDir}.`);
      }
      if (leftBehind.length > 0) {
        notes.push(
          `Left ${leftBehind.join(', ')} in ${root}: ${dataDir} already has them, so the old copies stay.`,
        );
      }
    }
    if (await trust.carryOver(folder, dataDir)) {
      notes.push(`Moved the MCP approval of ${folder} to ${dataDir}.`);
    }
  }
  return notes;
}

async function copyIfMissing(from: string, to: string): Promise<void> {
  try {
    await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'EEXIST') return;
    throw error;
  }
}
