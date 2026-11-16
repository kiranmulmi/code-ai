import { CONTEXT } from '@app/shared';
import { compactNumber } from '../../lib/format';

/** How full the model's context window was at the last model call: a thin bar and a label. */
export function ContextMeter({
  usedTokens,
  windowTokens,
}: {
  usedTokens: number;
  windowTokens: number;
}) {
  const share = windowTokens > 0 ? Math.min(1, usedTokens / windowTokens) : 0;
  const percent = Math.round(share * 100);
  // The agent summarizes at a share of the window or a fixed token count, whichever comes first.
  const summarizesAt = Math.min(windowTokens * CONTEXT.summarizeAtShare, CONTEXT.summarizeAtTokens);
  const isNear = windowTokens > 0 && usedTokens >= summarizesAt;
  return (
    <span
      className="ml-auto inline-flex items-center gap-1.5"
      title={`The last request used ${usedTokens.toLocaleString('en')} of the model's ${windowTokens.toLocaleString('en')}-token context window. From ${Math.round(summarizesAt).toLocaleString('en')} tokens on, older messages are summarized for the model.`}
    >
      <span aria-hidden className="h-1 w-12 overflow-hidden rounded-full bg-line-2">
        <span
          className={`block h-full rounded-full ${isNear ? 'bg-warn' : 'bg-accent'}`}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </span>
      <span>
        Context{' '}
        <span className={`font-medium ${isNear ? 'text-warn' : 'text-ink-2'}`}>{percent}%</span> of{' '}
        {compactNumber(windowTokens)}
      </span>
    </span>
  );
}
