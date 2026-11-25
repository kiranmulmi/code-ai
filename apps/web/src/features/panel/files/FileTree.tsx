import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CreatedEntry, FileEntryKind, FolderChildren, FolderEntry } from '@app/shared';
import { absolutePath, startPathDrag } from '../../../lib/dragPath';
import { errorMessage } from '../../../lib/api';
import { Spinner } from '../../../components/Spinner';
import {
  ChevronRightIcon,
  DotsIcon,
  EditIcon,
  FilePlusIcon,
  FileTintIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FolderTintIcon,
  TrashIcon,
} from '../../../lib/icons';
import { NameInput } from './NameInput';
import { RowMenu, type RowMenuItem } from '../../../components/RowMenu';
import { fileTint } from './fileTint';
import { REVEAL_LABEL } from './revealLabel';
import { compactRow, foldersToShow, soleFolder, withParents } from './folderTree';
import { useFolderTree } from './useFolderTree';

const INDENT_PX = 14;

/**
 * Rows git ignores look faded, as in VS Code; so do generated folders (node_modules, .git),
 * which are listed but only read when opened.
 */
const FADED_ROW = 'opacity-50';
const isFaded = (entry: FolderEntry) => entry.isIgnored === true || entry.isGenerated === true;

/** The ⋯ button at a row's right end: shown on hover, on focus, and while its menu is open. */
const MENU_BUTTON =
  'absolute right-1.5 top-[2px] grid h-[18px] w-[18px] place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface hover:text-ink';

/**
 * The workspace's files as a folder tree. Folders toggle; files open a preview. Any row can
 * be dragged onto the message box to insert its absolute path. Each row's ⋯ menu (or a
 * right-click) renames or deletes it, shows it in the system's file manager, and a folder's
 * adds a new file or folder inside.
 */
export function FileTree({
  workspaceId,
  root,
  top,
  opening,
  reveal,
  onOpen,
  onCreateIn,
  onRename,
  onDelete,
  onReveal,
  creating,
  onCreate,
  onCancelCreate,
}: {
  workspaceId: string;
  /** the workspace folder, so dragged rows carry absolute paths */
  root: string;
  /** the workspace folder's own entries; a new one (a refresh) reads the open folders again */
  top: FolderChildren;
  /** the file being loaded for preview, if any */
  opening: string | null;
  /** a path just created or renamed: its folders open so it can be seen */
  reveal: CreatedEntry | null;
  onOpen: (filePath: string) => void;
  onCreateIn: (folderPath: string, kind: FileEntryKind) => void;
  /** rejects when it couldn't be renamed (the name box stays open) */
  onRename: (path: string, newName: string) => Promise<void>;
  onDelete: (path: string, kind: FileEntryKind) => void;
  /** shows it selected in Finder / File Explorer */
  onReveal: (path: string) => void;
  /** a new file or folder being named: its box shows inside `parent` ('' for the top) */
  creating: { parent: string; kind: FileEntryKind } | null;
  /** rejects when it couldn't be created (the name box stays open) */
  onCreate: (name: string) => Promise<void>;
  onCancelCreate: () => void;
}) {
  const tree = useFolderTree(workspaceId, top);
  const { folders, open, expand, collapse, showMore, reload } = tree;
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenuFor(null), []);

  // A workspace whose top level is one folder (a lone "src") opens it straight away.
  const isFirstShow = useRef(true);
  useEffect(() => {
    if (!isFirstShow.current) return;
    isFirstShow.current = false;
    const only = soleFolder(folders['']);
    if (only) void expand([only.path]);
  }, [folders, expand]);

  // Open the folders down to a new or renamed file or folder, once per path.
  const revealed = useRef<CreatedEntry | null>(null);
  useEffect(() => {
    if (!reveal || revealed.current === reveal) return;
    revealed.current = reveal;
    void expand(foldersToShow(reveal.path, reveal.kind === 'folder'));
  }, [reveal, expand]);

  // The folder a new file or folder goes in opens, so its name box shows there.
  const createIn = creating?.parent ?? null;
  useEffect(() => {
    if (!createIn) return;
    const needed = withParents(createIn).filter((folder) => !open.has(folder));
    if (needed.length) void expand(needed);
  }, [createIn, open, expand]);

  const menuItems = (path: string, kind: FileEntryKind): RowMenuItem[] => [
    ...(kind === 'folder'
      ? [
          {
            label: 'New file',
            icon: <FilePlusIcon size={13} />,
            onSelect: () => onCreateIn(path, 'file'),
          },
          {
            label: 'New folder',
            icon: <FolderPlusIcon size={13} />,
            onSelect: () => onCreateIn(path, 'folder'),
          },
        ]
      : []),
    { label: REVEAL_LABEL, icon: <FolderIcon size={13} />, onSelect: () => onReveal(path) },
    { label: 'Rename', icon: <EditIcon size={13} />, onSelect: () => setRenaming(path) },
    {
      label: 'Delete',
      icon: <TrashIcon size={13} />,
      onSelect: () => onDelete(path, kind),
      isDanger: true,
    },
  ];

  /** The ⋯ button and, when open, the menu: shared by file and folder rows. */
  const rowMenu = (path: string, kind: FileEntryKind) => (
    <>
      <button
        type="button"
        onClick={() => setMenuFor(menuFor === path ? null : path)}
        aria-label={`More for ${path}`}
        aria-haspopup="menu"
        aria-expanded={menuFor === path}
        title={`${REVEAL_LABEL}, rename, delete…`}
        className={`${MENU_BUTTON} ${
          menuFor === path
            ? 'bg-surface text-ink'
            : 'opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100'
        }`}
      >
        <DotsIcon size={13} />
      </button>
      {menuFor === path && <RowMenu items={menuItems(path, kind)} onClose={closeMenu} />}
    </>
  );

  const rename = (path: string) => async (newName: string) => {
    await onRename(path, newName);
    setRenaming(null);
  };
  const lastPart = (path: string) => path.slice(path.lastIndexOf('/') + 1);

  /** The name box for a new file or folder, first in the folder it goes in. */
  const newEntry = (folderPath: string, depth: number) =>
    creating && creating.parent === folderPath ? (
      <li>
        <NameInput
          name=""
          label={`New ${creating.kind} name${folderPath ? ` in ${folderPath}` : ''}`}
          placeholder={creating.kind === 'file' ? 'name.ts' : 'folder-name'}
          isFile={creating.kind === 'file'}
          icon={
            creating.kind === 'file' ? (
              <FilePlusIcon size={14} className="shrink-0 text-accent-2" />
            ) : (
              <FolderPlusIcon size={14} className="shrink-0 text-ft-folder" />
            )
          }
          paddingLeft={10 + depth * INDENT_PX + 17}
          onSubmit={onCreate}
          onCancel={onCancelCreate}
        />
      </li>
    ) : null;

  /** A note row inside a folder: loading, an error, or "Show more". */
  const noteRow = (depth: number, children: ReactNode) => (
    <li
      style={{ paddingLeft: 10 + depth * INDENT_PX + 17 }}
      className="flex items-center gap-1.5 py-[2px] pr-2 text-[12.5px] leading-[18px] text-ink-3"
    >
      {children}
    </li>
  );

  const folderRow = (entry: FolderEntry, depth: number) => {
    const row = compactRow(entry, folders);
    const isOpen = open.has(row.path);
    const folderIcon = isOpen ? (
      <FolderOpenIcon size={14} className="shrink-0 text-ft-folder" />
    ) : (
      <FolderTintIcon size={14} className="shrink-0 text-ft-folder" />
    );
    return (
      <li key={entry.path}>
        {renaming === row.path ? (
          <NameInput
            name={lastPart(row.path)}
            label={`New name for ${row.path}`}
            isFile={false}
            icon={folderIcon}
            paddingLeft={10 + depth * INDENT_PX + 17}
            onSubmit={rename(row.path)}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          <div className="group/row relative">
            <button
              type="button"
              onClick={() => (isOpen ? collapse(row.path) : void expand(row.chain))}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenuFor(row.path);
              }}
              draggable
              onDragStart={(event) => startPathDrag(event, absolutePath(root, row.path))}
              aria-expanded={isOpen}
              title={entry.isGenerated ? `${row.path} (generated)` : row.path}
              style={{ paddingLeft: 10 + depth * INDENT_PX }}
              className={`flex w-full items-center gap-1.5 py-[2px] pr-7 text-left font-explorer text-[13px] leading-[18px] text-ink transition-colors hover:bg-surface-2 ${
                isFaded(entry) ? FADED_ROW : ''
              }`}
            >
              <ChevronRightIcon
                size={11}
                className={`shrink-0 text-ink-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
              />
              {folderIcon}
              <span className="min-w-0 truncate">{row.name}</span>
            </button>
            {rowMenu(row.path, 'folder')}
          </div>
        )}
        {isOpen && (
          <div className="relative">
            <span
              aria-hidden
              style={{ left: 15 + depth * INDENT_PX }}
              className="absolute bottom-1 top-0 w-px bg-line-2"
            />
            <ul>{renderFolder(row.path, depth + 1)}</ul>
          </div>
        )}
      </li>
    );
  };

  const fileRow = (file: FolderEntry, depth: number) => {
    const tint = fileTint(file.name);
    const fileIcon = <FileTintIcon size={14} className={`shrink-0 ${tint.icon}`} />;
    // Files line up with folder names: past the chevron's width.
    const paddingLeft = 10 + depth * INDENT_PX + 17;
    return (
      <li key={file.path}>
        {renaming === file.path ? (
          <NameInput
            name={file.name}
            label={`New name for ${file.path}`}
            isFile
            icon={fileIcon}
            paddingLeft={paddingLeft}
            onSubmit={rename(file.path)}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          <div className="group/row relative">
            <button
              type="button"
              onClick={() => onOpen(file.path)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenuFor(file.path);
              }}
              draggable
              onDragStart={(event) => startPathDrag(event, absolutePath(root, file.path))}
              disabled={opening !== null}
              title={file.path}
              style={{ paddingLeft }}
              className={`flex w-full items-center gap-1.5 py-[2px] pr-7 text-left font-explorer text-[13px] leading-[18px] transition-colors hover:bg-accent-soft hover:text-accent-2 disabled:cursor-wait ${
                tint.isMuted ? 'text-ink-3' : 'text-ink-2'
              } ${isFaded(file) ? FADED_ROW : ''}`}
            >
              {opening === file.path ? <Spinner size={13} /> : fileIcon}
              <span className="min-w-0 truncate">{file.name}</span>
            </button>
            {rowMenu(file.path, 'file')}
          </div>
        )}
      </li>
    );
  };

  /** A folder's rows: folders first, then files (the API sorts them), read so far. */
  const renderFolder = (folderPath: string, depth: number) => {
    const folder = folders[folderPath];
    const entries = folder?.entries ?? [];
    const remaining = folder ? folder.total - entries.length : 0;
    return (
      <>
        {newEntry(folderPath, depth)}
        {entries.map((entry) =>
          entry.kind === 'folder' ? folderRow(entry, depth) : fileRow(entry, depth),
        )}
        {(!folder || (folder.isLoading && entries.length === 0)) &&
          noteRow(
            depth,
            <>
              <Spinner size={11} /> Loading…
            </>,
          )}
        {folder?.error != null &&
          noteRow(
            depth,
            <>
              <span className="min-w-0 truncate text-danger" title={errorMessage(folder.error, '')}>
                {errorMessage(folder.error, "Couldn't read this folder.")}
              </span>
              <button
                type="button"
                onClick={() => reload(folderPath)}
                className="shrink-0 font-medium text-accent-2 hover:underline"
              >
                Try again
              </button>
            </>,
          )}
        {folder &&
          !folder.error &&
          !folder.isLoading &&
          folder.total === 0 &&
          folderPath !== '' &&
          noteRow(depth, <span className="italic">Empty</span>)}
        {remaining > 0 &&
          !folder?.error &&
          noteRow(
            depth,
            <button
              type="button"
              onClick={() => showMore(folderPath)}
              disabled={folder?.isLoading}
              className="flex items-center gap-1.5 font-medium text-accent-2 hover:underline disabled:cursor-wait disabled:opacity-70"
            >
              {folder?.isLoading && <Spinner size={11} />}
              Show {remaining.toLocaleString()} more
            </button>,
          )}
      </>
    );
  };

  return <ul className="flex flex-col">{renderFolder('', 0)}</ul>;
}
