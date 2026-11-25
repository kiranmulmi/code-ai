import { useCallback, useEffect, useRef, useState } from 'react';
import { FILES_PANEL, type FolderChildren } from '@app/shared';
import { isNotFound } from '../../../lib/api';
import { fetchFolder } from './api';
import {
  EMPTY_FOLDER,
  folderState,
  isVisible,
  soleFolder,
  withoutFolder,
  withoutOpenFolder,
  type FolderState,
} from './folderTree';

const PAGE = FILES_PANEL.folderPage;
const MAX_PAGE = FILES_PANEL.maxFolderPage;
/** Only-child folders opened in one go at most (a deeply nested chain stops there). */
const MAX_CHAIN = 32;

export interface FolderTree {
  /** folder path ('' for the top) -> what's been read of it */
  folders: Readonly<Record<string, FolderState>>;
  open: ReadonlySet<string>;
  /** Opens folders (reading any not read yet); an only-child folder inside opens too. */
  expand: (paths: readonly string[]) => Promise<void>;
  collapse: (path: string) => void;
  /** Reads a folder's next page. */
  showMore: (path: string) => void;
  /** Reads a folder again (after an error, say). */
  reload: (path: string) => void;
}

/**
 * The Files panel's tree, read lazily: the top level comes with `root`, and each folder is
 * read when it's opened, a page at a time, so the size of the workspace (node_modules and
 * all) never matters, only what's open. A new `root` (after a refresh, a change, or the
 * agent's run) reads the open folders again.
 */
export function useFolderTree(workspaceId: string, root: FolderChildren): FolderTree {
  const [folders, setFolders] = useState<Record<string, FolderState>>(() => ({
    '': folderState(root),
  }));
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  // The latest state, for async work started earlier.
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const openRef = useRef(open);
  openRef.current = open;
  // Per folder, the latest request: an older answer arriving late is dropped.
  const requests = useRef(new Map<string, number>());
  const nextRequest = useRef(0);

  const load = useCallback(
    async (path: string, mode: 'replace' | 'append' = 'replace'): Promise<FolderState | null> => {
      const current = foldersRef.current[path];
      const shown = current?.entries.length ?? 0;
      // A refresh reads again as much as was shown, so the list doesn't shrink under the user.
      const offset = mode === 'append' ? shown : 0;
      const limit = mode === 'append' ? PAGE : Math.min(Math.max(shown, PAGE), MAX_PAGE);
      const id = ++nextRequest.current;
      requests.current.set(path, id);
      setFolders((prev) => ({
        ...prev,
        [path]: { ...(prev[path] ?? EMPTY_FOLDER), isLoading: true, error: null },
      }));
      try {
        const page = await fetchFolder(workspaceId, path, offset, limit);
        if (requests.current.get(path) !== id) return null;
        const next: FolderState = {
          entries:
            mode === 'append'
              ? [...(foldersRef.current[path]?.entries ?? []), ...page.entries]
              : page.entries,
          total: page.total,
          isLoading: false,
          error: null,
        };
        setFolders((prev) => ({ ...prev, [path]: next }));
        return next;
      } catch (error) {
        if (requests.current.get(path) !== id) return null;
        if (path && isNotFound(error)) {
          // Gone from disk (deleted, renamed): forget it and anything under it.
          setFolders((prev) => withoutFolder(prev, path));
          setOpen((prev) => withoutOpenFolder(prev, path));
          return null;
        }
        setFolders((prev) => ({
          ...prev,
          [path]: { ...(prev[path] ?? EMPTY_FOLDER), isLoading: false, error },
        }));
        return null;
      }
    },
    [workspaceId],
  );

  const expand = useCallback(
    async (paths: readonly string[]) => {
      const opened = new Set(openRef.current);
      const toOpen = [...paths];
      for (const path of toOpen) opened.add(path);
      openRef.current = opened;
      setOpen(opened);
      for (const start of toOpen) {
        let path = start;
        for (let step = 0; step < MAX_CHAIN; step += 1) {
          const cached = foldersRef.current[path];
          let state: FolderState | null;
          if (cached && !cached.error) {
            state = cached;
            // Shown at once from what was read before, and read again for changes.
            if (!cached.isLoading) void load(path);
          } else {
            state = await load(path);
          }
          const only = soleFolder(state ?? undefined);
          if (!only || openRef.current.has(only.path)) break;
          path = only.path;
          const next = new Set(openRef.current).add(path);
          openRef.current = next;
          setOpen(next);
        }
      }
    },
    [load],
  );

  const collapse = useCallback((path: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }, []);

  const showMore = useCallback((path: string) => void load(path, 'append'), [load]);
  const reload = useCallback((path: string) => void load(path), [load]);

  // A new top level (refresh, a change, the agent's run): read the open folders again too.
  const lastRoot = useRef(root);
  useEffect(() => {
    if (lastRoot.current === root) return;
    lastRoot.current = root;
    const shownAtTop = foldersRef.current['']?.entries.length ?? 0;
    if (shownAtTop > root.entries.length) void load('');
    else setFolders((prev) => ({ ...prev, '': folderState(root) }));
    for (const path of openRef.current) {
      if (foldersRef.current[path] && isVisible(path, openRef.current)) void load(path);
    }
  }, [root, load]);

  return { folders, open, expand, collapse, showMore, reload };
}
