import { AgentExistsError } from '@app/db';
import type { SpecialistData, SpecialistInfo, SpecialistList } from '@app/shared';
import type { AppContext } from '../../context.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';

/**
 * A workspace's own specialist sub-agents (its .hamro-ai/<workspace>/agents/), managed in the Agents tab.
 * The list also has the built-in specialists, which can't be changed here (a file with a
 * built-in's name replaces it), and the files that couldn't be used, with why.
 */
export function createAgentsService(
  { store }: Pick<AppContext, 'store'>,
  workspaces: Pick<WorkspacesService, 'require'>,
) {
  const agentsOf = async (workspaceId: string) =>
    store.agents(await workspaces.require(workspaceId));

  /** A taken name is a 409, so the form can say so next to the name. */
  const conflictIfTaken = (error: unknown): never => {
    if (error instanceof AgentExistsError) throw new ConflictError(error.message);
    throw error;
  };
  const missing = (name: string) =>
    new NotFoundError(`This workspace has no specialist file called "${name}".`);

  return {
    async list(workspaceId: string): Promise<SpecialistList> {
      return (await agentsOf(workspaceId)).overview();
    },

    async get(workspaceId: string, name: string): Promise<SpecialistInfo> {
      const found = await (await agentsOf(workspaceId)).get(name);
      if (!found) throw missing(name);
      return found;
    },

    async create(workspaceId: string, input: SpecialistData): Promise<SpecialistInfo> {
      return (await agentsOf(workspaceId)).create(input).catch(conflictIfTaken);
    },

    /** Also saves over a broken file with that name, which fixes it. */
    async update(
      workspaceId: string,
      name: string,
      input: SpecialistData,
    ): Promise<SpecialistInfo> {
      const saved = await (await agentsOf(workspaceId)).update(name, input).catch(conflictIfTaken);
      if (!saved) throw missing(name);
      return saved;
    },

    /** By name ("security-auditor") or, for a broken file, its file name ("Bad_Name.md"). */
    async remove(workspaceId: string, nameOrFile: string): Promise<void> {
      if (!(await (await agentsOf(workspaceId)).remove(nameOrFile))) throw missing(nameOrFile);
    },
  };
}

export type AgentsService = ReturnType<typeof createAgentsService>;
