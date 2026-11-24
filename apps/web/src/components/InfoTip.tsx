import type { ReactNode } from 'react';
import { InfoIcon } from '../lib/icons';

/**
 * A small info icon that shows an explanation on hover or keyboard focus, so dense forms
 * (the settings popup) can keep their hints out of the way.
 */
export function InfoTip({
  text,
  label,
  align = 'start',
}: {
  text: ReactNode;
  label?: string;
  /** `end`: the tip opens towards the left, for an icon near the right edge */
  align?: 'start' | 'end';
}) {
  return (
    <span className="group relative inline-flex align-middle">
      <span
        tabIndex={0}
        aria-label={label ?? (typeof text === 'string' ? text : 'More information')}
        className="grid h-4 w-4 place-items-center rounded text-ink-3 outline-none transition-colors hover:text-ink focus-visible:text-accent"
      >
        <InfoIcon size={11} />
      </span>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-30 mt-1 hidden w-72 max-w-[80vw] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11.5px] font-normal leading-snug text-ink-2 shadow-dialog group-focus-within:block group-hover:block ${
          align === 'end' ? 'right-0' : 'left-0'
        }`}
      >
        {text}
      </span>
    </span>
  );
}
