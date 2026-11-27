import type { ReactNode } from 'react';
import { IconButton } from '../../components/IconButton';
import {
  ConversationIcon,
  GitDiffIcon,
  InstructionsIcon,
  NoteIcon,
  PanelIcon,
  TerminalIcon,
} from '../../lib/icons';
import { PANEL_TAB_LABEL, type CenterTab } from '../panel/panelTabs';
import { TabCount } from '../panel/SidePanel';

const TAB_ICON: Record<CenterTab, ReactNode> = {
  chat: <ConversationIcon size={15} />,
  terminal: <TerminalIcon size={15} />,
  git: <GitDiffIcon size={15} />,
  instructions: <InstructionsIcon size={15} />,
  notes: <NoteIcon size={15} />,
};

/**
 * The middle section's toolbar: a tab strip with Chat (its title as the tooltip) first, then the workspace's terminal, git diff, instructions and notes. While a side is hidden, a
 * button brings it back: the chats sidebar (wide screens) in front of the tabs, the panel at the end.
 */
export function ChatHeader({
  title,
  tabs,
  tab,
  onTab,
  gitChanges,
  isPanelShown,
  onTogglePanel,
  onShowSidebar,
}: {
  title: string;
  /** the tabs this workspace shows (`visibleCenterTabs`) */
  tabs: readonly CenterTab[];
  tab: CenterTab;
  onTab: (tab: CenterTab) => void;
  /** files changed since the last commit, for the Git diff tab's count */
  gitChanges: { count: number; isTruncated: boolean } | null;
  isPanelShown: boolean;
  onTogglePanel: () => void;
  /** Set while the sidebar is collapsed (wide screens only). */
  onShowSidebar?: () => void;
}) {
  return (
    <header
      // At xl the workspace sidebar is always to the left, so this bar is never the top-left corner.
      className="titlebar flex h-12 shrink-0 items-stretch justify-between gap-3 border-b border-line pl-2 pr-4 sm:pr-6"
    >
      <div className="flex min-w-0 flex-1 items-stretch gap-1">
        {onShowSidebar && (
          <IconButton
            onClick={onShowSidebar}
            aria-controls="chat-sidebar"
            aria-expanded={false}
            aria-label="Expand the sidebar"
            title="Expand the sidebar"
            className="hidden self-center xl:grid"
          >
            <PanelIcon size={15} className="-scale-x-100" />
          </IconButton>
        )}
        <div role="tablist" aria-label="Chat and tools" className="flex min-w-0 items-stretch">
          {tabs.map((id) => {
            const isActive = tab === id;
            const isChat = id === 'chat';
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`center-tab-${id}`}
                aria-selected={isActive}
                aria-controls="center-body"
                onClick={() => onTab(id)}
                title={isChat ? title : PANEL_TAB_LABEL[id]}
                className={`-mb-px flex items-center gap-2 border-b-2 px-3 transition-[color,border-color] duration-200 ${
                  isChat ? 'min-w-0' : 'shrink-0'
                } ${
                  isActive
                    ? 'border-accent text-ink'
                    : 'border-transparent text-ink-2 hover:border-line-strong hover:text-ink'
                }`}
              >
                <span
                  aria-hidden
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors ${
                    isActive ? 'bg-accent-soft text-accent-2' : 'text-ink-3'
                  }`}
                >
                  {TAB_ICON[id]}
                </span>
                <span className="hidden text-[13.5px] font-medium sm:inline">
                  {PANEL_TAB_LABEL[id]}
                </span>
                {id === 'git' && gitChanges && gitChanges.count > 0 && (
                  <TabCount
                    title={`${gitChanges.count}${gitChanges.isTruncated ? '+' : ''} ${
                      gitChanges.count === 1 ? 'file' : 'files'
                    } changed`}
                  >
                    {gitChanges.count}
                    {gitChanges.isTruncated ? '+' : ''}
                  </TabCount>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {/* While the panel is open its own header has the button that hides it. */}
        {!isPanelShown && (
          <IconButton
            onClick={onTogglePanel}
            aria-controls="side-panel"
            aria-expanded={false}
            title="Show files, tasks and memory"
            aria-label="Show files, tasks and memory"
          >
            <PanelIcon size={15} />
          </IconButton>
        )}
      </div>
    </header>
  );
}
