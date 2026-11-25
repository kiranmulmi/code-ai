import type { CSSProperties, ReactNode } from 'react';

/**
 * The spine of an activity card: entries hang off one vertical rail, each with its own node
 * (a tool's icon, a step number, a dot for narration).
 */
export function Timeline({ children }: { children: ReactNode }) {
  return (
    <ol className="relative flex flex-col py-1 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-px before:bg-line">
      {children}
    </ol>
  );
}

/** One entry on the rail: its node in the gutter, its content to the right. */
export function TimelineEntry({
  node,
  children,
  className = '',
  style,
}: {
  node: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <li className={`relative grid grid-cols-[32px_minmax(0,1fr)] ${className}`} style={style}>
      <div className="relative z-[1] flex justify-center pt-[5px]">{node}</div>
      <div className="min-w-0">{children}</div>
    </li>
  );
}

/** A narration node: a small ring on the rail. */
export function DotNode({ tone = 'muted' }: { tone?: 'muted' | 'accent' | 'warn' }) {
  const color =
    tone === 'accent'
      ? 'border-accent'
      : tone === 'warn'
        ? 'border-warn-line'
        : 'border-line-strong';
  return (
    <span className="grid h-[22px] w-[22px] place-items-center">
      <span className={`h-2 w-2 rounded-full border-[1.5px] bg-surface ${color}`} />
    </span>
  );
}
