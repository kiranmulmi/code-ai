import type { CSSProperties, ReactNode } from 'react';

/**
 * The body of an activity card: a stack of blocks (notes, grouped tool calls, step headers)
 * with even spacing. No rail or dots: each block carries its own small icon where it helps.
 */
export function Timeline({ children }: { children: ReactNode }) {
  return <ol className="flex flex-col gap-2.5">{children}</ol>;
}

/** One block in the stack: an optional leading icon, its content to the right. */
export function TimelineEntry({
  icon,
  children,
  className = '',
  style,
}: {
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  if (!icon) {
    return (
      <li className={`min-w-0 ${className}`} style={style}>
        {children}
      </li>
    );
  }
  return (
    <li
      className={`grid grid-cols-[22px_minmax(0,1fr)] items-start gap-2.5 ${className}`}
      style={style}
    >
      <div className="flex justify-center pt-[1px]">{icon}</div>
      <div className="min-w-0">{children}</div>
    </li>
  );
}
