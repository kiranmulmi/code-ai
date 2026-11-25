import { withoutSpokenTags, type PlanStep, type StepStatus } from '@app/shared';
import { Markdown } from '../../components/Markdown';
import { BulbIcon, CheckIcon, CrossIcon, DashIcon, FlagIcon } from '../../lib/icons';
import { STATUS_LABEL } from '../panel/plan/planState';
import type { NoteItem, TextItem, ThoughtItem } from './conversation';
import { thoughtDuration } from './ThoughtLine';
import { DotNode, TimelineEntry } from './Timeline';
import { useSmoothText } from './useSmoothText';

/** Text the agent wrote on its way to a tool call: its running commentary. */
export function NarrationEntry({ item }: { item: TextItem }) {
  const smooth = useSmoothText(withoutSpokenTags(item.text), item.isOpen);
  if (!item.text.trim()) return null;
  return (
    <TimelineEntry node={<DotNode tone={item.isOpen ? 'accent' : 'muted'} />} className="py-1">
      <div className="narration pr-3 pt-[2px] text-[13px] leading-[1.55] text-ink-2 [overflow-wrap:anywhere]">
        <Markdown text={smooth.text} isStreaming={item.isOpen || smooth.isCatchingUp} />
      </div>
    </TimelineEntry>
  );
}

/** "Thought for 4s": the planning step at the start of a run. */
export function ThoughtEntry({ item }: { item: ThoughtItem }) {
  if (item.durationMs === null) return null;
  return (
    <TimelineEntry
      className="py-1"
      node={
        <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-accent-soft text-accent-2">
          <BulbIcon size={12} />
        </span>
      }
    >
      <p className="pt-[3px] text-[12.5px] text-ink-3">
        Thought for{' '}
        <span className="font-medium text-ink-2">{thoughtDuration(item.durationMs)}</span>
      </p>
    </TimelineEntry>
  );
}

/** A note about the run (a plan check, steps added, a limit reached). */
export function NoteEntry({ item }: { item: NoteItem }) {
  const isWarn = item.tone === 'warn';
  return (
    <TimelineEntry node={<DotNode tone={isWarn ? 'warn' : 'accent'} />} className="py-1">
      <p
        className={`inline-flex rounded-md px-2 py-0.5 text-[12px] ${
          isWarn ? 'bg-warn-bg text-warn' : 'bg-accent-soft text-accent-2'
        }`}
      >
        {item.text}
      </p>
    </TimelineEntry>
  );
}

/** Where the agent made its plan: the goal, flagged. */
export function PlanGoalEntry({ goal }: { goal: string }) {
  return (
    <TimelineEntry
      className="py-1.5"
      node={
        <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-accent text-on-accent shadow-accent">
          <FlagIcon size={11} />
        </span>
      }
    >
      <div className="flex flex-col pt-[1px]">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-accent-2">
          Plan
        </span>
        <p className="text-[13px] font-semibold leading-snug text-ink">{goal}</p>
      </div>
    </TimelineEntry>
  );
}

const STEP_NODE: Record<StepStatus, string> = {
  pending: 'border-line-strong bg-surface text-ink-3',
  in_progress: 'border-accent bg-accent-soft text-accent-2',
  done: 'border-success-line bg-success-bg text-success',
  failed: 'border-danger-line bg-danger-bg text-danger',
  skipped: 'border-line bg-surface-2 text-ink-4',
};

function StepGlyph({ status, number }: { status: StepStatus; number: number }) {
  if (status === 'done') return <CheckIcon size={11} />;
  if (status === 'failed') return <CrossIcon size={11} />;
  if (status === 'skipped') return <DashIcon size={11} />;
  return <>{number}</>;
}

/** A plan step heading the work done for it. */
export function StepEntry({ step, number }: { step: PlanStep | null; number: number }) {
  const status: StepStatus = step?.status ?? 'in_progress';
  const isActive = status === 'in_progress';
  return (
    <TimelineEntry
      className="pb-1 pt-2.5 first:pt-1"
      node={
        <span
          aria-label={STATUS_LABEL[status]}
          className={`relative grid h-[22px] w-[22px] place-items-center rounded-full border-[1.5px] text-[10.5px] font-bold tabular-nums ${STEP_NODE[status]}`}
        >
          {isActive && (
            <span
              aria-hidden
              className="absolute inset-[-4px] animate-ping rounded-full border border-accent opacity-40 motion-reduce:hidden"
            />
          )}
          <StepGlyph status={status} number={number} />
        </span>
      }
    >
      <div className="flex flex-col gap-0.5 pt-[1px]">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
            Step {number}
          </span>
          {status !== 'done' && (
            <span
              className={`text-[10.5px] font-semibold ${
                isActive ? 'text-accent-2' : status === 'failed' ? 'text-danger' : 'text-ink-3'
              }`}
            >
              {STATUS_LABEL[status]}
            </span>
          )}
        </div>
        <p
          className={`text-[13.5px] font-semibold leading-snug [overflow-wrap:anywhere] ${
            status === 'skipped' ? 'italic text-ink-3 line-through' : 'text-ink'
          }`}
        >
          {step?.text ?? `Step ${number}`}
        </p>
        {step?.note && !isActive && (
          <p
            className={`text-[12px] leading-snug [overflow-wrap:anywhere] ${
              status === 'failed' ? 'text-danger' : 'text-ink-3'
            }`}
          >
            {step.note}
          </p>
        )}
      </div>
    </TimelineEntry>
  );
}
