import { ElapsedTime } from '../../components/ElapsedTime';
import { BulbIcon } from '../../lib/icons';

/** Statuses where the model is reasoning ("Thinking…", "Planning…"), not working on the task. */
const THINKING = /^(Thinking|Planning)/;

/**
 * "Thinking…", "Running web_search…": what the agent is doing while no text streams. A pulsing
 * bulb while it thinks, a live dot otherwise, and how long the request has run so far when
 * `startedAt` (ms) is known.
 */
export function StatusLine({
  text,
  startedAt = null,
}: {
  text: string;
  startedAt?: number | null;
}) {
  return (
    <div className="flex items-center gap-2.5 px-0.5 text-[13px] text-ink-3" role="status">
      {THINKING.test(text) ? (
        <BulbIcon size={15} className="thinking-glow shrink-0 text-accent" />
      ) : (
        <span aria-hidden className="live-dot" />
      )}
      {text}
      {startedAt !== null && (
        <>
          <span aria-hidden className="text-ink-4">
            ·
          </span>
          <ElapsedTime startedAt={startedAt} className="text-[12px]" />
        </>
      )}
    </div>
  );
}
