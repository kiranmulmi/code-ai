import type { PlanStep, StepStatus } from '@app/shared';
import { STATUS_LABEL } from './planState';

const FINISHED: ReadonlySet<StepStatus> = new Set(['done', 'failed', 'skipped']);

/** Marks laid over the fill where a step didn't simply finish. */
const MARK: Partial<Record<StepStatus, string>> = {
  failed: 'bg-danger-line',
  skipped: 'bg-ink-4/70',
};

/**
 * The plan's progress as one slim, rounded bar: it fills smoothly as steps finish, the step
 * in progress shimmers just past the fill, and failed or skipped steps leave a mark where
 * they sit. Each step keeps a hover zone with its status and text as a tooltip.
 */
export function SegmentBar({ steps }: { steps: PlanStep[] }) {
  const total = Math.max(steps.length, 1);
  const done = steps.filter((step) => step.status === 'done').length;
  const finished = steps.filter((step) => FINISHED.has(step.status)).length;
  const activeIndex = steps.findIndex((step) => step.status === 'in_progress');
  const share = 100 / total;
  const isComplete = steps.length > 0 && finished === steps.length;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={steps.length}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${steps.length} steps done`}
      className="relative h-1 w-full overflow-hidden rounded-full bg-line"
    >
      {/* The fill: everything finished so far. */}
      <span
        className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out ${
          isComplete
            ? 'bg-success-line'
            : 'bg-[linear-gradient(90deg,var(--success-line),var(--accent))]'
        }`}
        style={{ width: `${(finished / total) * 100}%` }}
      />
      {/* The step in progress: a soft shimmer at the live edge. */}
      {activeIndex !== -1 && (
        <span
          className="absolute inset-y-0 animate-shimmer rounded-full bg-[linear-gradient(90deg,var(--accent-bg)_0%,var(--accent)_50%,var(--accent-bg)_100%)] bg-[length:200%_100%] opacity-80 transition-[left] duration-500 ease-out motion-reduce:animate-none"
          style={{ left: `${activeIndex * share}%`, width: `${share}%` }}
        />
      )}
      {/* Failed / skipped marks, and a tooltip zone per step. */}
      {steps.map((step, index) => (
        <span
          key={index}
          title={`${STATUS_LABEL[step.status]}: ${step.text}`}
          className={`absolute inset-y-0 ${MARK[step.status] ?? ''}`}
          style={{ left: `${index * share}%`, width: `${share}%` }}
        />
      ))}
    </div>
  );
}
