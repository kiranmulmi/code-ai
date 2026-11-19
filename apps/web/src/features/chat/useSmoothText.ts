import { useEffect, useRef, useState } from 'react';
import { nextRevealLength, revealCut } from '../../lib/smoothText';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * Streams `text` onto the screen at a steady pace, one animation frame at a time, instead of
 * in the bursts it arrives in (see `smoothText.ts`).
 *
 * Whatever text exists when the block first shows appears at once (an old message, a reload,
 * a block moved elsewhere in the reply), so nothing replays; only growth while it streams is
 * paced. Once streaming stops, what's left still plays out quickly rather than jumping. Returns the text
 * to show and whether it's still catching up (for the streaming cursor).
 */
export function useSmoothText(
  text: string,
  isStreaming: boolean,
): { text: string; isCatchingUp: boolean } {
  // Only text seen streaming is paced; everything else shows as it is.
  const hasStreamed = useRef(isStreaming);
  if (isStreaming) hasStreamed.current = true;
  const isPaced = hasStreamed.current && !prefersReducedMotion();

  const shown = useRef(text.length);
  const [length, setLength] = useState(shown.current);
  const target = useRef(text.length);
  target.current = text.length;

  // Text replaced rather than extended (e.g. trimmed): don't show past its end.
  if (shown.current > text.length) shown.current = text.length;

  // Runs a frame loop while the shown text is behind; new text restarts it if it had caught up.
  useEffect(() => {
    if (!isPaced || shown.current >= text.length) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = nextRevealLength(shown.current, target.current, now - last);
      last = now;
      shown.current = next;
      setLength(Math.floor(next));
      if (next < target.current) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPaced, text.length]);

  if (!isPaced) return { text, isCatchingUp: false };
  const cut = revealCut(text, Math.min(length, text.length));
  return { text: text.slice(0, cut), isCatchingUp: cut < text.length };
}
