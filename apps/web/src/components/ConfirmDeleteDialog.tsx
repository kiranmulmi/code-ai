import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CrossIcon, TrashIcon } from '../lib/icons';
import { Button } from './Button';
import { ModalGlow, ModalHeaderButton, ModalMark } from './Modal';
import { Spinner } from './Spinner';

export function ConfirmDeleteDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  busyLabel = 'Deleting…',
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    // Captured first and marked handled, so a popup behind it (Modal) stays open.
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (!busy) onCancel();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, busy, onCancel]);

  // Portalled to <body>: a transformed ancestor (the sliding panel) would trap `fixed`. Above
  // popups (z-70) whatever their order in <body>: opened from one, it was hidden behind it.
  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-hidden={!open}
      aria-label={title}
      className={`fixed inset-0 z-[80] grid place-items-center transition-opacity duration-150 ${
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none invisible opacity-0'
      }`}
    >
      <div className="absolute inset-0 bg-overlay" onClick={busy ? undefined : onCancel} />
      <div
        className={`relative flex w-[min(440px,calc(100%-32px))] flex-col overflow-hidden rounded-[22px] border border-line bg-surface shadow-dialog transition-transform duration-200 ${
          open ? 'translate-y-0 scale-100' : 'translate-y-1.5 scale-[0.98]'
        }`}
      >
        <ModalGlow />
        <header className="relative flex items-center gap-2.5 px-5 pb-3 pt-4">
          <ModalMark tone="danger">
            <TrashIcon size={14} />
          </ModalMark>
          <h3 className="min-w-0 flex-1 truncate text-[14.5px] font-semibold leading-tight tracking-tight text-ink">
            {title}
          </h3>
          {!busy && (
            <ModalHeaderButton onClick={onCancel} label="Close (Esc)">
              <CrossIcon size={14} />
            </ModalHeaderButton>
          )}
        </header>
        <div className="relative px-5 pb-5 pt-2 text-[14px] leading-relaxed text-ink-2">
          {message}
        </div>
        <div className="relative flex justify-end gap-2 border-t border-line bg-subtle px-5 py-3">
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy} autoFocus={open}>
            {busy && <Spinner size={13} />}
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
