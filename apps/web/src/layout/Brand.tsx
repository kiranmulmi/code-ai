import { LogoIcon } from '../lib/icons';

/**
 * The app's logo mark on its own (not a link). `isHiddenInDesktopApp` drops it where the
 * desktop app's window already carries the brand (html[data-desktop]).
 */
export function Brand({ isHiddenInDesktopApp = false }: { isHiddenInDesktopApp?: boolean }) {
  return (
    <span
      role="img"
      aria-label="Hamro AI"
      title="Hamro AI"
      className={`brand-mark shrink-0 ${isHiddenInDesktopApp ? '[[data-desktop]_&]:hidden' : ''}`}
    >
      <LogoIcon />
    </span>
  );
}
