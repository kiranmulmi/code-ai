import type {
  FolderCheck,
  FolderListing,
  FolderPick,
  InstructionsDraft,
  InstructionsDraftRequest,
  Workspace,
  WorkspaceDeletion,
  WorkspaceGroup,
  WorkspaceGroupInput,
  WorkspaceInput,
  WorkspaceUpdate,
} from '@app/shared';
import { buildQuery, jsonBody, request } from '../../lib/api';

const path = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}`;

export function fetchWorkspaces(): Promise<Workspace[]> {
  return request<Workspace[]>('/workspaces');
}

export function fetchWorkspace(workspaceId: string): Promise<Workspace> {
  return request<Workspace>(path(workspaceId));
}

export function createWorkspace(input: WorkspaceInput): Promise<Workspace> {
  return request<Workspace>('/workspaces', jsonBody('POST', input));
}

export function updateWorkspace(workspaceId: string, input: WorkspaceUpdate): Promise<Workspace> {
  return request<Workspace>(path(workspaceId), jsonBody('PATCH', input));
}

export function deleteWorkspace(workspaceId: string): Promise<WorkspaceDeletion> {
  return request<WorkspaceDeletion>(path(workspaceId), { method: 'DELETE' });
}

/** One level of the folder browser; no path starts at the home folder. */
export function fetchFolders(folderPath?: string): Promise<FolderListing> {
  return request<FolderListing>(`/folders${buildQuery({ path: folderPath })}`);
}

/**
 * Why the folder can't be this workspace's (or a new one's) under `name`, e.g. another there
 * has a too similar name; or null.
 */
export async function checkWorkspaceFolder(
  folderPath: string,
  workspaceId?: string,
  name?: string,
): Promise<string | null> {
  const { problem } = await request<FolderCheck>(
    `/folders/check${buildQuery({ path: folderPath, workspaceId, name })}`,
  );
  return problem;
}

/**
 * Opens this computer's own folder window (the API runs here) and waits for the choice.
 * `isSupported: false` means there is none to open, so the in-app browser is used instead.
 */
export function pickFolderWithSystemDialog(startAt?: string): Promise<FolderPick> {
  return request<FolderPick>('/folders/pick', jsonBody('POST', { startAt }));
}

/** Instructions written by the default model from a request and the workspace (nothing saved). */
export async function writeInstructions(input: InstructionsDraftRequest): Promise<string> {
  const { text } = await request<InstructionsDraft>(
    '/prompts/instructions',
    jsonBody('POST', input),
  );
  return text;
}

/** The sidebar folders that collect workspaces (a workspace's `groupId` files it in one). */
export function fetchWorkspaceGroups(): Promise<WorkspaceGroup[]> {
  return request<WorkspaceGroup[]>('/workspace-groups');
}

export function createWorkspaceGroup(input: WorkspaceGroupInput): Promise<WorkspaceGroup> {
  return request<WorkspaceGroup>('/workspace-groups', jsonBody('POST', input));
}

export function renameWorkspaceGroup(
  groupId: string,
  input: WorkspaceGroupInput,
): Promise<WorkspaceGroup> {
  return request<WorkspaceGroup>(
    `/workspace-groups/${encodeURIComponent(groupId)}`,
    jsonBody('PATCH', input),
  );
}

/** Its workspaces move to the top level; none are deleted. */
export async function deleteWorkspaceGroup(groupId: string): Promise<void> {
  await request<unknown>(`/workspace-groups/${encodeURIComponent(groupId)}`, {
    method: 'DELETE',
  });
}
