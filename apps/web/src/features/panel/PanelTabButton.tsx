import type { ReactNode } from 'react';

export function PanelTabButton({
  id,
  isActive,
  onSelect,
  controls = 'panel-body',
  isSmall = false,
  label,
  children,
}: {
  id: string;
  isActive: boolean;
  /** the tab panel it shows */
  controls?: string;
  /** the lower section's shorter tab strip */
  isSmall?: boolean;
  onSelect: () => void;
  /** the tab's name as a tooltip and accessible name, for icon-only tabs */
  label?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`panel-tab-${id}`}
      aria-selected={isActive}
      aria-controls={controls}
      onClick={onSelect}
      title={label}
      aria-label={label}
      className={`group/tab -mb-px flex items-center gap-1.5 border-b-2 font-medium ${isSmall ? 'px-2 text-[12.5px]' : 'px-2.5 text-[13px]'} transition-[color,border-color] duration-200 [&>svg]:shrink-0 [&>svg]:transition-[color,transform] [&>svg]:duration-200 ${
        isActive
          ? 'border-accent text-ink [&>svg]:scale-110 [&>svg]:text-accent'
          : 'border-transparent text-ink-2 hover:border-line-strong hover:text-ink [&>svg]:text-ink-3'
      }`}
    >
      {children}
    </button>
  );
}
