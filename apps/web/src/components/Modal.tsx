import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CrossIcon } from '../lib/icons';

/**
 * An overlay for looking at (or editing) one thing, e.g. a file or a skill. Laid out like the
 * quick chat panel: a header (round mark, title, a line under it, then the buttons and Close)
 * over a soft accent glow, the scrolling body under it, and an optional footer bar.
 */
export function Modal({
  title,
  description,
  icon,
  aside,
  onClose,
  children,
  actions,
  footer,
  size = 'md',
}: {
  /** the heading in the header; also names the dialog for screen readers */
  title: string;
  /** a short line under the title */
  description?: ReactNode;
  /** an icon for the round mark before the title */
  icon?: ReactNode;
  /** something beside the title, e.g. an "Unsaved" badge */
  aside?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** buttons in the header, before Close */
  actions?: ReactNode;
  /** a bar under the scrolling body, e.g. a form's Save and Cancel */
  footer?: ReactNode;
  /**
   * `lg`: a roomy form; `xl`: the settings popup, wide and a fixed height so switching its
   * tabs doesn't resize it; `wide`: most of the screen, for reading code
   */
  size?: 'md' | 'lg' | 'xl' | 'wide';
}) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Something inside handled it first (the editor closing its search, say).
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Only the top one closes: a popup opened from this one (the folder picker in a
      // workspace form) sits after it in <body>.
      const open = document.querySelectorAll(
        '[role="dialog"], [role="alertdialog"]:not([aria-hidden="true"])',
      );
      if (open[open.length - 1] !== dialog.current) return;
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Portalled to <body>: a transformed ancestor (the sliding panel) would trap `fixed`.
  return createPortal(
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[70] grid place-items-center"
    >
      <div className="absolute inset-0 animate-fade-in bg-overlay" onClick={onClose} />
      <div
        className={`relative flex animate-dialog-in flex-col overflow-hidden rounded-[22px] border border-line bg-surface shadow-dialog ${
          size === 'wide'
            ? 'h-[92vh] w-[min(1440px,calc(100%-32px))]'
            : size === 'xl'
              ? 'h-[min(900px,92vh)] w-[min(1360px,calc(100%-32px))]'
              : size === 'lg'
                ? 'max-h-[92vh] w-[min(1160px,calc(100%-32px))]'
                : 'max-h-[86vh] w-[min(860px,calc(100%-32px))]'
        }`}
      >
        <ModalGlow />
        <header className="relative flex shrink-0 items-center gap-2.5 px-5 pb-3 pt-4">
          {icon && <ModalMark>{icon}</ModalMark>}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-[14.5px] font-semibold leading-tight tracking-tight text-ink">
                {title}
              </h2>
              {aside}
            </div>
            {description && (
              <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-3">
                {description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            {actions}
            <ModalHeaderButton onClick={onClose} label="Close (Esc)" autoFocus>
              <CrossIcon size={14} />
            </ModalHeaderButton>
          </div>
        </header>
        <div className="relative min-h-0 flex-1 overflow-auto">{children}</div>
        {footer && (
          <div className="relative flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-subtle px-5 py-3 has-[>div:only-child:empty]:hidden">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The soft accent glow behind a modal's header, as on the quick chat panel. */
export function ModalGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(120%_100%_at_0%_0%,var(--glow-1),transparent_70%)]"
    />
  );
}

/** The round mark before a modal's title (the quick chat's assistant mark, with any icon). */
export function ModalMark({
  children,
  tone = 'accent',
}: {
  children: ReactNode;
  tone?: 'accent' | 'danger';
}) {
  return (
    <span
      aria-hidden
      className={`grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full ${
        tone === 'danger'
          ? 'bg-danger-bg text-danger'
          : 'bg-gradient-to-br from-accent to-accent-2 text-on-accent shadow-accent'
      }`}
    >
      {children}
    </span>
  );
}

/** A round, borderless icon button for a modal's header, like the quick chat's. */
export function ModalHeaderButton({
  onClick,
  label,
  autoFocus,
  children,
}: {
  onClick: () => void;
  label: string;
  autoFocus?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      autoFocus={autoFocus}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </button>
  );
}
