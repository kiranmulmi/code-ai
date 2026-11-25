// Pure helpers for the Files panel's tree, which reads each folder only when it's opened.
import type { FolderChildren, FolderEntry } from '@app/shared';

/** One folder as the tree knows it: what's been read of it so far. */
export interface FolderState {
  entries: FolderEntry[];
  /** everything in the folder; more than `entries` means "Show more" */
  total: number;
  isLoading: boolean;
  error: unknown;
}

export const EMPTY_FOLDER: FolderState = { entries: [], total: 0, isLoading: false, error: null };

export function folderState(children: FolderChildren): FolderState {
  return { entries: children.entries, total: children.total, isLoading: false, error: null };
}

/** Every folder above `path` and `path` itself: "a/b/c" -> ["a", "a/b", "a/b/c"]. */
export function withParents(path: string): string[] {
  if (!path) return [];
  const parts = path.split('/');
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

/** The folder a path is in ('' for the top). */
export function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/**
 * A folder's only entry, when that's a folder the tree can open straight away (not a
 * generated one like node_modules): its row then joins its parent's, "src/main/java".
 */
export function soleFolder(folder: FolderState | undefined): FolderEntry | null {
  if (!folder || folder.error || folder.total !== 1) return null;
  const only = folder.entries[0];
  return only && only.kind === 'folder' && !only.isGenerated ? only : null;
}

/** A folder's row: down its chain of only-child folders already read, as one name. */
export function compactRow(
  entry: FolderEntry,
  folders: Readonly<Record<string, FolderState>>,
): { path: string; name: string; chain: string[] } {
  let path = entry.path;
  let name = entry.name;
  const chain = [path];
  for (let only = soleFolder(folders[path]); only; only = soleFolder(folders[path])) {
    path = only.path;
    name = `${name}/${only.name}`;
    chain.push(path);
  }
  return { path, name, chain };
}

/** Shown in the tree: every folder above it is open (the top level always is). */
export function isVisible(path: string, open: ReadonlySet<string>): boolean {
  return withParents(parentOf(path)).every((folder) => open.has(folder));
}

/** Drops a folder and everything under it, e.g. once it's gone from disk. */
export function withoutFolder<T>(record: Readonly<Record<string, T>>, path: string) {
  const prefix = `${path}/`;
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== path && !key.startsWith(prefix)),
  );
}

/** The open folders, less `path` and everything under it. */
export function withoutOpenFolder(open: ReadonlySet<string>, path: string): Set<string> {
  const prefix = `${path}/`;
  return new Set([...open].filter((key) => key !== path && !key.startsWith(prefix)));
}

/** The folders to open so `path` shows: those above it, and itself when it's a folder. */
export function foldersToShow(path: string, isFolder: boolean): string[] {
  const all = withParents(path);
  return isFolder ? all : all.slice(0, -1);
}
