import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { Memory, Skill, Workspace } from '@app/shared';
import type { AsyncResource } from '../../lib/useAsync';
import {
  BrainIcon,
  InstructionsIcon,
  ServerIcon,
  SkillIcon,
  TerminalIcon,
  WrenchIcon,
} from '../../lib/icons';
import { AgentsPanel } from '../agents/AgentsPanel';
import { useAgents } from '../agents/useAgents';
import { McpPanel } from '../mcp/McpPanel';
import { MemoryPanel } from '../panel/memory/MemoryPanel';
import { InstructionsPanel } from '../panel/instructions/InstructionsPanel';
import { PluginsPanel } from '../plugins/PluginsPanel';
import { usePlugins } from '../plugins/usePlugins';
import { SkillsPanel } from '../skills/SkillsPanel';
import { onWorkspaceSaved } from '../workspaces/workspaceEvents';
import { CUSTOMIZE_SECTIONS, type CustomizeSection } from './sections';

interface SectionInfo {
  label: string;
  /** what it does, under the label in the nav */
  hint: string;
  icon: ReactNode;
}

const SECTION: Record<CustomizeSection, SectionInfo> = {
  instructions: {
    label: 'Instructions',
    hint: 'How it behaves',
    icon: <InstructionsIcon size={15} />,
  },
  skills: { label: 'Skills', hint: 'Know-how it loads', icon: <SkillIcon size={15} /> },
  agents: { label: 'Agents', hint: 'Specialists it delegates to', icon: <WrenchIcon size={15} /> },
  tools: { label: 'Tools', hint: 'Plugins AI writes for you', icon: <TerminalIcon size={15} /> },
  mcp: { label: 'MCP servers', hint: 'Outside apps and data', icon: <ServerIcon size={15} /> },
  memory: { label: 'Memory', hint: 'What it remembers', icon: <BrainIcon size={15} /> },
};

/** The nav's groups, in order: what shapes the agent, what it can use, what it knows. */
const GROUPS: { label: string; sections: CustomizeSection[] }[] = [
  { label: 'Behavior', sections: ['instructions', 'skills', 'agents'] },
  { label: 'Capabilities', sections: ['tools', 'mcp'] },
  { label: 'Knowledge', sections: ['memory'] },
];

/**
 * The Customize tab beside the chat: everything that shapes the agent in this workspace, one
 * full-size page per section (Instructions, Skills, Agents, Tools, MCP servers, Memory) picked
 * from a grouped nav on the left (a scrolling row on narrow screens), each with its count.
 */
export function CustomizeView({
  workspaceId,
  workspace,
  section,
  onSection,
  memories,
  skills,
  isBusy,
  instructions,
}: {
  workspaceId: string;
  workspace: AsyncResource<Workspace>;
  section: CustomizeSection;
  onSection: (section: CustomizeSection) => void;
  memories: AsyncResource<Memory[]>;
  skills: AsyncResource<Skill[]>;
  /** the agent is working in this workspace */
  isBusy: boolean;
  /** the Instructions page's unsaved text, kept by the chat screen across tab switches */
  instructions: { draft: string | null; onDraftChange: (draft: string | null) => void };
}) {
  // Loaded here so the nav can show counts and switching sections keeps the lists.
  const agents = useAgents(workspaceId);
  const plugins = usePlugins(workspaceId);
  const { reload: reloadPlugins } = plugins;

  // The agent can save tool plugins from the chat: show them once its run ends.
  const wasBusy = useRef(isBusy);
  useEffect(() => {
    if (wasBusy.current && !isBusy) reloadPlugins();
    wasBusy.current = isBusy;
  }, [isBusy, reloadPlugins]);
  // The workspace form may turn MCP servers (plugins among them) on or off.
  useEffect(() => onWorkspaceSaved(reloadPlugins), [reloadPlugins]);

  const pluginNames = new Set(plugins.data?.plugins.map((plugin) => plugin.name) ?? []);
  const enabled = plugins.data?.mcp.enabled ?? [];
  const hasInstructions = Boolean(workspace.data?.instructions?.trim());
  const counts: Record<CustomizeSection, { value: number | null; title: string }> = {
    instructions: { value: null, title: hasInstructions ? 'Written' : 'Not written yet' },
    skills: { value: skills.data?.length ?? 0, title: 'skills' },
    agents: {
      value: agents.data?.specialists.filter((s) => !s.isBuiltIn).length ?? 0,
      title: 'of your own',
    },
    tools: { value: enabled.filter((name) => pluginNames.has(name)).length, title: 'on here' },
    mcp: { value: enabled.length, title: 'on here' },
    memory: { value: memories.data?.length ?? 0, title: 'saved' },
  };
  const hasProblems = (agents.data?.problems.length ?? 0) > 0;

  const select = (next: CustomizeSection) => {
    onSection(next);
    if (next === 'memory') memories.reload();
    if (next === 'skills') skills.reload();
    if (next === 'agents') agents.reload();
    if (next === 'tools') reloadPlugins();
  };

  /** Up/down (left/right in the row) move between sections, like other tab lists. */
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const index = CUSTOMIZE_SECTIONS.indexOf(section);
    const next =
      CUSTOMIZE_SECTIONS[(index + step + CUSTOMIZE_SECTIONS.length) % CUSTOMIZE_SECTIONS.length];
    if (!next) return;
    select(next);
    document.getElementById(`customize-tab-${next}`)?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav
        aria-label="Customize the agent"
        className="shrink-0 border-b border-line bg-subtle md:w-60 md:overflow-y-auto md:border-b-0 md:border-r"
      >
        <div className="hidden px-5 pb-1 pt-5 md:block">
          <div className="text-[15px] font-extrabold tracking-tight text-ink">Customize</div>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
            Shape how the agent works in {workspace.data?.name ?? 'this workspace'}.
          </p>
        </div>
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label="Sections"
          onKeyDown={moveFocus}
          className="flex gap-1 overflow-x-auto px-3 py-2 md:flex-col md:gap-4 md:overflow-visible md:py-4"
        >
          {GROUPS.map((group) => (
            <div key={group.label} className="flex shrink-0 gap-1 md:flex-col md:gap-0.5">
              <div className="eyebrow hidden px-2 pb-1 md:block">{group.label}</div>
              {group.sections.map((id) => {
                const info = SECTION[id];
                const isActive = section === id;
                const count = counts[id];
                return (
                  <button
                    key={id}
                    id={`customize-tab-${id}`}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls="customize-body"
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => select(id)}
                    className={`group flex shrink-0 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-colors md:py-2 ${
                      isActive
                        ? 'bg-surface text-ink shadow-card ring-1 ring-line'
                        : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors ${
                        isActive ? 'bg-accent-soft text-accent-2' : 'text-ink-3'
                      }`}
                    >
                      {info.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block whitespace-nowrap text-[13px] font-semibold">
                        {info.label}
                      </span>
                      <span className="hidden truncate text-[11.5px] text-ink-3 md:block">
                        {info.hint}
                      </span>
                    </span>
                    {id === 'agents' && hasProblems ? (
                      <span
                        title="Some agent files can't be used"
                        className="h-2 w-2 shrink-0 rounded-full bg-warn-line"
                      />
                    ) : id === 'instructions' ? (
                      <span
                        title={count.title}
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          hasInstructions ? 'bg-success-line' : 'bg-ink-4'
                        }`}
                      />
                    ) : (
                      count.value !== null &&
                      count.value > 0 && (
                        <span
                          title={`${count.value} ${count.title}`}
                          className={`grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                            isActive ? 'bg-accent-soft text-accent-2' : 'bg-surface-2 text-ink-2'
                          }`}
                        >
                          {count.value}
                        </span>
                      )
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </nav>

      <div
        id="customize-body"
        role="tabpanel"
        aria-labelledby={`customize-tab-${section}`}
        key={section}
        className="min-h-0 min-w-0 flex-1 animate-fade-in overflow-y-auto"
      >
        {section === 'instructions' && (
          <InstructionsPanel
            workspaceId={workspaceId}
            workspace={workspace.data}
            isLoading={workspace.isLoading}
            error={workspace.error}
            onRetry={workspace.reload}
            draft={instructions.draft}
            onDraftChange={instructions.onDraftChange}
          />
        )}
        {section === 'skills' && <SkillsPanel workspaceId={workspaceId} skills={skills} />}
        {section === 'agents' && <AgentsPanel workspaceId={workspaceId} agents={agents} />}
        {section === 'tools' && (
          <PluginsPanel
            workspaceId={workspaceId}
            plugins={plugins}
            isBusy={isBusy}
            onOpenMcp={() => select('mcp')}
          />
        )}
        {section === 'mcp' && (
          <McpPanel
            workspaceId={workspaceId}
            isBusy={isBusy}
            pluginNames={pluginNames}
            onChange={reloadPlugins}
            onOpenTools={() => select('tools')}
          />
        )}
        {section === 'memory' && <MemoryPanel workspaceId={workspaceId} memories={memories} />}
      </div>
    </div>
  );
}
