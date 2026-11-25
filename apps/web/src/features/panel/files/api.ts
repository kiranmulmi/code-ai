import type {
  CreatedEntry,
  FileContent,
  FileCreate,
  FileRename,
  FileReveal,
  FileSearchMode,
  FileSearchResult,
  FileWrite,
  FolderChildren,
  WorkspaceFiles,
} from '@app/shared';
import { buildQuery, jsonBody, request } from '../../../lib/api';

const path = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/files`;

export function fetchFiles(workspaceId: string): Promise<WorkspaceFiles> {
  return request<WorkspaceFiles>(path(workspaceId));
}

/** One folder of the tree ('' is the workspace folder), `limit` entries from `offset`. */
export function fetchFolder(
  workspaceId: string,
  folderPath: string,
  offset: number,
  limit: number,
): Promise<FolderChildren> {
  return request<FolderChildren>(
    `${path(workspaceId)}/children${buildQuery({ path: folderPath, offset, limit })}`,
  );
}

/** Throws an `ApiError` with status 413 when the file is too big to preview. */
export function fetchFileContent(workspaceId: string, filePath: string): Promise<FileContent> {
  return request<FileContent>(`${path(workspaceId)}/content${buildQuery({ path: filePath })}`);
}

export function searchFiles(
  workspaceId: string,
  query: string,
  mode: FileSearchMode,
): Promise<FileSearchResult> {
  return request<FileSearchResult>(`${path(workspaceId)}/search${buildQuery({ q: query, mode })}`);
}

/** Throws an `ApiError` with status 409 when the file changed on disk since `baseVersion`. */
export function saveFile(workspaceId: string, input: FileWrite): Promise<FileContent> {
  return request<FileContent>(`${path(workspaceId)}/content`, jsonBody('PUT', input));
}

export function createEntry(workspaceId: string, input: FileCreate): Promise<CreatedEntry> {
  return request<CreatedEntry>(path(workspaceId), jsonBody('POST', input));
}

export function renameEntry(workspaceId: string, input: FileRename): Promise<CreatedEntry> {
  return request<CreatedEntry>(path(workspaceId), jsonBody('PATCH', input));
}

/** Permanent: the caller confirms first. */
export function deleteEntry(workspaceId: string, entryPath: string): Promise<void> {
  return request<void>(`${path(workspaceId)}${buildQuery({ path: entryPath })}`, {
    method: 'DELETE',
  });
}

/** Shows it selected in the system's file manager ('' is the workspace folder). */
export function revealEntry(workspaceId: string, input: FileReveal): Promise<void> {
  return request<void>(`${path(workspaceId)}/reveal`, jsonBody('POST', input));
}
