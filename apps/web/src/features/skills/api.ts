import type { ImprovedSkill, Skill, SkillImproveRequest, SkillInput } from '@app/shared';
import { jsonBody, request, requestBlob } from '../../lib/api';

const path = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/skills`;
const skillPath = (workspaceId: string, name: string) =>
  `${path(workspaceId)}/${encodeURIComponent(name)}`;

export function fetchSkills(workspaceId: string): Promise<Skill[]> {
  return request<Skill[]>(path(workspaceId));
}

export function fetchSkill(workspaceId: string, name: string): Promise<Skill> {
  return request<Skill>(skillPath(workspaceId, name));
}

export function createSkill(workspaceId: string, input: SkillInput): Promise<Skill> {
  return request<Skill>(path(workspaceId), jsonBody('POST', input));
}

/** Saves `name` as `input`; a different `input.name` renames it. */
export function updateSkill(workspaceId: string, name: string, input: SkillInput): Promise<Skill> {
  return request<Skill>(skillPath(workspaceId, name), jsonBody('PUT', input));
}

/** The instructions rewritten by the default model, with a suggested description. */
export function improveSkill(input: SkillImproveRequest): Promise<ImprovedSkill> {
  return request<ImprovedSkill>('/prompts/skill', jsonBody('POST', input));
}

/** The bytes as base64, without the data URL prefix. */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Couldn't read ${file.name}.`));
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** A file picked from a folder, with its path inside the picked folder (`webkitRelativePath`). */
export interface PickedSkillFile {
  path: string;
  file: File;
}

/**
 * Uploads a skill folder (SKILL.md plus its files). `replace`: overwrite a skill with the same
 * name; otherwise that's an ApiError with status 409.
 */
export async function uploadSkill(
  workspaceId: string,
  picked: readonly PickedSkillFile[],
  { replace = false }: { replace?: boolean } = {},
): Promise<Skill> {
  const files = await Promise.all(
    picked.map(async ({ path, file }) => ({ path, data: await readBase64(file) })),
  );
  return request<Skill>(`${path(workspaceId)}/upload`, jsonBody('POST', { files, replace }));
}

/** One of a folder skill's files, to show or save in the browser. */
export function fetchSkillFile(workspaceId: string, name: string, filePath: string): Promise<Blob> {
  return requestBlob(`${skillPath(workspaceId, name)}/file?path=${encodeURIComponent(filePath)}`);
}

export function deleteSkill(workspaceId: string, name: string): Promise<void> {
  return request<void>(skillPath(workspaceId, name), { method: 'DELETE' });
}
