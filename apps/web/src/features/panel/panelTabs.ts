/** The side panel's top tabs: the workspace's files and the background tasks the agent left running. */
export const PANEL_TABS = ['files', 'tasks'] as const;

export type PanelTab = (typeof PANEL_TABS)[number];

/**
 * The tabs of the middle section: the chat itself, the workspace's terminal, what changed in
 * git, the workspace's instructions for the agent, and the user's own notes.
 */
export const CENTER_TABS = ['chat', 'terminal', 'git', 'instructions', 'notes'] as const;

export type CenterTab = (typeof CENTER_TABS)[number];

/** The optional tabs a workspace turns on (`hasTerminalTab`, `hasGitTab`); on for new workspaces. */
export interface OptionalPanelTabs {
  terminal: boolean;
  git: boolean;
}

/**
 * The middle tabs this workspace shows: Chat, Instructions and Notes always, Terminal and Git
 * diff when on.
 */
export function visibleCenterTabs(optional: OptionalPanelTabs): readonly CenterTab[] {
  return CENTER_TABS.filter((tab) =>
    tab === 'terminal' ? optional.terminal : tab === 'git' ? optional.git : true,
  );
}

/**
 * The tabs of the section below them: the skills, the specialist sub-agents, the tool plugins
 * the AI writes, what the agent remembers, the MCP servers.
 */
export const LOWER_PANEL_TABS = ['skills', 'agents', 'tools', 'memory', 'mcp'] as const;

export type LowerPanelTab = (typeof LOWER_PANEL_TABS)[number];

export const PANEL_TAB_LABEL: Record<PanelTab | CenterTab | LowerPanelTab, string> = {
  chat: 'Chat',
  files: 'Files',
  terminal: 'Terminal',
  git: 'Git diff',
  tasks: 'Tasks',
  instructions: 'Instructions',
  notes: 'Notes',
  memory: 'Memory',
  mcp: 'MCP',
  skills: 'Skills',
  agents: 'Agents',
  tools: 'Tools',
};

export function parsePanelTab(stored: string | null): PanelTab {
  return PANEL_TABS.find((tab) => tab === stored) ?? 'files';
}

export function parseCenterTab(stored: string | null): CenterTab {
  return CENTER_TABS.find((tab) => tab === stored) ?? 'chat';
}

export function parseLowerPanelTab(stored: string | null): LowerPanelTab {
  return LOWER_PANEL_TABS.find((tab) => tab === stored) ?? 'skills';
}
