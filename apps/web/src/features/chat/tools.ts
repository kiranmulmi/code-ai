import type { CommandFiles } from '@app/shared';
import { hostOf, inlineArgs, parseArgs, shorten } from '../../lib/format';

/** The plan panel shows these; in the chat they would only repeat it. */
export const PLAN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'create_plan',
  'update_plan',
  'add_plan_steps',
]);

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const ACTIVITY: Record<string, (args: Record<string, unknown>) => string> = {
  web_search: (a) => `Searching “${shorten(text(a.query), 60)}”`,
  fetch_page: (a) =>
    `Reading ${hostOf(a.url)}${typeof a.page === 'number' && a.page > 1 ? ` · part ${a.page}` : ''}`,
  list_files: (a) => `Looking through ${text(a.path) || 'the workspace'}`,
  read_file: (a) => `Reading ${text(a.path)}`,
  find_files: (a) => `Finding files named ${shorten(text(a.pattern), 40)}`,
  search_files: (a) => `Searching files for “${shorten(text(a.query), 50)}”`,
  write_file: (a) => `Writing ${text(a.path)}`,
  edit_file: (a) => `Editing ${text(a.path)}`,
  create_folder: (a) => `Creating folder ${text(a.path)}`,
  move_path: (a) => `Moving ${text(a.from)} to ${text(a.to)}`,
  copy_path: (a) => `Copying ${text(a.from)} to ${text(a.to)}`,
  delete_path: (a) => `Deleting ${text(a.path)}`,
  run_command: (a) => `Running ${shorten(text(a.command), 60)}`,
  ask_user: () => 'Waiting for your answer',
  remember: () => 'Saving to memory',
  recall: () => 'Searching memory',
  forget: () => 'Deleting from memory',
  delegate_task: (a) =>
    `${specialistTitle(text(a.agent) || 'general')}: ${shorten(text(a.label) || text(a.task), 60)}`,
};

/** A short line for the plan panel about what a tool call is doing. */
export function describeActivity(name: string, args: string): string {
  const describe = ACTIVITY[name];
  return describe ? describe(parseArgs(args)) : `Running ${name}`;
}

/**
 * The collapsed line for a tool call: the agent's reason for it when it gave one (commands and
 * other steps that ask first), which says what is going on better than the raw arguments.
 */
export function stepSummary(args: string): { text: string; isReason: boolean } {
  const reason = text(parseArgs(args).reason).trim();
  return reason ? { text: reason, isReason: true } : { text: inlineArgs(args), isReason: false };
}

/** How many steps an `add_plan_steps` call adds. */
export function addedStepCount(args: string): number {
  const steps = parseArgs(args).steps;
  return Array.isArray(steps) ? steps.length : 0;
}

/** A specialist's name as a title: "security-auditor" -> "Security auditor". */
export function specialistTitle(name: string): string {
  const words = name.replace(/-/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Sub-agent';
}

/** delegate_task: which specialist it went to and its label (the args as the model sent them). */
export function delegateInfo(args: string): { specialist: string; label: string } {
  const a = parseArgs(args);
  return {
    specialist: text(a.agent).trim() || 'general',
    label: text(a.label).trim() || shorten(text(a.task), 60) || 'Sub-agent',
  };
}

/** run_command's row: how many files it changed and read, e.g. "2 changed · 1 read" ("" if none). */
export function commandFilesSummary(files: CommandFiles): string {
  const changed = files.changed.length + files.moreChanged;
  const read = files.read.length + files.moreRead;
  const noun = (count: number) => `${count} file${count === 1 ? '' : 's'}`;
  if (changed && read) return `${changed} changed · ${read} read`;
  if (changed) return `${noun(changed)} changed`;
  if (read) return `${noun(read)} read`;
  return '';
}
