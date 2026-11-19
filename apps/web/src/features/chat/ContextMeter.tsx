import { CONTEXT } from '@app/shared';
import { compactNumber } from '../../lib/format';

/**
 * How full the model's context was at the last model call: a thin bar and a label. The bar fills
 * toward the point where older messages get summarized (on a large window that is far below the
 * window itself), so a summary never happens while the bar still looks nearly empty.
 */
export function ContextMeter({
  usedTokens,
  windowTokens,
  summarizeAtTokens,
}: {
  usedTokens: number;
  windowTokens: number;
  /** From the agent; older events lack it, so fall back to the same rule the agent uses. */
  summarizeAtTokens?: number;
}) {
  const summarizesAt =
    summarizeAtTokens && summarizeAtTokens > 0
      ? summarizeAtTokens
      : Math.min(windowTokens * CONTEXT.summarizeAtShare, CONTEXT.summarizeAtTokens);
  const share = summarizesAt > 0 ? Math.min(1, usedTokens / summarizesAt) : 0;
  const percent = Math.round(share * 100);
  const isNear = share >= 0.85;
  return (
    <span
      className="ml-auto inline-flex items-center gap-1.5"
      title={`The last request used ${usedTokens.toLocaleString('en')} tokens. Older messages are summarized for the model at ${Math.round(summarizesAt).toLocaleString('en')} tokens (the model's full window is ${windowTokens.toLocaleString('en')}).`}
    >
      <span aria-hidden className="h-1 w-12 overflow-hidden rounded-full bg-line-2">
        <span
          className={`block h-full rounded-full ${isNear ? 'bg-warn' : 'bg-accent'}`}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </span>
      <span>
        Context{' '}
        <span className={`font-medium ${isNear ? 'text-warn' : 'text-ink-2'}`}>
          {compactNumber(usedTokens)}
        </span>{' '}
        / {compactNumber(Math.round(summarizesAt))} before summary
      </span>
    </span>
  );
}
