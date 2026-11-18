import type { Workspace, WorkspaceGroup } from '@app/shared';

export interface WorkspaceFolder {
  group: WorkspaceGroup;
  workspaces: Workspace[];
}

export interface ArrangedWorkspaces {
  /** By name; while searching, only folders whose name or workspaces match. */
  folders: WorkspaceFolder[];
  /** Workspaces in no folder (or in one that's gone). */
  loose: Workspace[];
  /** How many workspaces are shown, for the "3 of 20" count. */
  shown: number;
}

const activity = (workspace: Workspace): number =>
  Date.parse(workspace.lastActiveAt ?? workspace.updatedAt ?? workspace.createdAt ?? '') || 0;

/** Most recently active first (a chat used, else the workspace edited); ties by name. */
export function byRecentActivity(workspaces: Workspace[]): Workspace[] {
  return [...workspaces].sort((a, b) => activity(b) - activity(a) || a.name.localeCompare(b.name));
}

const matches = (workspace: Workspace, needle: string) =>
  workspace.name.toLowerCase().includes(needle) || workspace.path.toLowerCase().includes(needle);

/**
 * Files the workspaces into their sidebar folders, most recently active first in each. A
 * search (`needle`, lower case) keeps the matching workspaces, and every workspace of a folder
 * whose own name matches.
 */
export function arrangeWorkspaces(
  workspaces: Workspace[],
  groups: WorkspaceGroup[],
  needle = '',
): ArrangedWorkspaces {
  const sorted = byRecentActivity(workspaces);
  const known = new Set(groups.map((group) => group.id));
  let shown = 0;

  const folders = [...groups]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .flatMap((group) => {
      const inside = sorted.filter((workspace) => workspace.groupId === group.id);
      const isNameMatch = !needle || group.name.toLowerCase().includes(needle);
      const kept = isNameMatch ? inside : inside.filter((w) => matches(w, needle));
      if (needle && !isNameMatch && kept.length === 0) return [];
      shown += kept.length;
      return [{ group, workspaces: kept }];
    });

  const loose = sorted.filter(
    (w) => !(w.groupId && known.has(w.groupId)) && (!needle || matches(w, needle)),
  );
  shown += loose.length;
  return { folders, loose, shown };
}
