import { useState, type ReactNode } from 'react';
import type { AppInfo, ChatSummary, Workspace } from '@app/shared';
import { IconButton } from '../../components/IconButton';
import { Brand } from '../../layout/Brand';
import { Link, useLocation } from 'react-router-dom';
import {
  BrainIcon,
  ChevronRightIcon,
  ComposeIcon,
  CrossIcon,
  GearIcon,
  PanelIcon,
  SearchIcon,
} from '../../lib/icons';
import { WorkspaceSwitcher } from '../workspaces/WorkspaceSwitcher';
import { ChatList } from './ChatList';
import { AccountMenu } from '../auth/AccountMenu';
import { SidebarLinks } from './SidebarLinks';
import { SidebarResizer } from './SidebarResizer';
import type { useSidebarWidth } from './useSidebarWidth';

/**
 * A workspace settings page link for desktop (xl), at the bottom of the chats sidebar: opens
 * the page, or closes it when it's open.
 */
function WorkspaceSettingsRow({
  workspace,
  page,
  label,
  icon,
}: {
  workspace: Workspace;
  /** the path under /workspaces/:id/ */
  page: 'settings' | 'agent-settings';
  label: string;
  icon: ReactNode;
}) {
  const to = `/workspaces/${workspace.id}/${page}`;
  const isOpen = useLocation().pathname.replace(/\/+$/, '') === to;

  return (
    <Link
      to={isOpen ? `/workspaces/${workspace.id}` : to}
      aria-label={isOpen ? `Close ${label.toLowerCase()}` : label}
      aria-current={isOpen ? 'page' : undefined}
      title={isOpen ? 'Back to the chat' : label}
      className={`flex h-9 items-center gap-2.5 rounded-xl px-3 text-[13px] font-medium transition-colors ${
        isOpen ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-subtle hover:text-ink'
      }`}
    >
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-2">
        {icon}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  );
}

/**
 * The brand, the open workspace's name, new chat, search and the workspace's chats, with the
 * settings links and the workspace switcher at the bottom: a column on wide screens
 * (collapsible, sliding away as its column shrinks), a drawer on small ones.
 */
export function ChatSidebar({
  isOpen,
  isCollapsed,
  onCollapse,
  onClose,
  width,
  workspaceId,
  workspace,
  workspaces,
  onOpenWorkspaces,
  info,
  infoError,
  chats,
  chatsError,
  activeChatId,
  runningChatIds,
  runningWorkspaceIds,
  onNewChat,
  onRenamed,
  onDeleted,
}: {
  isOpen: boolean;
  /** wide screens: hidden, its column at 0 (ChatScreen) */
  isCollapsed: boolean;
  onCollapse: () => void;
  onClose: () => void;
  width: ReturnType<typeof useSidebarWidth>;
  workspaceId: string;
  workspace: Workspace | null;
  workspaces: Workspace[];
  onOpenWorkspaces: () => void;
  info: AppInfo | null;
  infoError: unknown;
  chats: ChatSummary[] | null;
  chatsError: unknown;
  activeChatId: string | null;
  /** Chats with a run in progress in this tab. */
  runningChatIds: ReadonlySet<string>;
  /** Workspaces with a run in progress in this tab, marked in the switcher. */
  runningWorkspaceIds: ReadonlySet<string>;
  onNewChat: () => void;
  onRenamed: (chat: ChatSummary) => void;
  onDeleted: (chatId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const hasChats = chats !== null && chats.length > 0;

  return (
    <>
      {isOpen && (
        <div
          aria-hidden
          onClick={onClose}
          className="fixed inset-0 z-30 animate-fade-in bg-overlay xl:hidden"
        />
      )}
      <nav
        id="chat-sidebar"
        aria-label="Chats"
        className={`fixed inset-y-0 left-0 z-40 flex min-h-0 w-[min(300px,86vw)] flex-col border-r border-line bg-surface shadow-dialog transition-[transform,visibility,opacity] duration-300 xl:relative xl:z-10 xl:w-auto xl:translate-x-0 xl:overflow-hidden xl:border-line-2 xl:shadow-none xl:[&>*:not([role=separator])]:min-w-[var(--sidebar-w)] ${
          isOpen ? 'translate-x-0' : '-translate-x-full max-xl:invisible'
        } ${isCollapsed ? 'xl:invisible xl:opacity-0' : ''}`}
      >
        <SidebarResizer width={width.width} onResize={width.setWidth} onReset={width.reset} />
        <div className="titlebar flex h-12 shrink-0 items-center gap-1 border-b border-line pl-[calc(1rem+var(--titlebar-inset))] pr-2 xl:pl-4">
          {/* At xl the workspace sidebar to the left carries the brand and the top-left corner. */}
          <span className="xl:hidden">
            <Brand isHiddenInDesktopApp />
          </span>
          {/* At xl the open workspace's name takes the top bar, where "Chats" was. */}
          {workspace ? (
            <h2
              title={workspace.path}
              className="hidden min-w-0 flex-1 truncate text-[14.5px] font-extrabold tracking-tight text-ink xl:block"
            >
              {workspace.name}
            </h2>
          ) : (
            <span className="hidden text-[10.5px] font-semibold uppercase tracking-wider text-ink-3 xl:block">
              Chats
            </span>
          )}
          <IconButton onClick={onClose} aria-label="Hide chats" className="ml-auto xl:hidden">
            <ChevronRightIcon size={12} className="rotate-180" />
          </IconButton>
          <IconButton
            onClick={onCollapse}
            aria-label="Collapse the sidebar"
            title="Collapse the sidebar"
            className="ml-auto hidden xl:grid"
          >
            <PanelIcon size={15} className="-scale-x-100" />
          </IconButton>
        </div>

        <div className="flex shrink-0 flex-col gap-1.5 px-1.5 pt-3">
          {workspace && (
            // Where you are: plain text on the sidebar's background, no card.
            // At xl it sits in the top bar instead.
            <div
              title={workspace.path}
              className="mb-1 flex min-w-0 items-center px-2.5 py-0.5 xl:hidden"
            >
              <h2 className="truncate text-[14.5px] font-extrabold leading-tight tracking-tight text-ink">
                {workspace.name}
              </h2>
            </div>
          )}
          <button
            type="button"
            onClick={onNewChat}
            title="Start a new chat"
            className="flex h-7 w-full items-center gap-1.5 rounded-md bg-accent-soft px-2.5 text-[13px] font-semibold text-accent-2 transition-colors hover:bg-accent-bg"
          >
            <ComposeIcon size={13} />
            New chat
          </button>
        </div>

        {hasChats && (
          <div className="shrink-0 px-1.5 pt-1">
            <label className="group/search relative flex items-center">
              <span className="sr-only">Search chats</span>
              <SearchIcon
                size={14}
                className="pointer-events-none absolute left-2.5 text-ink-3 transition-colors group-focus-within/search:text-accent"
              />
              <input
                type="search"
                value={query}
                placeholder="Search chats"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setQuery('');
                }}
                className="h-7 w-full rounded-md border border-transparent bg-transparent pl-[30px] pr-7 text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink-3 hover:bg-subtle focus:border-line focus:bg-surface [&::-webkit-search-cancel-button]:hidden"
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

        <ChatList
          workspaceId={workspaceId}
          chats={chats}
          query={query}
          error={chatsError}
          activeChatId={activeChatId}
          runningChatIds={runningChatIds}
          onRenamed={onRenamed}
          onDeleted={onDeleted}
        />

        {/* The workspace's settings at the bottom of the chats sidebar on desktop (xl) */}
        <div className="hidden shrink-0 xl:block px-3 pb-2">
          <span className="block px-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-4">
            Settings
          </span>
          {workspace && (
            <>
              <WorkspaceSettingsRow
                workspace={workspace}
                page="settings"
                label="Workspace settings"
                icon={<GearIcon size={12} />}
              />
              <WorkspaceSettingsRow
                workspace={workspace}
                page="agent-settings"
                label="Agent settings"
                icon={<BrainIcon size={12} />}
              />
            </>
          )}
        </div>

        {/* The drawer has every link; at xl Workspace settings is now in the chats sidebar and the rest is in the workspace sidebar. */}
        <div className="shrink-0 xl:hidden">
          <SidebarLinks info={info} error={infoError} workspaceId={workspaceId} />
        </div>

        {/* At xl the workspace sidebar switches workspaces; the drawer keeps this button. */}
        <div className="shrink-0 xl:hidden">
          <WorkspaceSwitcher
            variant="sidebar"
            opensUp
            current={workspace}
            workspaces={workspaces}
            runningWorkspaceIds={runningWorkspaceIds}
            onOpen={onOpenWorkspaces}
          />
        </div>

        <div className="shrink-0 xl:hidden">
          <AccountMenu />
        </div>
      </nav>
    </>
  );
}
