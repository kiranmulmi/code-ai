import { z } from 'zod';
import { FILE_EDIT_MAX_CHARS, FILES_PANEL, LIMITS } from './constants.js';

/** One entry of a folder in the Files panel. */
export interface FolderEntry {
  name: string;
  /** relative to the workspace folder, with "/" separators */
  path: string;
  kind: FileEntryKind;
  /** dependencies, build output, caches, .git: listed, but only opened when asked */
  isGenerated?: boolean;
  /** git ignores it (.gitignore and the like); these rows are dimmed */
  isIgnored?: boolean;
}

/**
 * One folder's entries, a page at a time: the Files panel reads a folder only when it's
 * opened, so even a huge workspace (node_modules and all) costs one folder per request.
 */
export interface FolderChildren {
  /** the folder, relative to the workspace folder; '' is the workspace folder itself */
  path: string;
  /** folders first, then files, each sorted by name; from `offset` on */
  entries: FolderEntry[];
  /** everything in the folder, so the panel can offer the rest */
  total: number;
}

/** GET /v1/workspaces/:id/files: the workspace folder and its top level. */
export interface WorkspaceFiles {
  /** The workspace folder (absolute). */
  path: string;
  /** the folder's own entries (empty when the folder is missing) */
  root: FolderChildren;
}

/** GET /v1/workspaces/:id/files/children?path=&offset=&limit=: one folder, a page of it. */
export const folderChildrenQuerySchema = z.object({
  path: z.string().max(LIMITS.folderPath).default(''),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(FILES_PANEL.maxFolderPage)
    .default(FILES_PANEL.folderPage),
});

export interface FileContent {
  path: string;
  content: string;
  /** a hash of the content: a save sends it back, so changes made meanwhile aren't overwritten */
  version: string;
}

/** PUT /v1/workspaces/:id/files/content: save a file edited in the preview. */
export const fileWriteSchema = z.object({
  path: z.string().min(1, 'Say which file.').max(LIMITS.folderPath),
  content: z.string().max(FILE_EDIT_MAX_CHARS, 'The file is too large to save from here.'),
  /** the version the edit started from; left out: overwrite whatever is there */
  baseVersion: z.string().max(100).optional(),
});

export type FileWrite = z.infer<typeof fileWriteSchema>;

export const FILE_ENTRY_KINDS = ['file', 'folder'] as const;
export type FileEntryKind = (typeof FILE_ENTRY_KINDS)[number];

/** POST /v1/workspaces/:id/files: a new empty file or folder (parent folders made too). */
export const fileCreateSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1, 'Type a name.')
    .max(LIMITS.folderPath)
    .refine((value) => !/[\\/]$/.test(value), 'Leave out the trailing slash.'),
  kind: z.enum(FILE_ENTRY_KINDS),
});

export type FileCreate = z.infer<typeof fileCreateSchema>;

const entryPath = z.string().trim().min(1, 'Say which file or folder.').max(LIMITS.folderPath);

/** PATCH /v1/workspaces/:id/files: rename or move a file or folder. */
export const fileRenameSchema = z.object({
  from: entryPath,
  to: entryPath.refine((value) => !/[\\/]$/.test(value), 'Leave out the trailing slash.'),
});

export type FileRename = z.infer<typeof fileRenameSchema>;

/** DELETE /v1/workspaces/:id/files?path=: a file, or a folder and everything in it. */
export const fileDeleteQuerySchema = z.object({ path: entryPath });

/**
 * POST /v1/workspaces/:id/files/reveal: show a file or folder in the system's file manager
 * (Finder, File Explorer, ...), selected there. An empty path is the workspace folder.
 */
export const fileRevealSchema = z.object({ path: z.string().trim().max(LIMITS.folderPath) });

export type FileReveal = z.infer<typeof fileRevealSchema>;

export interface CreatedEntry {
  /** relative to the workspace folder, with "/" separators */
  path: string;
  kind: FileEntryKind;
}

export const fileContentQuerySchema = z.object({
  path: z.string().min(1, 'Say which file to open.'),
});

/** One level of the folder browser used to choose a workspace's location. */
export interface FolderListing {
  /** absolute */
  path: string;
  /** null at the filesystem root */
  parent: string | null;
  /** the user's home folder, where browsing starts */
  home: string;
  /** names of the subfolders, sorted, hidden ones left out */
  folders: string[];
}

export const folderQuerySchema = z.object({
  /** absolute, or "~/..."; empty or missing means the home folder */
  path: z.string().max(LIMITS.folderPath).optional(),
});

/** GET /v1/folders/check: can this folder be the workspace's (`workspaceId`), or a new one's? */
export const folderCheckQuerySchema = z.object({
  path: z.string().max(LIMITS.folderPath),
  /** the workspace being edited; missing for a new workspace */
  workspaceId: z.string().uuid().optional(),
  /** the name it will have: workspaces on one folder need names with different slugs */
  name: z.string().max(LIMITS.workspaceName).optional(),
});

export interface FolderCheck {
  /** why the folder can't be used (e.g. another workspace there has a too similar name), or null; nothing is created */
  problem: string | null;
}

/** POST /v1/folders/pick: opens the system's folder dialog on this machine. */
export const folderPickSchema = z.object({
  /** where the dialog starts (a missing folder starts it at home) */
  startAt: z.string().max(LIMITS.folderPath).optional(),
});

export interface FolderPick {
  /** the chosen folder, or null when the dialog was cancelled */
  path: string | null;
  /** false: no system dialog here (e.g. Linux without zenity), so use the in-app picker */
  isSupported: boolean;
}

export const FILE_SEARCH_MODES = ['names', 'contents'] as const;
export type FileSearchMode = (typeof FILE_SEARCH_MODES)[number];

/** GET /v1/workspaces/:id/files/search?q=&mode=: the Files panel's search. */
export const fileSearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Type something to search for.').max(200, 'Search for less.'),
  mode: z.enum(FILE_SEARCH_MODES).default('names'),
});

/** One file's lines that contain the search text. */
export interface FileContentMatch {
  path: string;
  lines: { line: number; text: string }[];
  /** more matching lines in this file than are listed */
  moreLines: number;
}

export interface FileSearchResult {
  query: string;
  mode: FileSearchMode;
  /** names mode: matching file paths, relative to the workspace folder */
  paths: string[];
  /** contents mode: the matching lines, file by file */
  files: FileContentMatch[];
  /** stopped early: too many results, too many files, or out of time */
  isTruncated: boolean;
}
