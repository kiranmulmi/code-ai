// A workspace's data used to sit right in its folder's .code-ai/, one workspace per folder; now
// each has a subfolder there (workspace-data.ts). Store.moveLegacyFolders moves it, with its MCP
// approval, to the new place on start.
import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_DATA_FOLDER, errorCode } from '@app/agent';
import type { McpTrust } from './mcp-trust.js';
import { workspaceDataDir } from './workspace-data.js';

/** What a workspace kept right in .code-ai/ before each got its own subfolder. */
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
 * Move each folder's old flat data (.code-ai/settings.json, chats/, ...) into the subfolder
 * of the workspace that uses the folder, with its mcp.json approval (once keyed by folder).
 * Only one workspace could use a folder then, so the first listed on it gets the data. An
 * entry the subfolder already has stays where it is.
 * @returns what happened, one line each, for the log
 */
export async function moveFlatWorkspaceData(
  workspaces: readonly { path: string; name: string }[],
  trust: McpTrust,
): Promise<string[]> {
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const { path: folder, name } of workspaces) {
    const root = path.join(folder, APP_DATA_FOLDER);
    const dataDir = workspaceDataDir(folder, name);
    const isFirstOnFolder = !seen.has(folder);
    seen.add(folder);
    if (isFirstOnFolder && (await isRealFolder(root))) {
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
    // Approvals are keyed by the data folder's full path: one given before subfolders
    // (<folder>, the first workspace only) moves to the new one.
    if (isFirstOnFolder && (await trust.carryOver(folder, dataDir))) {
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
