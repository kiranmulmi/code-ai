import { withoutSpokenTags, type PlanStep, type StepStatus } from '@app/shared';
import { Markdown } from '../../components/Markdown';
import { BulbIcon, CheckIcon, CrossIcon, DashIcon, FlagIcon } from '../../lib/icons';
import { STATUS_LABEL } from '../panel/plan/planState';
import type { NoteItem, TextItem, ThoughtItem } from './conversation';
import { thoughtDuration } from './ThoughtLine';
import { TimelineEntry } from './Timeline';
import { useSmoothText } from './useSmoothText';

/** Text the agent wrote on its way to a tool call: its running commentary, as plain prose. */
export function NarrationEntry({ item }: { item: TextItem }) {
  const smooth = useSmoothText(withoutSpokenTags(item.text), item.isOpen);
  if (!item.text.trim()) return null;
  return (
    <TimelineEntry>
      <div
        className={`narration px-1 text-[13px] leading-[1.6] [overflow-wrap:anywhere] ${
          item.isOpen ? 'text-ink' : 'text-ink-2'
        }`}
      >
        <Markdown text={smooth.text} isStreaming={item.isOpen || smooth.isCatchingUp} />
      </div>
    </TimelineEntry>
  );
}

/** "Thought for 4s": the planning step at the start of a run, as a small chip. */
export function ThoughtEntry({ item }: { item: ThoughtItem }) {
  if (item.durationMs === null) return null;
  return (
    <TimelineEntry>
      <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 text-[11.5px] text-ink-3">
        <BulbIcon size={11} className="text-accent-2" />
        Thought for
        <span className="font-semibold text-ink-2">{thoughtDuration(item.durationMs)}</span>
      </span>
    </TimelineEntry>
  );
}

/** A note about the run (a plan check, steps added, a limit reached). */
export function NoteEntry({ item }: { item: NoteItem }) {
  const isWarn = item.tone === 'warn';
  return (
    <TimelineEntry>
      <p
        className={`inline-flex rounded-lg border px-2.5 py-1 text-[12px] leading-snug ${
          isWarn
            ? 'border-warn-line bg-warn-bg text-warn'
            : 'border-[color-mix(in_srgb,var(--accent)_25%,transparent)] bg-accent-soft text-accent-2'
        }`}
      >
        {item.text}
      </p>
    </TimelineEntry>
  );
}

/** Where the agent made its plan: the goal, as a highlighted banner. */
export function PlanGoalEntry({ goal }: { goal: string }) {
  return (
    <TimelineEntry>
      <div className="flex items-start gap-3 rounded-xl border border-[color-mix(in_srgb,var(--accent)_28%,transparent)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--accent)_12%,var(--surface)),var(--surface))] px-3.5 py-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-on-accent shadow-accent">
          <FlagIcon size={13} />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-accent-2">
            Plan
          </span>
          <p className="text-[13px] font-semibold leading-snug text-ink [overflow-wrap:anywhere]">
            {goal}
          </p>
        </div>
      </div>
    </TimelineEntry>
  );
}

const STEP_BADGE: Record<StepStatus, string> = {
  pending: 'bg-surface-2 text-ink-3',
  in_progress: 'bg-accent text-on-accent',
  done: 'bg-success-bg text-success',
  failed: 'bg-danger-bg text-danger',
  skipped: 'bg-surface-2 text-ink-4',
};

function StepGlyph({ status, number }: { status: StepStatus; number: number }) {
  if (status === 'done') return <CheckIcon size={11} />;
  if (status === 'failed') return <CrossIcon size={11} />;
  if (status === 'skipped') return <DashIcon size={11} />;
  return <>{number}</>;
}

/** A plan step heading the work done for it: a section title with a numbered badge. */
export function StepEntry({ step, number }: { step: PlanStep | null; number: number }) {
  const status: StepStatus = step?.status ?? 'in_progress';
  const isActive = status === 'in_progress';
  return (
    <TimelineEntry className="pt-1.5 first:pt-0">
      <div className="flex items-start gap-2.5">
        <span
          aria-label={STATUS_LABEL[status]}
          className={`relative grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-bold tabular-nums ${STEP_BADGE[status]}`}
        >
          {isActive && (
            <span
              aria-hidden
              className="absolute inset-[-3px] animate-ping rounded-[10px] border border-accent opacity-30 motion-reduce:hidden"
            />
          )}
          <StepGlyph status={status} number={number} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <p
              className={`min-w-0 text-[13.5px] font-semibold leading-6 [overflow-wrap:anywhere] ${
                status === 'skipped' ? 'italic text-ink-3 line-through' : 'text-ink'
              }`}
            >
              {step?.text ?? `Step ${number}`}
            </p>
            {status !== 'done' && (
              <span
                className={`shrink-0 rounded-full px-2 text-[10.5px] font-semibold leading-[18px] ${
                  isActive
                    ? 'bg-accent-soft text-accent-2'
                    : status === 'failed'
                      ? 'bg-danger-bg text-danger'
                      : 'bg-surface-2 text-ink-3'
                }`}
              >
                {STATUS_LABEL[status]}
              </span>
            )}
          </div>
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
      </div>
    </TimelineEntry>
  );
}
