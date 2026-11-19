import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AppInfo, Workspace, WorkspaceGroup } from '@app/shared';
import { AccountMenu } from '../auth/AccountMenu';
import { SidebarLinks } from '../chat/SidebarLinks';
import { SidebarResizer } from '../chat/SidebarResizer';
import type { useSidebarWidth } from '../chat/useSidebarWidth';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { IconButton } from '../../components/IconButton';
import type { RowMenuItem } from '../../components/RowMenu';
import { BrandLink } from '../../layout/BrandLink';
import { ThemeToggle } from '../../layout/ThemeToggle';
import { errorMessage } from '../../lib/api';
import {
  GearIcon,
  CrossIcon,
  FolderIcon,
  FolderPlusIcon,
  LogoIcon,
  PanelIcon,
  PlusIcon,
  SearchIcon,
} from '../../lib/icons';
import { useToast } from '../../lib/toast';
import { useStoredState } from '../../lib/useStoredState';
import {
  createWorkspaceGroup,
  deleteWorkspaceGroup,
  renameWorkspaceGroup,
  updateWorkspace,
} from './api';
import { arrangeWorkspaces, byRecentActivity } from './workspaceFolders';
import {
  FolderNameInput,
  FolderRow,
  WORKSPACE_DRAG_TYPE,
  WorkspaceRow,
  isWorkspaceDrag,
} from './WorkspaceSidebarRows';

/**
 * The expanded column's default and smallest widths (the user can drag it wider); the collapsed
 * rail is `WORKSPACE_RAIL_WIDTH`. ChatScreen sizes the grid and sets `--workspaces-w`.
 */
export const WORKSPACE_SIDEBAR_WIDTH = 232;
export const WORKSPACE_SIDEBAR_MIN_WIDTH = 200;
/** The expanded column's content width, so it doesn't reflow while the column animates. */
const EXPANDED_MIN_WIDTH = 'var(--workspaces-w)';
export const WORKSPACE_RAIL_WIDTH = 64;

/** Closed folders, by id (a UI preference, so localStorage). */
const CLOSED_FOLDERS_KEY = 'agent.workspaceFoldersClosed';
const parseIds = (stored: string | null): string[] => {
  try {
    const value: unknown = JSON.parse(stored ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};
const serializeIds = (ids: string[]) => JSON.stringify(ids);

/** Where a dragged workspace would land: a folder's id, or `top` for no folder. */
type DropTarget = string | 'top' | null;

/**
 * The workspaces, in a column of their own at the far left of the chat screen (wide screens
 * only; narrower ones switch from the chats drawer). Expanded it lists the folders the user made
 * (open or closed, each with its workspaces) and the workspaces in none, with a search box;
 * collapsed it is a rail of avatars. A workspace moves into or out of a folder from its ⋯ menu
 * or by dragging it. Switching is off while the agent works.
 */
export function WorkspaceSidebar({
  current,
  workspaces,
  groups,
  isBusy,
  isCollapsed,
  width,
  info,
  infoError,
  onToggle,
  onFiled,
  onChanged,
}: {
  current: Workspace | null;
  workspaces: Workspace[];
  /** The sidebar folders. */
  groups: WorkspaceGroup[];
  isBusy: boolean;
  /** The server's info, for the footer's offline warning. */
  info: AppInfo | null;
  infoError: unknown;
  isCollapsed: boolean;
  /** The expanded column's width, dragged from its right edge. */
  width: ReturnType<typeof useSidebarWidth>;
  onToggle: () => void;
  /** Show a workspace in its new folder at once, before the lists load again. */
  onFiled: (workspaceId: string, groupId: string | null) => void;
  /** A folder or a workspace's folder changed: load both lists again. */
  onChanged: () => void;
}) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const toast = useToast();
  const [closedIds, setClosedIds] = useStoredState(CLOSED_FOLDERS_KEY, parseIds, serializeIds);
  const [isCreating, setIsCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceGroup | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);

  const needle = isCollapsed ? '' : query.trim().toLowerCase();
  const arranged = useMemo(
    () => arrangeWorkspaces(workspaces, groups, needle),
    [workspaces, groups, needle],
  );
  const rail = useMemo(() => byRecentActivity(workspaces), [workspaces]);
  const firstMatch = arranged.folders.flatMap((f) => f.workspaces)[0] ?? arranged.loose[0];

  const setOpen = (id: string, isOpen: boolean) =>
    setClosedIds(isOpen ? closedIds.filter((c) => c !== id) : [...closedIds, id]);

  const run = async (action: () => Promise<unknown>, failure: string, success?: string) => {
    try {
      await action();
      if (success) toast(success);
    } catch (cause) {
      toast(errorMessage(cause, failure), 'error');
    } finally {
      onChanged();
    }
  };

  const createFolder = (name: string | null) => {
    setIsCreating(false);
    if (name) void run(() => createWorkspaceGroup({ name }), "Couldn't make the folder.");
  };
  const renameFolder = (group: WorkspaceGroup, name: string | null) => {
    setRenamingId(null);
    if (name) {
      void run(() => renameWorkspaceGroup(group.id, { name }), "Couldn't rename the folder.");
    }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    await run(
      () => deleteWorkspaceGroup(deleting.id),
      "Couldn't delete the folder.",
      `Deleted ${deleting.name}; its workspaces are kept.`,
    );
    setIsDeleting(false);
    setDeleting(null);
  };
  const moveTo = (workspace: Workspace, groupId: string | null) => {
    if ((workspace.groupId ?? null) === groupId) return;
    if (groupId) setOpen(groupId, true);
    onFiled(workspace.id, groupId);
    void run(() => updateWorkspace(workspace.id, { groupId }), `Couldn't move ${workspace.name}.`);
  };

  const moveItems = (workspace: Workspace): RowMenuItem[] => {
    if (groups.length === 0) return [];
    const items: RowMenuItem[] = arranged.folders
      .map((f) => f.group)
      .concat(groups.filter((g) => !arranged.folders.some((f) => f.group.id === g.id)))
      .filter((group) => group.id !== workspace.groupId)
      .map((group) => ({
        label: `Move to ${group.name}`,
        icon: <FolderIcon size={13} />,
        onSelect: () => moveTo(workspace, group.id),
      }));
    if (workspace.groupId) {
      items.push({
        label: 'Remove from folder',
        icon: <CrossIcon size={11} />,
        onSelect: () => moveTo(workspace, null),
      });
    }
    return items;
  };

  // Drag a workspace onto a folder to file it there, or onto the list's top level to take it out.
  const dropHandlers = (target: string | 'top') => ({
    onDragOver: (event: DragEvent) => {
      if (!isWorkspaceDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      if (dropTarget !== target) setDropTarget(target);
    },
    onDragLeave: () => setDropTarget((value) => (value === target ? null : value)),
    onDrop: (event: DragEvent) => {
      if (!isWorkspaceDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(null);
      const workspace = workspaces.find(
        (w) => w.id === event.dataTransfer.getData(WORKSPACE_DRAG_TYPE),
      );
      if (workspace) moveTo(workspace, target === 'top' ? null : target);
    },
  });
  const dragHandlers = (workspace: Workspace) => ({
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(WORKSPACE_DRAG_TYPE, workspace.id);
      event.dataTransfer.effectAllowed = 'move';
      setDragId(workspace.id);
    },
    onDragEnd: () => {
      setDragId(null);
      setDropTarget(null);
    },
  });
  const dragged = workspaces.find((w) => w.id === dragId);
  const isTopDrop = dropTarget === 'top' && Boolean(dragged?.groupId);

  const row = (workspace: Workspace, isIndented: boolean) => (
    <WorkspaceRow
      key={workspace.id}
      workspace={workspace}
      isCurrent={workspace.id === current?.id}
      isBusy={isBusy}
      isCollapsed={isCollapsed}
      isIndented={isIndented}
      moveItems={moveItems(workspace)}
      {...dragHandlers(workspace)}
    />
  );

  return (
    <nav
      id="workspace-sidebar"
      aria-label="Workspaces"
      className="relative z-10 hidden min-h-0 flex-col overflow-hidden border-r border-line-2 bg-subtle xl:flex"
    >
      {!isCollapsed && (
        <SidebarResizer
          width={width.width}
          onResize={width.setWidth}
          onReset={width.reset}
          label="Resize workspaces sidebar"
        />
      )}
      <div
        className={`titlebar flex h-12 shrink-0 items-center border-b border-line ${
          isCollapsed ? 'justify-center' : 'gap-1 pl-[calc(1rem+var(--titlebar-inset))] pr-2'
        }`}
      >
        {isCollapsed ? (
          <Link
            to="/"
            aria-label="Home"
            title="Nimbrio AI"
            className="brand-mark [[data-desktop]_&]:hidden"
          >
            <LogoIcon />
          </Link>
        ) : (
          <>
            <BrandLink isHiddenInDesktopApp />
            <IconButton
              onClick={onToggle}
              aria-controls="workspace-sidebar"
              aria-expanded
              aria-label="Collapse workspaces"
              title="Collapse workspaces"
              className="ml-auto"
            >
              <PanelIcon size={15} className="-scale-x-100" />
            </IconButton>
          </>
        )}
      </div>

      {isCollapsed ? (
        <div className="flex shrink-0 justify-center pt-3">
          <IconButton
            onClick={onToggle}
            aria-controls="workspace-sidebar"
            aria-expanded={false}
            aria-label="Expand workspaces"
            title="Expand workspaces"
          >
            <PanelIcon size={15} className="-scale-x-100" />
          </IconButton>
        </div>
      ) : (
        // Fixed width while the column animates, so it clips instead of squeezing.
        <div className="shrink-0 px-3 pt-3" style={{ minWidth: EXPANDED_MIN_WIDTH }}>
          <label className="group/search relative flex items-center">
            <span className="sr-only">Search workspaces</span>
            <SearchIcon
              size={14}
              className="pointer-events-none absolute left-2.5 text-ink-3 transition-colors group-focus-within/search:text-accent"
            />
            <input
              type="search"
              value={query}
              placeholder="Search workspaces"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery('');
                if (event.key !== 'Enter' || !firstMatch || isBusy) return;
                event.preventDefault();
                navigate(`/workspaces/${firstMatch.id}`);
              }}
              className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-7 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
                className="absolute right-1.5 grid h-5 w-5 place-items-center rounded text-ink-3 hover:text-ink"
              >
                <CrossIcon size={11} />
              </button>
            )}
          </label>
        </div>
      )}

      <div
        className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:thin] ${
          isCollapsed ? 'px-2 py-3' : 'px-2 pb-2 pt-3'
        }`}
        style={isCollapsed ? undefined : { minWidth: EXPANDED_MIN_WIDTH }}
        {...(isCollapsed ? {} : dropHandlers('top'))}
      >
        {isCollapsed ? (
          <ul className="flex flex-col items-center gap-1.5">
            {rail.map((workspace) => row(workspace, false))}
          </ul>
        ) : (
          <>
            <div className="flex items-center pb-1 pl-2">
              <p className="flex-1 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
                {needle ? `${arranged.shown} of ${workspaces.length}` : 'Workspaces'}
              </p>
              <button
                type="button"
                onClick={() => setIsCreating(true)}
                aria-label="New folder"
                title="New folder"
                className="grid h-6 w-6 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <FolderPlusIcon size={14} />
              </button>
            </div>
            {isCreating && <FolderNameInput label="New folder name" onDone={createFolder} />}
            {needle && arranged.shown === 0 && arranged.folders.length === 0 && (
              <p className="px-2 py-2 text-[12.5px] text-ink-3">
                No workspaces match “{query.trim()}”
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {arranged.folders.map(({ group, workspaces: inside }) => {
                // A search opens every folder it found something in.
                const isOpen = Boolean(needle) || !closedIds.includes(group.id);
                return (
                  <li key={group.id}>
                    {renamingId === group.id ? (
                      <FolderNameInput
                        label="Folder name"
                        initial={group.name}
                        onDone={(name) => renameFolder(group, name)}
                      />
                    ) : (
                      <FolderRow
                        group={group}
                        count={inside.length}
                        isOpen={isOpen}
                        isDropTarget={dropTarget === group.id && dragged?.groupId !== group.id}
                        onToggle={() => setOpen(group.id, !isOpen)}
                        onRename={() => setRenamingId(group.id)}
                        onDelete={() => setDeleting(group)}
                        {...dropHandlers(group.id)}
                      />
                    )}
                    {isOpen && inside.length > 0 && (
                      <ul className="mt-0.5 flex flex-col gap-0.5">
                        {inside.map((workspace) => row(workspace, true))}
                      </ul>
                    )}
                    {isOpen && inside.length === 0 && !needle && (
                      <p className="py-1.5 pl-9 pr-2 text-[12px] text-ink-4">
                        Drag a workspace here, or use its ⋯ menu.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            {arranged.folders.length > 0 && arranged.loose.length > 0 && (
              <div className="mx-2 my-1.5 border-t border-line" aria-hidden="true" />
            )}
            <ul
              className={`flex flex-col gap-0.5 rounded-lg transition-shadow ${
                isTopDrop ? 'ring-1 ring-accent' : ''
              }`}
            >
              {arranged.loose.map((workspace) => row(workspace, false))}
            </ul>
            {isTopDrop && (
              <p className="px-2 py-1.5 text-[12px] text-accent">
                Drop to take it out of its folder
              </p>
            )}
          </>
        )}
      </div>

      {isCollapsed ? (
        <div className="flex shrink-0 flex-col items-center gap-1 border-t border-line p-2">
          <RailLink
            to="/workspaces/new"
            from={current ? `/workspaces/${current.id}` : '/'}
            label="New workspace"
            isBusy={isBusy}
          >
            <PlusIcon size={12} />
          </RailLink>
          <RailLink
            to="/settings/models"
            from={current ? `/workspaces/${current.id}` : '/'}
            label="Preferences"
            isBusy={false}
          >
            <GearIcon size={12} />
          </RailLink>
          <ThemeToggle size="sm" />
        </div>
      ) : (
        <div className="shrink-0 border-t border-line" style={{ minWidth: EXPANDED_MIN_WIDTH }}>
          <SidebarLinks info={info} error={infoError} isBusy={isBusy} only="app" />
          <AccountMenu />
        </div>
      )}
      <ConfirmDeleteDialog
        open={deleting !== null}
        title={`Delete the folder ${deleting?.name ?? ''}?`}
        message="Its workspaces stay, with their chats and files: they move back to the top of the list."
        confirmLabel="Delete folder"
        busy={isDeleting}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </nav>
  );
}

/** An icon-only link in the collapsed rail's footer, greyed while the agent works. */
function RailLink({
  to,
  from,
  label,
  isBusy,
  children,
}: {
  to: string;
  from: string;
  label: string;
  isBusy: boolean;
  children: ReactNode;
}) {
  const icon = (
    <span className="grid h-6 w-6 place-items-center rounded-lg bg-accent-soft text-accent-2">
      {children}
    </span>
  );
  if (isBusy) {
    return (
      <span
        aria-label={label}
        title="Wait for the agent to finish"
        className="grid h-10 w-10 cursor-not-allowed place-items-center rounded-xl opacity-50"
      >
        {icon}
      </span>
    );
  }
  return (
    <Link
      to={to}
      state={{ from }}
      aria-label={label}
      title={label}
      className="grid h-10 w-10 place-items-center rounded-xl transition-colors hover:bg-surface-2"
    >
      {icon}
    </Link>
  );
}
