// Runs in the window before the page (sandboxed, so CommonJS). It tells the page it's in the
// desktop app and on which platform (public/theme-init.js in the web app reads it and sets
// data-desktop on <html>, which makes room for the window buttons: there's no title bar), and
// gives the page the full path of a file or folder dropped on it from Finder / File Explorer,
// which a page can't read by itself (the message box inserts it).
import { contextBridge, webUtils } from 'electron';

contextBridge.exposeInMainWorld('hamroDesktop', {
  platform: process.platform,
  /** The dropped file's or folder's absolute path; empty when it has none (made in the page). */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
});
