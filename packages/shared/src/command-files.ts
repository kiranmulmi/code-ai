// The workspace files a run_command touched: which it changed (found by comparing the
// workspace before and after) and which it read (guessed from the command line). The agent
// writes them as two lines right under the command's status, so the model sees them and the
// chat (which keeps only the start of a result) can show them as file chips.
import { TOOL_LIMITS } from './constants.js';

export type CommandFileChange = 'added' | 'modified' | 'deleted';

export interface CommandFiles {
  /** files the command created, changed or deleted, relative to the workspace folder */
  changed: { path: string; change: CommandFileChange }[];
  /** existing files the command line names as input (cat, head, grep, …): a guess */
  read: string[];
  /** files left out of each list past the limit */
  moreChanged: number;
  moreRead: number;
}

const CHANGED_PREFIX = 'files changed: ';
const READ_PREFIX = 'files read: ';
const MARK: Record<CommandFileChange, string> = { added: 'A', modified: 'M', deleted: 'D' };
const CHANGE_OF: Record<string, CommandFileChange> = { A: 'added', M: 'modified', D: 'deleted' };
const MORE = /^\+(\d+) more$/;

/** Paths with a comma or a newline would break the list; they are rare enough to leave out. */
const isListable = (path: string) => !/[,\n\r]/.test(path) && path.trim() === path && path !== '';

/** The lines to put under the status line (none when the command touched nothing). */
export function formatCommandFiles(
  changed: CommandFiles['changed'],
  read: readonly string[],
): string[] {
  const limit = TOOL_LIMITS.runCommand.maxFilesListed;
  const lines: string[] = [];
  const changes = changed.filter((entry) => isListable(entry.path));
  if (changes.length > 0) {
    const shown = changes.slice(0, limit).map((entry) => `${MARK[entry.change]} ${entry.path}`);
    if (changes.length > limit) shown.push(`+${changes.length - limit} more`);
    lines.push(CHANGED_PREFIX + shown.join(', '));
  }
  const reads = read.filter(isListable);
  if (reads.length > 0) {
    const shown = reads.slice(0, limit);
    if (reads.length > limit) shown.push(`+${reads.length - limit} more`);
    lines.push(READ_PREFIX + shown.join(', '));
  }
  return lines;
}

/** The files a run_command result lists (both lists empty when it lists none). */
export function parseCommandFiles(result: string): CommandFiles {
  const files: CommandFiles = { changed: [], read: [], moreChanged: 0, moreRead: 0 };
  // Only the header: the lines between the "$ command" line and the first blank line.
  const header = result.split('\n\n', 1)[0] ?? '';
  for (const line of header.split('\n').slice(1)) {
    if (line.startsWith(CHANGED_PREFIX)) {
      for (const item of line.slice(CHANGED_PREFIX.length).split(', ')) {
        const more = MORE.exec(item);
        if (more) files.moreChanged = Number(more[1]);
        else {
          const change = CHANGE_OF[item.charAt(0)];
          if (change && item.charAt(1) === ' ') files.changed.push({ path: item.slice(2), change });
        }
      }
    } else if (line.startsWith(READ_PREFIX)) {
      for (const item of line.slice(READ_PREFIX.length).split(', ')) {
        const more = MORE.exec(item);
        if (more) files.moreRead = Number(more[1]);
        else if (item) files.read.push(item);
      }
    }
  }
  return files;
}
