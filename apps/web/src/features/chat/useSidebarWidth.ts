import { useCallback, useEffect, useState } from 'react';
import { readPref, writePref } from '../../lib/storage';

type SidebarWidthOptions = {
  /** localStorage key the width is remembered under. */
  key: string;
  defaultWidth: number;
  minWidth: number;
};

/** The chats sidebar. */
const CHATS_SIDEBAR: SidebarWidthOptions = {
  key: 'agent.sidebarWidth',
  defaultWidth: 264,
  minWidth: 200,
};

const clamp = (px: number, viewport: number, min: number) =>
  Math.min(Math.max(min, Math.round(viewport * 0.4)), Math.max(min, Math.round(px)));

/**
 * A sidebar's width on wide screens: dragged or reset, and remembered. The chats sidebar's by
 * default; the workspace sidebar passes its own options.
 */
export function useSidebarWidth({
  key,
  defaultWidth,
  minWidth,
}: SidebarWidthOptions = CHATS_SIDEBAR) {
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [preferred, setPreferred] = useState(() => Number(readPref(key)) || defaultWidth);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const width = clamp(preferred, viewport, minWidth);

  const setWidth = useCallback(
    (px: number) => {
      const next = clamp(px, window.innerWidth, minWidth);
      setPreferred(next);
      writePref(key, String(next));
    },
    [key, minWidth],
  );

  const reset = useCallback(() => setWidth(defaultWidth), [setWidth, defaultWidth]);

  return { width, setWidth, reset };
}
