/**
 * Pacing for streamed text. Models send text in uneven bursts (a few words, a pause, a whole
 * line), so showing each burst as it lands looks jerky. Instead the shown text moves towards
 * what has arrived a little every frame: the bigger the backlog, the faster it goes, so it
 * never lags far behind, and the next burst usually lands before the backlog runs out.
 */

/** Slowest reveal, in characters a second, so a small backlog still moves briskly. */
export const MIN_CHARS_PER_SECOND = 90;
/** Roughly how long (s) a backlog takes to show; shorter catches up sooner but looks burstier. */
export const CATCH_UP_SECONDS = 0.35;
/** A long gap between frames (a hidden tab) counts as at most this, so it doesn't leap. */
const MAX_FRAME_MS = 100;

/**
 * How many characters to show after a frame of `elapsedMs`, given `shown` so far (fractional,
 * so slow rates still advance) and `target` arrived. Never goes past `target`.
 */
export function nextRevealLength(shown: number, target: number, elapsedMs: number): number {
  if (shown >= target) return target;
  const seconds = Math.min(Math.max(elapsedMs, 0), MAX_FRAME_MS) / 1000;
  const backlog = target - shown;
  const rate = Math.max(MIN_CHARS_PER_SECOND, backlog / CATCH_UP_SECONDS);
  return Math.min(target, shown + rate * seconds);
}

/**
 * Where to cut `text` to show about `length` characters without splitting a surrogate pair
 * (an emoji would flash as a broken character).
 */
export function revealCut(text: string, length: number): number {
  let cut = Math.min(text.length, Math.max(0, Math.floor(length)));
  if (cut > 0 && cut < text.length) {
    const code = text.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut += 1; // high surrogate: keep its pair together
  }
  return cut;
}
