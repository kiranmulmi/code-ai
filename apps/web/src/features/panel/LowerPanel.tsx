import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Memory, Skill } from '@app/shared';
import { IconButton } from '../../components/IconButton';
import {
  BrainIcon,
  ChevronDownIcon,
  ServerIcon,
  SkillIcon,
  TerminalIcon,
  WrenchIcon,
} from '../../lib/icons';
import type { AsyncResource } from '../../lib/useAsync';
import { useStoredState } from '../../lib/useStoredState';
import { AgentsPanel } from '../agents/AgentsPanel';
import { useAgents } from '../agents/useAgents';
import { McpPanel } from '../mcp/McpPanel';
import { PluginsPanel } from '../plugins/PluginsPanel';
import { usePlugins } from '../plugins/usePlugins';
import { SkillsPanel } from '../skills/SkillsPanel';
import { MemoryPanel } from './memory/MemoryPanel';
import {
  LOWER_PANEL_TABS,
  PANEL_TAB_LABEL,
  parseLowerPanelTab,
  type LowerPanelTab,
} from './panelTabs';
import { PanelTabButton } from './PanelTabButton';

const ICON: Record<LowerPanelTab, ReactNode> = {
  memory: <BrainIcon size={13} />,
  mcp: <ServerIcon size={13} />,
  skills: <SkillIcon size={13} />,
  agents: <WrenchIcon size={13} />,
  tools: <TerminalIcon size={13} />,
};

const HEIGHT_DEFAULT = 300;
const HEIGHT_MIN = 140;
/** What stays for the files or terminal above it. */
const ROOM_ABOVE = 180;
const KEY_STEP = 24;

const parseHeight = (stored: string | null) => Number(stored) || HEIGHT_DEFAULT;
const parseFlag = (stored: string | null) => stored === 'true';

/**
 * The bottom of the side panel: Skills, Agents (specialist sub-agents), Tools (AI-written tool plugins), Memory and MCP servers in their own tabs, under the files or
 * the terminal. Drag its top edge to resize it (double-click resets), or fold it to its tabs.
 */
export function LowerPanel({
  workspaceId,
  memories,
  skills,
  isBusy,
}: {
  workspaceId: string;
  memories: AsyncResource<Memory[]>;
  skills: AsyncResource<Skill[]>;
  isBusy: boolean;
}) {
  const [tab, setTab] = useStoredState('agent.lowerPanelTab', parseLowerPanelTab);
  const [height, setHeight] = useStoredState('agent.lowerPanelHeight', parseHeight);
  const [isFolded, setIsFolded] = useStoredState('agent.lowerPanelFolded', parseFlag);
  const [isDragging, setIsDragging] = useState(false);
  // Loaded here so switching tabs keeps the list; reloaded when the tab is picked.
  const agents = useAgents(workspaceId);
  const plugins = usePlugins(workspaceId);
  const section = useRef<HTMLElement>(null);
  // The agent can save tool plugins from the chat: show them once its run ends.
  const wasBusy = useRef(isBusy);
  const { reload: reloadPlugins } = plugins;
  useEffect(() => {
    if (wasBusy.current && !isBusy) reloadPlugins();
    wasBusy.current = isBusy;
  }, [isBusy, reloadPlugins]);

  useEffect(() => {
    if (!isDragging) return;
    document.body.classList.add('is-resizing-rows');
    return () => document.body.classList.remove('is-resizing-rows');
  }, [isDragging]);

  /** Keeps it between its minimum and what leaves room for the section above. */
  const resize = (px: number) => {
    const panel = section.current?.parentElement?.getBoundingClientRect();
    const max = panel ? Math.max(HEIGHT_MIN, panel.height - ROOM_ABOVE) : px;
    setHeight(Math.round(Math.min(max, Math.max(HEIGHT_MIN, px))));
  };

  const select = (next: LowerPanelTab) => {
    setTab(next);
    if (isFolded) setIsFolded(false);
    if (next === 'memory') memories.reload();
    if (next === 'skills') skills.reload();
    if (next === 'agents') agents.reload();
    if (next === 'tools') plugins.reload();
  };

  return (
    <section
      ref={section}
      aria-label="Skills, Agents, Memory and MCP servers"
      style={isFolded ? undefined : { height }}
      className="relative flex min-h-0 shrink-0 flex-col border-t border-line lg:min-w-[var(--panel-w)]"
    >
      {!isFolded && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the Skills, Agents, Memory and MCP section"
          aria-valuenow={height}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setIsDragging(true);
          }}
          onPointerMove={(event) => {
            const bottom = section.current?.getBoundingClientRect().bottom;
            if (isDragging && bottom !== undefined) resize(bottom - event.clientY);
          }}
          onPointerUp={() => setIsDragging(false)}
          onPointerCancel={() => setIsDragging(false)}
          onDoubleClick={() => setHeight(HEIGHT_DEFAULT)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') resize(height + KEY_STEP);
            else if (event.key === 'ArrowDown') resize(height - KEY_STEP);
            else return;
            event.preventDefault();
          }}
          className="group absolute -top-1 left-0 right-0 z-[5] h-2 cursor-row-resize touch-none outline-none"
        >
          <span
            className={`absolute left-0 right-0 top-[3px] h-0.5 transition-colors group-hover:bg-accent group-focus-visible:bg-accent ${
              isDragging ? 'bg-accent' : ''
            }`}
          />
        </div>
      )}

      <div className="flex h-10 shrink-0 items-stretch gap-1 border-b border-line-2 bg-subtle pl-2 pr-1.5">
        <div
          role="tablist"
          aria-label="Skills, Agents, Memory and MCP"
          className="panel-tabs flex min-w-0 flex-1 items-stretch"
        >
          {LOWER_PANEL_TABS.map((id) => (
            <PanelTabButton
              key={id}
              id={id}
              controls="lower-panel-body"
              isSmall
              isActive={!isFolded && tab === id}
              onSelect={() => select(id)}
            >
              {ICON[id]}
              {PANEL_TAB_LABEL[id]}
            </PanelTabButton>
          ))}
        </div>
        <IconButton
          onClick={() => setIsFolded(!isFolded)}
          aria-expanded={!isFolded}
          aria-controls="lower-panel-body"
          title={
            isFolded ? 'Show Skills, Agents, Memory and MCP' : 'Fold Skills, Agents, Memory and MCP'
          }
          aria-label={
            isFolded ? 'Show Skills, Agents, Memory and MCP' : 'Fold Skills, Agents, Memory and MCP'
          }
          className="h-7 w-7 self-center"
        >
          <ChevronDownIcon
            size={11}
            className={`transition-transform ${isFolded ? 'rotate-180' : ''}`}
          />
        </IconButton>
      </div>

      {!isFolded && (
        <div
          id="lower-panel-body"
          role="tabpanel"
          aria-labelledby={`panel-tab-${tab}`}
          key={tab}
          className="min-h-0 flex-1 animate-fade-in overflow-y-auto p-4"
        >
          {tab === 'memory' && <MemoryPanel workspaceId={workspaceId} memories={memories} />}
          {tab === 'mcp' && <McpPanel workspaceId={workspaceId} isBusy={isBusy} />}
          {tab === 'skills' && <SkillsPanel workspaceId={workspaceId} skills={skills} />}
          {tab === 'agents' && <AgentsPanel workspaceId={workspaceId} agents={agents} />}
          {tab === 'tools' && (
            <PluginsPanel workspaceId={workspaceId} plugins={plugins} isBusy={isBusy} />
          )}
        </div>
      )}
    </section>
  );
}
