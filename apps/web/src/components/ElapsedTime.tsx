import { formatElapsed } from '../lib/format';
import { useNow } from '../lib/useNow';

/**
 * How long something has been running, e.g. "1m 05s", ticking every second. `startedAt` is
 * in ms since the epoch; nothing shows without it.
 */
export function ElapsedTime({
  startedAt,
  className = '',
}: {
  startedAt: number | null;
  className?: string;
}) {
  const now = useNow(startedAt !== null, 1_000);
  if (startedAt === null) return null;
  return (
    <span
      className={`tabular-nums ${className}`}
      title={`Started ${new Date(startedAt).toLocaleTimeString()}`}
      aria-label={`Running for ${formatElapsed((now - startedAt) / 1000)}`}
    >
      {formatElapsed((now - startedAt) / 1000)}
    </span>
  );
}
