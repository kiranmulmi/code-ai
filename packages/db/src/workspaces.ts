// The list of workspaces (id, name, folder, sidebar folder) and the sidebar folders that
// collect them ("groups"), in ~/.hamro-ai/workspaces.json. Everything else about a workspace
// lives in its own folder (workspace-data.ts), which other workspaces may share.
import { randomUUID } from 'node:crypto';
import { workspaceSlug } from '@app/shared';
import { serialized } from '@app/agent';
import { z } from 'zod';
import { InputError } from './errors.js';
import { readJson, writePrivateJson } from './json-file.js';
import { isUuid } from './workspace-data.js';

const savedWorkspaceSchema = z.object({
  id: z.string().refine(isUuid, 'must be a UUID'),
  name: z.string().min(1),
  /** Absolute, real path of the folder. */
  path: z.string().min(1),
  createdAt: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
  /** The sidebar folder it's filed in; null at the top level. */
  groupId: z.string().nullable().default(null),
});

export type SavedWorkspace = z.output<typeof savedWorkspaceSchema>;

const savedGroupSchema = z.object({
  id: z.string().refine(isUuid, 'must be a UUID'),
  name: z.string().min(1),
  createdAt: z.string().nullable().default(null),
});

export type SavedWorkspaceGroup = z.output<typeof savedGroupSchema>;

const workspacesFileSchema = z.object({
  workspaces: z.array(savedWorkspaceSchema).default([]),
  groups: z.array(savedGroupSchema).default([]),
});

type WorkspacesFile = z.output<typeof workspacesFileSchema>;

export class WorkspaceList {
  constructor(readonly file: string) {}

  /** Oldest first. A workspace whose folder is gone shows at the top level. */
  async list(): Promise<SavedWorkspace[]> {
    const { workspaces, groups } = await this.#read();
    const groupIds = new Set(groups.map((group) => group.id));
    return workspaces.map((w) =>
      w.groupId && !groupIds.has(w.groupId) ? { ...w, groupId: null } : w,
    );
  }

  /** The sidebar folders, oldest first. */
  async listGroups(): Promise<SavedWorkspaceGroup[]> {
    return (await this.#read()).groups;
  }

  async addGroup(name: string): Promise<SavedWorkspaceGroup> {
    return this.#changeFile((file) => {
      const added = { id: randomUUID(), name, createdAt: new Date().toISOString() };
      return { file: { ...file, groups: [...file.groups, added] }, result: added };
    });
  }

  async renameGroup(id: string, name: string): Promise<SavedWorkspaceGroup | null> {
    return this.#changeFile((file) => {
      const current = file.groups.find((group) => group.id === id);
      if (!current) return { file, result: null };
      const renamed = { ...current, name };
      return {
        file: { ...file, groups: file.groups.map((g) => (g.id === id ? renamed : g)) },
        result: renamed,
      };
    });
  }

  /** Its workspaces move to the top level; none are deleted. */
  async removeGroup(id: string): Promise<boolean> {
    return this.#changeFile((file) => {
      if (!file.groups.some((group) => group.id === id)) return { file, result: false };
      return {
        file: {
          groups: file.groups.filter((group) => group.id !== id),
          workspaces: file.workspaces.map((w) => (w.groupId === id ? { ...w, groupId: null } : w)),
        },
        result: true,
      };
    });
  }

  /** Files the workspace in a sidebar folder (null: the top level). */
  async setGroup(id: string, groupId: string | null): Promise<SavedWorkspace | null> {
    return this.#changeFile((file) => {
      const current = file.workspaces.find((w) => w.id === id);
      if (!current) return { file, result: null };
      if (groupId !== null && !file.groups.some((group) => group.id === groupId)) {
        throw new InputError("That folder doesn't exist any more.");
      }
      const moved = { ...current, groupId };
      return {
        file: { ...file, workspaces: file.workspaces.map((w) => (w.id === id ? moved : w)) },
        result: moved,
      };
    });
  }

  async get(id: string): Promise<SavedWorkspace | null> {
    if (!isUuid(id)) return null;
    return (await this.list()).find((w) => w.id === id) ?? null;
  }

  /** No other workspace may use `path` under a name with the same slug (workspaceSlug). */
  async add(name: string, path: string): Promise<SavedWorkspace> {
    return this.#change((workspaces) => {
      assertFolderFree(workspaces, path, name);
      const now = new Date().toISOString();
      const added = { id: randomUUID(), name, path, createdAt: now, updatedAt: now, groupId: null };
      return { workspaces: [...workspaces, added], result: added };
    });
  }

  async update(
    id: string,
    changes: { name: string; path: string },
  ): Promise<SavedWorkspace | null> {
    return this.#change((workspaces) => {
      const current = workspaces.find((w) => w.id === id);
      if (!current) return { workspaces, result: null };
      assertFolderFree(workspaces, changes.path, changes.name, id);
      const updated = { ...current, ...changes, updatedAt: new Date().toISOString() };
      return {
        workspaces: workspaces.map((w) => (w.id === id ? updated : w)),
        result: updated,
      };
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.#change((workspaces) => {
      const left = workspaces.filter((w) => w.id !== id);
      const isRemoved = left.length < workspaces.length;
      return { workspaces: isRemoved ? left : workspaces, result: isRemoved };
    });
  }

  /**
   * Throws when another workspace than `exceptId` already uses `path` under a name with the
   * same slug, as both would keep their data in the same subfolder.
   */
  async assertFolderFree(path: string, name: string, exceptId?: string): Promise<void> {
    assertFolderFree(await this.list(), path, name, exceptId);
  }

  async #read(): Promise<WorkspacesFile> {
    const raw = await readJson(this.file);
    if (raw === null) return { workspaces: [], groups: [] };
    const parsed = workspacesFileSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `${this.file} is damaged: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim(),
      );
    }
    return parsed.data;
  }

  /** Read, change and write the file as one step, so concurrent changes can't lose each other. */
  #changeFile<T>(
    update: (file: WorkspacesFile) => { file: WorkspacesFile; result: T },
  ): Promise<T> {
    return serialized(this.file, async () => {
      const before = await this.#read();
      const { file, result } = update(before);
      if (file !== before) await writePrivateJson(this.file, file);
      return result;
    });
  }

  /** `#changeFile` for changes to the workspaces only (the folders are kept as they are). */
  #change<T>(
    update: (workspaces: SavedWorkspace[]) => { workspaces: SavedWorkspace[]; result: T },
  ): Promise<T> {
    return this.#changeFile((file) => {
      const { workspaces, result } = update(file.workspaces);
      return { file: workspaces === file.workspaces ? file : { ...file, workspaces }, result };
    });
  }
}

function assertFolderFree(
  workspaces: SavedWorkspace[],
  path: string,
  name: string,
  exceptId?: string,
): void {
  const slug = workspaceSlug(name);
  const owner = workspaces.find(
    (w) => w.path === path && w.id !== exceptId && workspaceSlug(w.name) === slug,
  );
  if (owner) {
    throw new InputError(
      `The workspace "${owner.name}" already uses that folder with a name that's too similar. Pick another name.`,
    );
  }
}
