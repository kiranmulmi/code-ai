import type { SpecialistInfo, SpecialistInput, SpecialistList } from '@app/shared';
import { jsonBody, request } from '../../lib/api';

const path = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/agents`;
const agentPath = (workspaceId: string, name: string) =>
  `${path(workspaceId)}/${encodeURIComponent(name)}`;

/** The workspace's own specialists, the built-ins, and files that couldn't be used. */
export function fetchAgents(workspaceId: string): Promise<SpecialistList> {
  return request<SpecialistList>(path(workspaceId));
}

export function fetchAgent(workspaceId: string, name: string): Promise<SpecialistInfo> {
  return request<SpecialistInfo>(agentPath(workspaceId, name));
}

export function createAgent(workspaceId: string, input: SpecialistInput): Promise<SpecialistInfo> {
  return request<SpecialistInfo>(path(workspaceId), jsonBody('POST', input));
}

/** Saves `name` as `input`; a different `input.name` renames it. Also fixes a broken file. */
export function updateAgent(
  workspaceId: string,
  name: string,
  input: SpecialistInput,
): Promise<SpecialistInfo> {
  return request<SpecialistInfo>(agentPath(workspaceId, name), jsonBody('PUT', input));
}

/** By name, or a broken file by its file name ("Bad_Name.md"). */
export function deleteAgent(workspaceId: string, nameOrFile: string): Promise<void> {
  return request<void>(agentPath(workspaceId, nameOrFile), { method: 'DELETE' });
}
