import type {
  Workspace,
  WorkspaceDeletion,
  WorkspaceGroup,
  WorkspaceGroupInput,
  WorkspaceInput,
  WorkspaceUpdate,
} from '@app/shared';
import type { AppContext } from '../../context.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';

export function createWorkspacesService({ store, runs, mcp, tasks }: AppContext) {
  async function require(id: string): Promise<Workspace> {
    const workspace = await store.getWorkspace(id);
    if (!workspace) throw new NotFoundError("That workspace doesn't exist.");
    return workspace;
  }

  return {
    require,

    list: (): Promise<Workspace[]> => store.listWorkspaces(),

    get: (id: string): Promise<Workspace> => require(id),

    create: (input: WorkspaceInput): Promise<Workspace> => store.createWorkspace(input),

    async update(id: string, changes: WorkspaceUpdate): Promise<Workspace> {
      const current = await require(id);
      if (changes.path !== undefined && changes.path !== current.path && runs.hasRunningIn(id)) {
        throw new ConflictError(
          "A chat in this workspace is still running; its folder can't change now.",
        );
      }
      const updated = await store.updateWorkspace(id, changes);
      if (!updated) throw new NotFoundError("That workspace doesn't exist.");
      // Its MCP servers ran in the old folder; they start again in the new one when needed.
      // Its background tasks are stopped too: they ran in the old folder. Both are kept by
      // id, so a rename needs nothing and other workspaces on the same folder keep theirs.
      if (updated.path !== current.path) {
        await mcp.closeWorkspace(id);
        await tasks.closeWorkspace(id);
      }
      return updated;
    },

    // Sidebar folders: only a way to file workspaces, nothing on disk changes.
    listGroups: (): Promise<WorkspaceGroup[]> => store.listWorkspaceGroups(),

    createGroup: ({ name }: WorkspaceGroupInput): Promise<WorkspaceGroup> =>
      store.createWorkspaceGroup(name),

    async renameGroup(id: string, { name }: WorkspaceGroupInput): Promise<WorkspaceGroup> {
      const renamed = await store.renameWorkspaceGroup(id, name);
      if (!renamed) throw new NotFoundError("That folder doesn't exist.");
      return renamed;
    },

    async removeGroup(id: string): Promise<{ id: string }> {
      if (!(await store.deleteWorkspaceGroup(id))) {
        throw new NotFoundError("That folder doesn't exist.");
      }
      return { id };
    },

    async remove(id: string): Promise<WorkspaceDeletion> {
      const workspace = await require(id);
      if (runs.hasRunningIn(id))
        throw new ConflictError('A chat in this workspace is still running.');
      await mcp.closeWorkspace(workspace.id);
      await tasks.closeWorkspace(workspace.id);
      await store.deleteWorkspace(id);
      return { filesKeptAt: workspace.path };
    },
  };
}

export type WorkspacesService = ReturnType<typeof createWorkspacesService>;
