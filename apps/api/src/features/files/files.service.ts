import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import nodePath from 'node:path';
import {
  APP_DATA_FOLDER,
  assertCanChange,
  isInAppData,
  findFilesByName,
  readFolder,
  resolveInWorkspace,
  searchFileContents,
} from '@app/agent';
import {
  FILES_PANEL,
  GUARDRAILS,
  LIMITS,
  type CreatedEntry,
  type FileContent,
  type FileCreate,
  type FileRename,
  type FileWrite,
  type FileSearchMode,
  type FileSearchResult,
  type FolderChildren,
  type FolderEntry,
  type WorkspaceFiles,
} from '@app/shared';
import {
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
} from '../../lib/errors.js';
import { runGit } from '../git/run-git.js';
import { revealInFileManager } from './reveal.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';

/** A folder's entries sent at once by default; the panel asks for more. */
const FOLDER_PAGE = FILES_PANEL.folderPage;
const MAX_NAME_RESULTS = FILES_PANEL.maxNameResults;
const MAX_CONTENT_MATCHES = FILES_PANEL.maxContentMatches;

/** A file's version: changes when its content does. */
const versionOf = (content: string) => createHash('sha1').update(content).digest('hex');

const APP_DATA_MESSAGE = `${APP_DATA_FOLDER}/ holds this app's own data, so it can't be used here.`;

/** The sandbox the agent's file tools use, as a 400 worded for the user. */
async function resolve(folder: string, requested: string): Promise<string> {
  try {
    return await resolveInWorkspace(folder, requested);
  } catch {
    throw new ValidationError(
      isInAppData(requested) ? APP_DATA_MESSAGE : 'Use a path inside the workspace folder.',
    );
  }
}

/**
 * For the user's own changes: inside the workspace, never the folder itself, .git or the
 * app's data (the same rules as the agent's file tools, worded for the person typing).
 */
async function resolveForChange(folder: string, requested: string): Promise<string> {
  const target = await resolve(folder, requested);
  try {
    await assertCanChange(folder, target);
  } catch {
    const isGit = nodePath
      .relative(await fs.realpath(folder), target)
      .split(nodePath.sep)
      .includes('.git');
    throw new ValidationError(
      isGit
        ? "Files inside .git can't be changed here."
        : 'Pick a name inside the workspace folder.',
    );
  }
  return target;
}

/**
 * An existing file or folder to rename or delete: its folder is resolved (inside the
 * workspace, symlinks followed), the entry itself is not, so a link is renamed or removed as
 * a link and never leads outside. Same rules as `resolveForChange`.
 */
async function entryAt(folder: string, requested: string): Promise<string> {
  const normal = nodePath.normalize(requested.replace(/\\/g, '/')).replace(/[\\/]+$/, '');
  const name = nodePath.basename(normal);
  if (!name || name === '.' || name === '..' || nodePath.isAbsolute(normal)) {
    throw new ValidationError('Use a path inside the workspace folder.');
  }
  if (GUARDRAILS.protectAppData && isInAppData(name)) {
    throw new ValidationError(APP_DATA_MESSAGE);
  }
  const parent = await resolve(folder, nodePath.dirname(normal));
  const entry = nodePath.join(parent, name);
  try {
    await assertCanChange(folder, entry);
  } catch {
    throw new ValidationError("Files inside .git can't be changed here.");
  }
  if (!(await fs.lstat(entry).catch(() => null))) {
    throw new NotFoundError(`${requested} no longer exists. Refresh the list.`);
  }
  return entry;
}

/** The path as the Files panel shows it: relative to the workspace, "/" separators. */
async function relativeTo(folder: string, target: string): Promise<string> {
  const root = await fs.realpath(folder);
  return nodePath.relative(root, target).split(nodePath.sep).join('/');
}

/**
 * Which of `paths` (relative to the workspace folder) git ignores: one `git check-ignore`
 * for a folder's page of entries. A folder inside an ignored one is ignored too, so opening
 * node_modules dims everything in it. Empty when it isn't in a repository or git isn't there.
 */
async function ignoredAmong(root: string, paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const result = await runGit(
    root,
    ['check-ignore', '--stdin', '-z'],
    1_000_000,
    paths.join('\0') + '\0',
  );
  // 0: some are ignored; 1: none are; anything else: not a repository, or git failed.
  if (!result || result.code !== 0) return new Set();
  return new Set(result.stdout.split('\0').filter(Boolean));
}

/** One folder of the workspace (`requested` relative to it, '' for the top), a page of it. */
async function folderChildren(
  folder: string,
  requested: string,
  offset: number,
  limit: number,
): Promise<FolderChildren> {
  const root = await fs.realpath(folder);
  const target = await resolve(root, requested || '.');
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) {
    throw new NotFoundError(
      `${requested || 'The workspace folder'} no longer exists. Refresh the list.`,
    );
  }
  if (!stat.isDirectory()) throw new ValidationError(`${requested} is a file, not a folder.`);
  const path = nodePath.relative(root, target).split(nodePath.sep).join('/');
  const { entries, total } = await readFolder(target, { offset, limit });
  const paths = entries.map((entry) => (path ? `${path}/${entry.name}` : entry.name));
  const ignored = await ignoredAmong(root, paths);
  return {
    path,
    total,
    entries: entries.map((entry, index): FolderEntry => {
      const entryPath = paths[index] ?? entry.name;
      return {
        name: entry.name,
        path: entryPath,
        kind: entry.isDirectory ? 'folder' : 'file',
        ...(entry.isGenerated ? { isGenerated: true } : {}),
        ...(ignored.has(entryPath) ? { isIgnored: true } : {}),
      };
    }),
  };
}

export function createFilesService(workspaces: Pick<WorkspacesService, 'require'>) {
  return {
    /** The workspace folder and its top level; deeper folders come from `children`. */
    async list(workspaceId: string): Promise<WorkspaceFiles> {
      const { path } = await workspaces.require(workspaceId);
      const isFolder = (await fs.stat(path).catch(() => null))?.isDirectory() ?? false;
      if (!isFolder) return { path, root: { path: '', entries: [], total: 0 } };
      return { path, root: await folderChildren(path, '', 0, FOLDER_PAGE) };
    },

    /** One folder's entries, read when the Files panel opens it (generated folders too). */
    async children(
      workspaceId: string,
      requested: string,
      offset: number,
      limit: number,
    ): Promise<FolderChildren> {
      const { path } = await workspaces.require(workspaceId);
      return folderChildren(path, requested, offset, limit);
    },

    /** File names, or lines inside files, that contain `query` (any case). */
    async search(
      workspaceId: string,
      query: string,
      mode: FileSearchMode,
    ): Promise<FileSearchResult> {
      const { path } = await workspaces.require(workspaceId);
      const empty: FileSearchResult = { query, mode, paths: [], files: [], isTruncated: false };
      const root = await fs.realpath(path).catch(() => null);
      if (!root) return empty;
      if (mode === 'names') {
        const { paths, isTruncated } = await findFilesByName(root, query, MAX_NAME_RESULTS);
        return { ...empty, paths, isTruncated };
      }
      const { files, isTruncated } = await searchFileContents(root, query, MAX_CONTENT_MATCHES);
      return { ...empty, files, isTruncated };
    },

    async read(workspaceId: string, requested: string): Promise<FileContent> {
      const { path } = await workspaces.require(workspaceId);
      const target = await resolve(path, requested);
      const stat = await fs.stat(target).catch(() => null);
      if (!stat?.isFile()) throw new NotFoundError('File not found.');
      if (stat.size > LIMITS.filePreviewBytes) {
        throw new PayloadTooLargeError('File is too large to preview.');
      }
      const content = await fs.readFile(target, 'utf8');
      return { path: requested, content, version: versionOf(content) };
    },

    /**
     * Saves a file edited by the user in the preview. With `baseVersion`, refuses when the file
     * changed on disk since it was opened (the agent or another editor), so nothing is lost.
     */
    async write(workspaceId: string, { path: requested, content, baseVersion }: FileWrite) {
      const { path } = await workspaces.require(workspaceId);
      const target = await resolveForChange(path, requested);
      const stat = await fs.stat(target).catch(() => null);
      if (!stat?.isFile()) throw new NotFoundError(`${requested} no longer exists.`);
      if (baseVersion !== undefined) {
        const onDisk = await fs.readFile(target, 'utf8');
        if (versionOf(onDisk) !== baseVersion) {
          throw new ConflictError(
            `${requested} changed on disk after you opened it. Reload it, or overwrite it with your version.`,
          );
        }
      }
      await fs.writeFile(target, content, 'utf8');
      const saved: FileContent = { path: requested, content, version: versionOf(content) };
      return saved;
    },

    /** A new empty file or folder, with any missing parent folders. */
    async create(
      workspaceId: string,
      { path: requested, kind }: FileCreate,
    ): Promise<CreatedEntry> {
      const { path } = await workspaces.require(workspaceId);
      const target = await resolveForChange(path, requested);
      if (await fs.lstat(target).catch(() => null)) {
        throw new ConflictError(`${requested} already exists.`);
      }
      await fs.mkdir(kind === 'folder' ? target : nodePath.dirname(target), { recursive: true });
      if (kind === 'file') {
        try {
          await fs.writeFile(target, '', { flag: 'wx' });
        } catch (error) {
          if ((error as { code?: unknown }).code === 'EEXIST') {
            throw new ConflictError(`${requested} already exists.`);
          }
          throw error;
        }
      }
      return { path: await relativeTo(path, target), kind };
    },

    /** Renames or moves a file or folder (any missing parent folders are made). */
    async rename(workspaceId: string, { from, to }: FileRename): Promise<CreatedEntry> {
      const { path } = await workspaces.require(workspaceId);
      const source = await entryAt(path, from);
      const kind = (await fs.lstat(source)).isDirectory() ? 'folder' : 'file';
      const resolved = await resolveForChange(path, to);
      // A name that differs only in case resolves to the file itself on a case-insensitive disk.
      const target =
        resolved === source
          ? nodePath.join(nodePath.dirname(source), nodePath.basename(to.trim()))
          : resolved;
      if (target === source) return { path: await relativeTo(path, source), kind };
      if (resolved !== source && (await fs.lstat(target).catch(() => null))) {
        throw new ConflictError(`${to} already exists.`);
      }
      if (target.startsWith(source + nodePath.sep)) {
        throw new ValidationError("A folder can't be moved into itself.");
      }
      await fs.mkdir(nodePath.dirname(target), { recursive: true });
      await fs.rename(source, target);
      return { path: await relativeTo(path, target), kind };
    },

    /** Deletes a file, or a folder with everything in it. Permanent: the web app asks first. */
    async remove(workspaceId: string, requested: string): Promise<void> {
      const { path } = await workspaces.require(workspaceId);
      const entry = await entryAt(path, requested);
      const stat = await fs.lstat(entry);
      if (stat.isDirectory()) await fs.rm(entry, { recursive: true });
      else await fs.unlink(entry);
    },

    /**
     * Shows a file or folder (an empty path: the workspace folder) selected in the system's
     * file manager. Read-only, so `.git` is fine; still only inside the workspace.
     */
    async reveal(workspaceId: string, requested: string): Promise<void> {
      const { path } = await workspaces.require(workspaceId);
      const target = await resolve(path, requested);
      const stat = await fs.stat(target).catch(() => null);
      if (!stat) {
        throw new NotFoundError(
          `${requested || 'The workspace folder'} no longer exists. Refresh the list.`,
        );
      }
      await revealInFileManager(target, stat.isDirectory());
    },
  };
}

export type FilesService = ReturnType<typeof createFilesService>;
