import { useEffect, useRef, type MutableRefObject } from 'react';

/** Bar width and gap, in CSS pixels. */
const BAR = 2;
const GAP = 2;
/** A new bar every this many ms. */
const STEP_MS = 70;

/**
 * A scrolling waveform: every STEP_MS it samples `levelRef` (0 to 1) and adds a bar on the right,
 * older bars moving left. Quiet moments show as small dots. Drawn on a canvas in the current text
 * colour; it freezes (keeps what it drew) when `isLive` turns false.
 */
export function Waveform({
  levelRef,
  isLive,
  className = '',
}: {
  levelRef: MutableRefObject<number>;
  isLive: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (
        canvas.width !== Math.round(width * ratio) ||
        canvas.height !== Math.round(height * ratio)
      ) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const color = getComputedStyle(canvas).color;
      const count = Math.floor((width + GAP) / (BAR + GAP));
      const levels = levelsRef.current;
      const shown = levels.slice(-count);
      const mid = height / 2;
      // Empty slots on the left (before anything was said) are faint dots.
      for (let slot = 0; slot < count; slot += 1) {
        const index = slot - (count - shown.length);
        const x = slot * (BAR + GAP);
        const level = index >= 0 ? (shown[index] ?? 0) : 0;
        const barHeight = Math.max(BAR, Math.round(level * height));
        context.globalAlpha = index >= 0 ? (level > 0.05 ? 1 : 0.55) : 0.25;
        context.fillStyle = color;
        context.beginPath();
        context.roundRect(x, mid - barHeight / 2, BAR, barHeight, BAR / 2);
        context.fill();
      }
      context.globalAlpha = 1;
    };

    draw();
    const onResize = new ResizeObserver(draw);
    onResize.observe(canvas);
    if (!isLive) return () => onResize.disconnect();

    const timer = window.setInterval(() => {
      // Ease the curve so normal speech fills the height without clipping.
      const level = Math.min(1, Math.pow(levelRef.current, 1.4) * 1.6);
      levelsRef.current.push(level);
      if (levelsRef.current.length > 1000) levelsRef.current.splice(0, 500);
      draw();
    }, STEP_MS);
    return () => {
      window.clearInterval(timer);
      onResize.disconnect();
    };
  }, [isLive, levelRef]);

  return <canvas ref={canvasRef} aria-hidden className={`block h-6 min-w-0 ${className}`} />;
}
