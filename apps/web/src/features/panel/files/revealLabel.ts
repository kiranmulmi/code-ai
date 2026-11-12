/**
 * What the system's file manager is called, for "Reveal in …". The API runs on this same
 * machine (it only listens locally), so the browser's system is the one that opens it.
 */
function fileManagerLabel(): string {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Mac/i.test(agent)) return 'Reveal in Finder';
  if (/Windows/i.test(agent)) return 'Reveal in File Explorer';
  return 'Open containing folder';
}

export const REVEAL_LABEL = fileManagerLabel();
