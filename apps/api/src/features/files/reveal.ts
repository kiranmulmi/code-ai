// Shows a file or folder in the system's file manager on this machine, selected there, like
// VS Code's Reveal in Finder (the API only listens locally, so it's the user's own desktop).
// The path goes to each command as an argument, never through a shell.
import { spawn, type SpawnOptions } from 'node:child_process';
import nodePath from 'node:path';
import { pathToFileURL } from 'node:url';
import { HttpError } from '../../lib/errors.js';

/** Past this, an opener that hasn't exited is taken to have worked (some stay running). */
const WAIT_MS = 5_000;

/** The command's exit code, or null when it isn't installed. */
function run(command: string, args: string[], options: SpawnOptions = {}): Promise<number | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: 'ignore', windowsHide: true, ...options });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      child.unref();
      resolve(0);
    }, WAIT_MS);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });
  });
}

const failed = (manager: string) =>
  new HttpError(500, 'REVEAL_FAILED', `${manager} couldn't show it.`);

/** `target` is absolute and already checked to be inside the workspace. */
export async function revealInFileManager(target: string, isFolder: boolean): Promise<void> {
  if (process.platform === 'darwin') {
    const code = await run('open', ['-R', target]);
    if (code !== 0) throw failed('Finder');
    return;
  }
  if (process.platform === 'win32') {
    // Explorer wants the path quoted after the comma, and exits with 1 even when it worked.
    // Windows names can't hold a double quote, so the path can't break out of it.
    const code = await run('explorer.exe', [`/select,"${target}"`], {
      windowsVerbatimArguments: true,
    });
    if (code === null) throw failed('File Explorer');
    return;
  }
  // Linux and others: ask the desktop's file manager to select it (GNOME Files, Dolphin, ...
  // answer this), else open the folder it's in (or the folder itself).
  const uri = pathToFileURL(target).href.replace(/,/g, '%2C'); // a comma splits dbus arrays
  const selected = await run('dbus-send', [
    '--session',
    '--print-reply',
    '--dest=org.freedesktop.FileManager1',
    '--type=method_call',
    '/org/freedesktop/FileManager1',
    'org.freedesktop.FileManager1.ShowItems',
    `array:string:${uri}`,
    'string:',
  ]);
  if (selected === 0) return;
  const opened = await run('xdg-open', [isFolder ? target : nodePath.dirname(target)]);
  if (opened === null) {
    throw new HttpError(501, 'NOT_SUPPORTED', 'There is no file manager to open on this system.');
  }
  if (opened !== 0) throw failed('The file manager');
}
