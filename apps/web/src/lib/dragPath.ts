import type { DragEvent } from 'react';

/**
 * Dragging a file or folder from the Files panel carries its absolute path under this type
 * (plus text/plain), so the message box can insert the path instead of attaching a file.
 */
export const PATH_DRAG_TYPE = 'application/x-nimbrio-path';

/** The absolute path of `relative` inside the workspace folder `root`. */
export function absolutePath(root: string, relative: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${relative}`;
}

export function startPathDrag(event: DragEvent<HTMLElement>, path: string): void {
  event.dataTransfer.setData(PATH_DRAG_TYPE, path);
  event.dataTransfer.setData('text/plain', path);
  event.dataTransfer.effectAllowed = 'copy';
}

/** What the desktop app's preload (apps/desktop/src/preload.cts) puts on `window`. */
interface DesktopBridge {
  platform?: string;
  pathForFile?: (file: File) => string;
}

/**
 * The full path of a file or folder dropped from Finder / File Explorer: only the desktop app
 * can tell it. Null in a browser, which shares only the name.
 */
export function desktopPathOf(file: File): string | null {
  const bridge = (window as { nimbrioDesktop?: DesktopBridge }).nimbrioDesktop;
  try {
    return bridge?.pathForFile?.(file) || null;
  } catch {
    return null;
  }
}

/**
 * The text to insert for files dropped from outside the app: their full paths, or (when
 * `pathOf` can't tell one) just the name. Several are separated by spaces; a path with a space
 * in it is quoted, so where each one ends stays clear. `missing`: names without a full path.
 */
export function droppedPathsText(
  files: readonly Pick<File, 'name'>[],
  pathOf: (file: Pick<File, 'name'>) => string | null,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const parts = files.map((file) => {
    const path = pathOf(file);
    if (!path) missing.push(file.name);
    return quoteIfSpaced(path ?? file.name);
  });
  return { text: parts.join(' '), missing };
}

/** A path as typed in the box: quoted when it has whitespace in it. */
export function quoteIfSpaced(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}
