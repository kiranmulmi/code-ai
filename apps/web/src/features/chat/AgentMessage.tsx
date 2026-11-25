import { useEffect, useState, type ReactNode } from 'react';
import { ElapsedTime } from '../../components/ElapsedTime';
import { formatElapsed, plural } from '../../lib/format';
import { BoltIcon, CheckIcon, CopyIcon, FlagIcon, LogoIcon, PulseIcon } from '../../lib/icons';
import { useToast } from '../../lib/toast';
import { APP_NAME } from '../../lib/brand';
import { EarlierPlan } from '../panel/plan/EarlierPlan';
import { ActivityCard } from './ActivityCard';
import { activityGroups, activityStats } from './activityGroups';
import { tokensText, type AgentTurn } from './conversation';
import { flowSections, type Block, type Section } from './flowSections';
import type { PlacedPlan } from './planPlacement';
import { ApprovalCard } from './ApprovalCard';
import { MessageTime } from './MessageTime';
import { TextBlock } from './TextBlock';
import { TimelineEntry } from './Timeline';
import { NarrationEntry, NoteEntry, PlanGoalEntry, StepEntry, ThoughtEntry } from './TimelineItems';
import { ToolSteps } from './ToolStep';

/** Token counts that open the token breakdown: dotted underline, so they read as a link. */
export const TOKENS_BUTTON =
  'rounded-sm underline decoration-line-strong decoration-dotted underline-offset-[3px] transition-colors hover:text-accent-2 hover:decoration-current hover:decoration-solid';

/** The reply's answer text (not notes on the way to a tool call, nor errors), as Markdown. */
function answerText(turn: AgentTurn): string {
  return turn.flow
    .flatMap((item) =>
      item.kind === 'text' && !item.isInterim && !item.isError ? [item.text] : [],
    )
    .map((text) => text.trim())
    .filter(Boolean)
    .join('\n\n');
}

/** One fact in the reply's footer: a small icon, then its value. */
function Stat({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <span title={title} className="inline-flex items-center gap-1">
      <span aria-hidden className="text-ink-4">
        {icon}
      </span>
      {children}
    </span>
  );
}

const StepsIcon = PulseIcon;

/** A clock face, for how long the reply took. */
function ClockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** "Copy" as a labelled button, so the reply's main action reads at a glance. */
function CopyAnswer({ text }: { text: string }) {
  const toast = useToast();
  const [isCopied, setIsCopied] = useState(false);
  useEffect(() => {
    if (!isCopied) return;
    const timer = window.setTimeout(() => setIsCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [isCopied]);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => setIsCopied(true),
          () => toast("Couldn't copy to the clipboard.", 'error'),
        )
      }
      aria-label={isCopied ? 'Copied' : 'Copy response'}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 font-medium transition-colors ${
        isCopied ? 'text-success' : 'text-ink-3 hover:bg-surface-2 hover:text-ink'
      }`}
    >
      {isCopied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      {isCopied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Whether a card's sections hold anything to show on its timeline. */
function hasEntries(sections: readonly Section[]): boolean {
  return sections.some((section) => section.kind !== 'thought' || section.durationMs !== null);
}

/**
 * One agent turn, laid out as a thread: the avatar in a gutter on the left (it stays in view
 * while the reply scrolls), and on the right a header (name, live status or when it finished),
 * the work folded into slim bars, the answer as prose, and a footer with copy and usage.
 */
export function AgentMessage({
  turn,
  plans,
  onDecide,
  onShowUsage,
  revealUpTo = null,
  runStartedAt = null,
}: {
  turn: AgentTurn;
  /** the plan each create_plan call made (planPlacement) */
  plans: ReadonlyMap<string, PlacedPlan>;
  onDecide: (approvalId: string, allow: boolean) => void;
  /** Opens this reply's token usage breakdown. */
  onShowUsage?: () => void;
  /** Voice mode: show the answer only up to this many characters (null: all of it). */
  revealUpTo?: number | null;
  /** When the running request started (ms), for the live timer on its status line. */
  runStartedAt?: number | null;
}) {
  let unrevealed = revealUpTo ?? Infinity;
  const reveal = <T extends { text: string; isOpen: boolean }>(item: T): T => {
    const shown =
      item.text.length <= unrevealed
        ? item
        : { ...item, text: item.text.slice(0, unrevealed), isOpen: true };
    unrevealed = Math.max(0, unrevealed - item.text.length);
    return shown;
  };

  /** A block on an activity card's timeline. */
  const renderEntry = (block: Block): ReactNode => {
    switch (block.kind) {
      case 'tools':
        return <ToolSteps key={block.key} items={block.items} />;
      case 'plan': {
        const placed = plans.get(block.key);
        if (!placed) return null;
        if (placed.hasInlineSteps) return <PlanGoalEntry key={block.key} goal={placed.plan.goal} />;
        return (
          <TimelineEntry
            key={block.key}
            className="py-1"
            node={
              <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-accent text-on-accent">
                <FlagIcon size={11} />
              </span>
            }
          >
            <EarlierPlan plan={placed.plan} />
          </TimelineEntry>
        );
      }
      case 'text':
        if (block.isError) return null;
        return <NarrationEntry key={block.key} item={reveal(block)} />;
      case 'note':
        return <NoteEntry key={block.key} item={block} />;
      case 'thought':
        return <ThoughtEntry key={block.key} item={block} />;
      case 'approval':
        return null;
    }
  };

  const renderSection = (section: Section): ReactNode => {
    if (section.kind !== 'section') return renderEntry(section);
    const { step } = section;
    const plan = step.planKey ? plans.get(step.planKey)?.plan : undefined;
    return [
      <StepEntry
        key={section.key}
        step={plan?.steps[step.number - 1] ?? null}
        number={step.number}
      />,
      ...section.blocks.map(renderEntry),
    ];
  };

  /** What stands outside the cards: the answer, an error, an approval. */
  const renderStandalone = (section: Section): ReactNode => {
    switch (section.kind) {
      case 'text':
        return <TextBlock key={section.key} item={section.isError ? section : reveal(section)} />;
      case 'approval':
        return <ApprovalCard key={section.key} item={section} onDecide={onDecide} />;
      default:
        return null;
    }
  };

  const groups = activityGroups(flowSections(turn.flow));
  // Text streaming clears the status (the text shows progress), so the run's start time says
  // whether this turn is still working.
  const isRunning = turn.status !== null || runStartedAt !== null;
  const lastGroup = groups.at(-1);
  // While the agent works with no card at the end (before its first step, or after an answer
  // while it checks it), a fresh card carries the live status. Not while an answer streams.
  const needsLiveCard = turn.status !== null && lastGroup?.kind !== 'activity';
  let cardIndex = 0;
  const rendered = groups.map((group, index) => {
    if (group.kind === 'standalone') return renderStandalone(group.section);
    const isLast = index === groups.length - 1;
    const isLive = isRunning && isLast;
    return (
      <ActivityCard
        // Keyed by position, so the live card that waits for work stays the same card.
        key={`activity:${cardIndex++}`}
        stats={activityStats(group.sections)}
        status={isLive ? (turn.status ?? 'Working…') : null}
        startedAt={isLive ? runStartedAt : null}
        isLive={isLive}
        hasEntries={hasEntries(group.sections)}
      >
        {group.sections.map(renderSection)}
      </ActivityCard>
    );
  });
  const answer = answerText(turn);
  const isFinished = !isRunning && revealUpTo === null && Boolean(answer || turn.meta);

  const steps = turn.usage?.steps ?? null;

  return (
    <article
      className="group/reply grid animate-rise grid-cols-[28px_minmax(0,1fr)] gap-x-3"
      aria-label={`${APP_NAME} reply`}
    >
      {/* The gutter: the avatar stays in view while a long reply scrolls past. */}
      <div className="row-span-2">
        <span
          className={`sticky top-3 grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-on-accent ring-4 ring-[color-mix(in_srgb,var(--accent)_12%,transparent)] ${
            isRunning ? 'thinking-glow' : ''
          }`}
        >
          <LogoIcon size={13} />
        </span>
      </div>
      <header className="flex h-7 min-w-0 items-center gap-2 text-[12px]">
        <span className="font-semibold text-ink">{APP_NAME}</span>
        {isRunning ? (
          <span className="inline-flex items-center gap-1.5 text-accent-2">
            <span aria-hidden className="live-dot scale-[0.6]" />
            <span className="font-medium">Working</span>
            {runStartedAt !== null && (
              <ElapsedTime startedAt={runStartedAt} className="text-ink-3" />
            )}
          </span>
        ) : (
          turn.finishedAt && (
            <span className="text-ink-4">
              <MessageTime iso={turn.finishedAt} />
            </span>
          )
        )}
      </header>
      <div className="col-start-2 flex min-w-0 flex-col gap-3 pt-1">
        {rendered}
        {needsLiveCard && (
          <ActivityCard
            key={`activity:${cardIndex}`}
            stats={activityStats([])}
            status={turn.status}
            startedAt={runStartedAt}
            isLive
            hasEntries={false}
          >
            {null}
          </ActivityCard>
        )}
        {turn.liveMeta && !turn.meta && (
          <p
            className="text-[11px] tabular-nums text-ink-4"
            title="This reply's model calls and tokens so far"
          >
            {turn.liveMeta}
          </p>
        )}
        {isFinished && (
          <footer className="-ml-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-[11.5px] text-ink-3">
            {answer && <CopyAnswer text={answer} />}
            {turn.meta && (
              <span className="inline-flex h-7 items-center gap-2 px-1.5 tabular-nums opacity-80 transition-opacity group-hover/reply:opacity-100">
                {turn.usage && onShowUsage ? (
                  <>
                    {steps !== null && (
                      <Stat icon={<StepsIcon size={11} />} title="Model calls this reply made">
                        {plural(steps, 'step')}
                      </Stat>
                    )}
                    <Stat icon={<BoltIcon size={11} />} title="Token breakdown">
                      <button
                        type="button"
                        onClick={onShowUsage}
                        title="Token breakdown: each request this reply sent to the model, and its tokens"
                        className={TOKENS_BUTTON}
                      >
                        {tokensText(turn.usage.usage)}
                      </button>
                    </Stat>
                    {turn.durationMs !== null && (
                      <Stat
                        icon={<ClockIcon size={11} />}
                        title="Time taken, from sending the message to the final answer"
                      >
                        {formatElapsed(turn.durationMs / 1000)}
                      </Stat>
                    )}
                  </>
                ) : (
                  turn.meta
                )}
              </span>
            )}
          </footer>
        )}
      </div>
    </article>
  );
}
