import { useState, type DragEvent, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { LIMITS, type Workspace, type WorkspaceGroup } from '@app/shared';
import { RowMenu, type RowMenuItem } from '../../components/RowMenu';
import {
  ChevronRightIcon,
  DotsIcon,
  EditIcon,
  FolderIcon,
  FolderOpenIcon,
  TrashIcon,
} from '../../lib/icons';
import { WorkspaceAvatar } from './WorkspaceAvatar';

/** What a dragged workspace row carries; folders and the top-level list accept it. */
export const WORKSPACE_DRAG_TYPE = 'application/x-hamro-workspace';

export const isWorkspaceDrag = (event: DragEvent) =>
  event.dataTransfer.types.includes(WORKSPACE_DRAG_TYPE);

const chatsLabel = (count: number) => `${count} chat${count === 1 ? '' : 's'}`;

const MENU_BUTTON =
  'absolute right-1.5 top-1/2 hidden h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-ink-3 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-ink group-focus-within:grid group-hover:grid aria-expanded:grid [@media(hover:none)]:grid';

/** The ⋯ button of a row and the menu it opens. */
function RowActions({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        className={MENU_BUTTON}
      >
        <DotsIcon size={14} />
      </button>
      {anchor && <RowMenu items={items} anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  );
}

/** A name being typed: a new folder's, or a rename. Enter or leaving saves, Escape cancels. */
export function FolderNameInput({
  initial = '',
  label,
  onDone,
}: {
  initial?: string;
  label: string;
  onDone: (name: string | null) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [isDone, setIsDone] = useState(false);
  const finish = (save: boolean) => {
    if (isDone) return;
    setIsDone(true);
    const name = draft.trim();
    onDone(save && name && name !== initial ? name : null);
  };
  return (
    <div className="flex h-9 items-center gap-2 rounded-lg px-2">
      <FolderIcon size={15} className="shrink-0 text-accent" />
      <input
        autoFocus
        value={draft}
        maxLength={LIMITS.workspaceName}
        aria-label={label}
        placeholder="Folder name"
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') finish(true);
          if (event.key === 'Escape') finish(false);
        }}
        className="min-w-0 flex-1 rounded-md border border-accent bg-surface px-2 py-1 text-[13px] text-ink outline-none ring-2 ring-accent-bg"
      />
    </div>
  );
}

/** A folder's heading: click to open or close it; drop a workspace on it to file it there. */
export function FolderRow({
  group,
  count,
  isOpen,
  isDropTarget,
  onToggle,
  onRename,
  onDelete,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  group: WorkspaceGroup;
  count: number;
  isOpen: boolean;
  isDropTarget: boolean;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent) => void;
}) {
  const Icon = isOpen ? FolderOpenIcon : FolderIcon;
  return (
    <div
      className="group relative"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        type="button"
        onClick={onToggle}
        onDoubleClick={onRename}
        aria-expanded={isOpen}
        title={group.name}
        className={`flex h-9 w-full items-center gap-1.5 rounded-lg pl-1 pr-2 text-left text-[13px] font-medium transition-colors ${
          isDropTarget
            ? 'bg-accent-soft text-ink ring-1 ring-accent'
            : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
        }`}
      >
        <ChevronRightIcon
          size={11}
          className={`shrink-0 text-ink-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
        <Icon size={15} className="shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1 truncate">{group.name}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-ink-4 group-focus-within:invisible group-hover:invisible [@media(hover:none)]:invisible">
          {count}
        </span>
      </button>
      <RowActions
        label={`${group.name} actions`}
        items={[
          { label: 'Rename folder', icon: <EditIcon size={13} />, onSelect: onRename },
          {
            label: 'Delete folder',
            icon: <TrashIcon size={13} />,
            onSelect: onDelete,
            isDanger: true,
          },
        ]}
      />
    </div>
  );
}

/** One workspace: a link, its chat count, and a ⋯ menu to file it in a folder. */
export function WorkspaceRow({
  workspace,
  isCurrent,
  isBusy,
  isCollapsed,
  isIndented,
  moveItems,
  onDragStart,
  onDragEnd,
}: {
  workspace: Workspace;
  isCurrent: boolean;
  isBusy: boolean;
  isCollapsed: boolean;
  isIndented: boolean;
  /** "Move to …" choices; none (no folders yet) hides the ⋯ button. */
  moveItems: RowMenuItem[];
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const count = workspace.chatCount ?? 0;
  const isLocked = isBusy && !isCurrent;
  const title = isLocked ? 'Wait for the agent to finish' : workspace.path;
  const blockWhileBusy = (event: MouseEvent) => {
    if (isBusy) event.preventDefault();
  };

  return (
    <li className="group relative">
      <Link
        to={`/workspaces/${workspace.id}`}
        onClick={blockWhileBusy}
        draggable={!isCollapsed}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        aria-current={isCurrent ? 'page' : undefined}
        aria-disabled={isLocked}
        aria-label={isCollapsed ? workspace.name : undefined}
        title={isCollapsed ? `${workspace.name}\n${title}` : title}
        className={
          isCollapsed
            ? `relative grid h-10 w-10 place-items-center rounded-xl transition-colors ${
                isCurrent ? 'bg-accent-soft ring-1 ring-accent' : 'hover:bg-surface-2'
              } ${isLocked ? 'cursor-not-allowed opacity-60' : ''}`
            : `flex h-9 items-center gap-2.5 rounded-lg pr-2 text-[13px] transition-colors ${
                isIndented ? 'pl-6' : 'pl-2'
              } ${
                isCurrent
                  ? 'bg-accent-soft font-semibold text-ink'
                  : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
              } ${isLocked ? 'cursor-not-allowed opacity-60' : ''}`
        }
      >
        <WorkspaceAvatar id={workspace.id} name={workspace.name} size={isCollapsed ? 'md' : 'sm'} />
        {!isCollapsed && (
          <>
            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
            {count > 0 && (
              <span
                title={chatsLabel(count)}
                className={`shrink-0 rounded-full bg-surface-2 px-1.5 text-[11px] font-medium leading-5 tabular-nums text-ink-3 ${
                  moveItems.length
                    ? 'group-focus-within:invisible group-hover:invisible [@media(hover:none)]:invisible'
                    : ''
                }`}
              >
                {count}
              </span>
            )}
          </>
        )}
      </Link>
      {!isCollapsed && moveItems.length > 0 && (
        <RowActions label={`Move ${workspace.name}`} items={moveItems} />
      )}
    </li>
  );
}
