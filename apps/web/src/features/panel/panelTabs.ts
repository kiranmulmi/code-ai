/** The side panel's top tabs: the workspace's files and the background tasks the agent left running. */
export const PANEL_TABS = ['files', 'tasks'] as const;

export type PanelTab = (typeof PANEL_TABS)[number];

/**
 * The tabs of the middle section: the chat itself, the workspace's terminal, what changed in
 * git, Customize (instructions, skills, agents, tools, MCP servers, memory), and the user's
 * own notes.
 */
export const CENTER_TABS = ['chat', 'terminal', 'git', 'customize', 'notes'] as const;

export type CenterTab = (typeof CENTER_TABS)[number];

/** The optional tabs a workspace turns on (`hasTerminalTab`, `hasGitTab`); on for new workspaces. */
export interface OptionalPanelTabs {
  terminal: boolean;
  git: boolean;
}

/**
 * The middle tabs this workspace shows: Chat, Customize and Notes always, Terminal and Git
 * diff when on.
 */
export function visibleCenterTabs(optional: OptionalPanelTabs): readonly CenterTab[] {
  return CENTER_TABS.filter((tab) =>
    tab === 'terminal' ? optional.terminal : tab === 'git' ? optional.git : true,
  );
}

export const PANEL_TAB_LABEL: Record<PanelTab | CenterTab, string> = {
  chat: 'Chat',
  files: 'Files',
  terminal: 'Terminal',
  git: 'Git diff',
  tasks: 'Tasks',
  customize: 'Customize',
  notes: 'Notes',
};

export function parsePanelTab(stored: string | null): PanelTab {
  return PANEL_TABS.find((tab) => tab === stored) ?? 'files';
}

export function parseCenterTab(stored: string | null): CenterTab {
  // The Instructions tab became a page of Customize.
  if (stored === 'instructions') return 'customize';
  return CENTER_TABS.find((tab) => tab === stored) ?? 'chat';
}
