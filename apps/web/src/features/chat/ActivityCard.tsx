import { useState, type ReactNode } from 'react';
import { ElapsedTime } from '../../components/ElapsedTime';
import { plural } from '../../lib/format';
import { CheckIcon, ChevronDownIcon, WarnIcon } from '../../lib/icons';
import type { ActivityStats } from './activityGroups';
import { thoughtDuration } from './ThoughtLine';
import { Timeline } from './Timeline';
import { toolIcon } from './toolIcon';
import { FAMILY_COLOR, toolMeta } from './toolMeta';

/** At most this many distinct tool icons stack in the header. */
const MAX_ICONS = 5;

/** The distinct tools a card used, newest last, for the stacked icons in its header. */
function distinctTools(stats: ActivityStats): { name: string; args: string }[] {
  const seen = new Map<string, { name: string; args: string }>();
  for (const tool of stats.tools) {
    seen.delete(tool.name);
    seen.set(tool.name, { name: tool.name, args: tool.args });
  }
  return [...seen.values()].slice(-MAX_ICONS);
}

/** "Worked through 3 steps · 12 tool calls", "Thought for 4s", "Used 1 tool". */
function summaryText(stats: ActivityStats): string {
  const parts: string[] = [];
  if (stats.steps) parts.push(plural(stats.steps, 'step'));
  if (stats.tools.length) parts.push(plural(stats.tools.length, 'tool call'));
  if (!parts.length) {
    return stats.thoughtMs !== null ? `Thought for ${thoughtDuration(stats.thoughtMs)}` : 'Worked';
  }
  return `Worked · ${parts.join(' · ')}`;
}

/** The live orb: a ring sweeping round a soft accent core. */
function LiveOrb() {
  return (
    <span className="relative grid h-7 w-7 shrink-0 place-items-center">
      <span className="absolute inset-0 animate-spin-fast rounded-full bg-[conic-gradient(from_0deg,transparent_0%,var(--accent)_70%,transparent_100%)] [mask:radial-gradient(farthest-side,transparent_calc(100%-2px),black_calc(100%-2px))] motion-reduce:animate-none" />
      <span className="thinking-glow h-2.5 w-2.5 rounded-full bg-accent" />
    </span>
  );
}

/**
 * The agent's work on the way to an answer, as a slim bar rather than a card: one line saying
 * what it's doing now (live) or what it did (finished), with the tools it used, that opens into
 * the timeline of its steps, notes and tool calls. Open while it runs; folds once it's done,
 * so the answer stands out.
 */
export function ActivityCard({
  stats,
  status,
  startedAt,
  isLive,
  children,
  hasEntries,
}: {
  stats: ActivityStats;
  /** What the agent is doing right now ("Thinking…"), when this card is the live one. */
  status: string | null;
  startedAt: number | null;
  isLive: boolean;
  hasEntries: boolean;
  children: ReactNode;
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const isOpen = hasEntries && (userOpen ?? isLive);
  const icons = distinctTools(stats);
  const hasFailures = stats.failed > 0;

  const hint = isLive
    ? stats.tools.length
      ? `${plural(stats.tools.length, 'tool call')} so far`
      : ''
    : hasFailures
      ? `${stats.failed} failed`
      : '';

  return (
    <section className={`relative ${isLive ? 'work-live' : ''}`}>
      <button
        type="button"
        onClick={() => hasEntries && setUserOpen(!isOpen)}
        aria-expanded={hasEntries ? isOpen : undefined}
        disabled={!hasEntries}
        className={`group relative flex h-9 w-full items-center gap-2.5 overflow-hidden rounded-full pl-1 pr-3 text-left transition-colors enabled:cursor-pointer ${
          isOpen ? 'bg-subtle' : 'enabled:hover:bg-subtle'
        }`}
      >
        {isLive ? (
          <LiveOrb />
        ) : (
          <span
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
              hasFailures ? 'bg-warn-bg text-warn' : 'bg-success-bg text-success'
            }`}
          >
            {hasFailures ? <WarnIcon size={12} /> : <CheckIcon size={12} />}
          </span>
        )}
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          {isLive ? (
            <span
              role="status"
              className="flex min-w-0 items-baseline gap-2 text-[12.5px] font-semibold"
            >
              <span className="activity-shimmer truncate">{status ?? 'Working…'}</span>
              {startedAt !== null && (
                <ElapsedTime
                  startedAt={startedAt}
                  className="shrink-0 text-[11px] font-medium text-ink-3"
                />
              )}
            </span>
          ) : (
            <span className="truncate text-[12.5px] font-medium text-ink-2 group-hover:text-ink">
              {summaryText(stats)}
            </span>
          )}
          {hint && (
            <span
              className={`shrink-0 text-[11px] ${hasFailures && !isLive ? 'font-medium text-warn' : 'text-ink-4'}`}
            >
              {hint}
            </span>
          )}
        </span>
        {icons.length > 0 && (
          <span aria-hidden className="hidden shrink-0 items-center gap-0.5 sm:flex">
            {icons.map(({ name, args }) => {
              const Icon = toolIcon(name);
              const color = FAMILY_COLOR[toolMeta(name, args).family];
              return (
                <span
                  key={name}
                  className="grid h-5 w-5 place-items-center rounded-md"
                  style={{ color }}
                >
                  <Icon size={11} />
                </span>
              );
            })}
          </span>
        )}
        {hasEntries && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-ink-4 group-hover:text-ink-3">
            <span className="hidden sm:inline">{isOpen ? 'Hide' : 'Details'}</span>
            <ChevronDownIcon
              size={11}
              className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            />
          </span>
        )}
        {isLive && <span aria-hidden className="activity-progress" />}
      </button>
      {/* Grid rows animate the fold without measuring heights. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pb-1 pl-1 pt-3">
            <Timeline>{children}</Timeline>
          </div>
        </div>
      </div>
    </section>
  );
}
