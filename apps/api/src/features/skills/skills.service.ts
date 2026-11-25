import { SkillExistsError } from '@app/db';
import { SKILL_LIMITS, type Skill, type SkillInput, type SkillUpload } from '@app/shared';
import type { AppContext } from '../../context.js';
import {
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
} from '../../lib/errors.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';

/** Base64 of the largest skill folder, plus room for the paths and the rest of the JSON. */
export const SKILL_UPLOAD_BODY_LIMIT = `${Math.ceil((SKILL_LIMITS.totalBytes * 4) / 3 / (1024 * 1024)) + 1}mb`;

/** A workspace's skills (its .code-ai/<workspace>/skills/), written or uploaded from the Skills tab. */
export function createSkillsService({ store }: AppContext, workspaces: WorkspacesService) {
  const skillsOf = async (workspaceId: string) =>
    store.skills(await workspaces.require(workspaceId));

  /** A taken name is a 409, so the form can say so next to the name. */
  const conflictIfTaken = (error: unknown): never => {
    if (error instanceof SkillExistsError) throw new ConflictError(error.message);
    throw error;
  };

  return {
    async list(workspaceId: string): Promise<Skill[]> {
      return (await skillsOf(workspaceId)).list();
    },

    async get(workspaceId: string, name: string): Promise<Skill> {
      const skill = await (await skillsOf(workspaceId)).get(name);
      if (!skill) throw new NotFoundError(`There's no skill called "${name}".`);
      return skill;
    },

    async create(workspaceId: string, input: SkillInput): Promise<Skill> {
      return (await skillsOf(workspaceId)).create(input).catch(conflictIfTaken);
    },

    async update(workspaceId: string, name: string, input: SkillInput): Promise<Skill> {
      const skill = await (await skillsOf(workspaceId)).update(name, input).catch(conflictIfTaken);
      if (!skill) throw new NotFoundError(`There's no skill called "${name}".`);
      return skill;
    },

    /** A skill folder (SKILL.md plus its files); a 409 when the name is taken and `replace` is off. */
    async upload(workspaceId: string, { files, replace = false }: SkillUpload): Promise<Skill> {
      // Checked before decoding, so an oversized upload costs no memory.
      const encoded = files.reduce((sum, file) => sum + file.data.length, 0);
      if (Math.floor((encoded * 3) / 4) > SKILL_LIMITS.totalBytes + 2 * files.length) {
        throw new PayloadTooLargeError(
          `The skill is too large: at most ${SKILL_LIMITS.totalBytes / (1024 * 1024)} MB in all.`,
        );
      }
      const decoded = files.map((file) => ({
        path: file.path,
        bytes: Buffer.from(file.data, 'base64'),
      }));
      return (await skillsOf(workspaceId)).upload(decoded, { replace }).catch(conflictIfTaken);
    },

    /** One of a folder skill's files, to show in the Skills tab. */
    async file(workspaceId: string, name: string, filePath: string): Promise<Buffer> {
      const bytes = await (await skillsOf(workspaceId)).readFile(name, filePath);
      if (!bytes) throw new NotFoundError(`The skill "${name}" has no file "${filePath}".`);
      return bytes;
    },

    async remove(workspaceId: string, name: string): Promise<void> {
      if (!(await (await skillsOf(workspaceId)).remove(name))) {
        throw new NotFoundError(`There's no skill called "${name}".`);
      }
    },

    /** The skills the user picked for a message, checked before the run starts. */
    async requireAll(
      workspace: { path: string; name: string },
      names: readonly string[],
    ): Promise<Skill[]> {
      const skills = store.skills(workspace);
      const found = await Promise.all([...new Set(names)].map((name) => skills.get(name)));
      const missing = names.filter((name, i) => !found[i]);
      if (missing.length) {
        throw new ValidationError(
          `${missing.length === 1 ? 'This skill no longer exists' : 'These skills no longer exist'}: ${missing.join(', ')}. Pick again.`,
        );
      }
      return found.filter((skill): skill is Skill => skill !== null);
    },
  };
}

export type SkillsService = ReturnType<typeof createSkillsService>;
