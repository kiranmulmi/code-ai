import { useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { LIMITS, type Workspace, type WorkspaceGroup } from '@app/shared';
import { RowMenu, type RowMenuItem } from '../../components/RowMenu';
import { Spinner } from '../../components/Spinner';
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

const MENU_BUTTON =
  'absolute right-1 top-1/2 hidden h-5 w-5 -translate-y-1/2 place-items-center rounded text-ink-3 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-ink group-focus-within:grid group-hover:grid aria-expanded:grid [@media(hover:none)]:grid';

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
        <DotsIcon size={13} />
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
    <div className="flex h-[22px] items-center gap-1.5 pl-[27px] pr-2">
      <FolderIcon size={14} className="shrink-0 text-ft-folder" />
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
        className="min-w-0 flex-1 rounded-sm border border-accent bg-surface px-1 py-0 font-explorer text-[13px] leading-[18px] text-ink outline-none"
      />
    </div>
  );
}

/** A folder's heading: click to open or close it; drop a workspace on it to file it there. */
export function FolderRow({
  group,
  count,
  isRunning,
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
  /** The agent is working in one of its workspaces. */
  isRunning: boolean;
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
        className={`flex h-[22px] w-full items-center gap-1.5 rounded pl-2.5 pr-2 text-left font-explorer text-[13px] leading-[18px] transition-colors ${
          isDropTarget
            ? 'bg-accent-soft text-ink ring-1 ring-accent'
            : 'text-ink hover:bg-surface-2'
        }`}
      >
        <ChevronRightIcon
          size={11}
          className={`shrink-0 text-ink-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
        <Icon size={14} className="shrink-0 text-ft-folder" />
        <span className="min-w-0 flex-1 truncate">{group.name}</span>
        {isRunning && <RunningMark className="group-focus-within:hidden group-hover:hidden" />}
        <span className="shrink-0 text-[10.5px] tabular-nums text-ink-4 group-focus-within:invisible group-hover:invisible [@media(hover:none)]:invisible">
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

/** One workspace: a link and a ⋯ menu to file it in a folder. */
export function WorkspaceRow({
  workspace,
  isCurrent,
  isRunning,
  isCollapsed,
  isIndented,
  moveItems,
  onDragStart,
  onDragEnd,
}: {
  workspace: Workspace;
  isCurrent: boolean;
  /** The agent is working here (a run this tab started): a spinner shows it. */
  isRunning: boolean;
  isCollapsed: boolean;
  isIndented: boolean;
  /** "Move to …" choices; none (no folders yet) hides the ⋯ button. */
  moveItems: RowMenuItem[];
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const title = isRunning ? `${workspace.path}\nThe agent is working here` : workspace.path;

  return (
    <li className="group relative animate-slide-in-left">
      <Link
        to={`/workspaces/${workspace.id}`}
        draggable={!isCollapsed}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        aria-current={isCurrent ? 'page' : undefined}
        aria-label={isCollapsed ? workspace.name : undefined}
        title={isCollapsed ? `${workspace.name}\n${title}` : title}
        className={
          isCollapsed
            ? `relative grid h-10 w-10 place-items-center rounded-xl transition-colors ${
                isCurrent ? 'bg-accent-soft ring-1 ring-accent' : 'hover:bg-surface-2'
              }`
            : `flex h-[22px] items-center gap-1.5 rounded pr-7 font-explorer text-[13px] leading-[18px] transition-colors ${
                isIndented ? 'pl-[44px]' : 'pl-2.5'
              } ${
                isCurrent
                  ? 'bg-accent-soft font-medium text-accent-2'
                  : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
              }`
        }
      >
        <WorkspaceAvatar id={workspace.id} name={workspace.name} size={isCollapsed ? 'md' : 'xs'} />
        {!isCollapsed && (
          <>
            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
            {isRunning && <RunningMark />}
          </>
        )}
        {isCollapsed && isRunning && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-surface text-accent shadow-sm">
            <Spinner size={10} label="The agent is working here" />
          </span>
        )}
      </Link>
      {!isCollapsed && moveItems.length > 0 && (
        <RowActions label={`Move ${workspace.name}`} items={moveItems} />
      )}
    </li>
  );
}

/** The spinner on a workspace (or its folder) where the agent is working. */
function RunningMark({ className = '' }: { className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center text-accent ${className}`}>
      <Spinner size={11} label="The agent is working here" />
    </span>
  );
}
