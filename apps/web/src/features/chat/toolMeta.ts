import { hostOf, parseArgs, shorten } from '../../lib/format';

/** A family of tools, drawn in its own colour so a run of calls reads at a glance. */
export type ToolFamily = 'read' | 'write' | 'command' | 'web' | 'memory' | 'agent' | 'other';

/** Each family's colour, a CSS variable from index.css. */
export const FAMILY_COLOR: Record<ToolFamily, string> = {
  read: 'var(--ft-doc)',
  write: 'var(--ft-style)',
  command: 'var(--ft-shell)',
  web: 'var(--ft-code)',
  memory: 'var(--coral)',
  agent: 'var(--ft-config)',
  other: 'var(--ink-3)',
};

type Meta = { family: ToolFamily; label: string; target: (a: Record<string, unknown>) => string };

const str = (value: unknown) => (typeof value === 'string' ? value : '');

const META: Record<string, Meta> = {
  read_file: { family: 'read', label: 'Read', target: (a) => str(a.path) },
  list_files: { family: 'read', label: 'List', target: (a) => str(a.path) || '.' },
  find_files: { family: 'read', label: 'Find', target: (a) => str(a.pattern) },
  search_files: { family: 'read', label: 'Search', target: (a) => str(a.query) },
  write_file: { family: 'write', label: 'Write', target: (a) => str(a.path) },
  edit_file: { family: 'write', label: 'Edit', target: (a) => str(a.path) },
  create_folder: { family: 'write', label: 'New folder', target: (a) => str(a.path) },
  move_path: {
    family: 'write',
    label: 'Move',
    target: (a) => `${str(a.from)} → ${str(a.to)}`,
  },
  copy_path: {
    family: 'write',
    label: 'Copy',
    target: (a) => `${str(a.from)} → ${str(a.to)}`,
  },
  delete_path: { family: 'write', label: 'Delete', target: (a) => str(a.path) },
  run_command: { family: 'command', label: 'Run', target: (a) => str(a.command) },
  task_output: { family: 'command', label: 'Task output', target: (a) => str(a.task_id) },
  stop_task: { family: 'command', label: 'Stop task', target: (a) => str(a.task_id) },
  web_search: { family: 'web', label: 'Web search', target: (a) => str(a.query) },
  fetch_page: { family: 'web', label: 'Fetch', target: (a) => (a.url ? hostOf(a.url) : '') },
  read_attachment: { family: 'read', label: 'Attachment', target: (a) => str(a.attachment_id) },
  save_attachment: { family: 'write', label: 'Save attachment', target: (a) => str(a.path) },
  view_image: { family: 'read', label: 'View image', target: (a) => str(a.question) },
  remember: { family: 'memory', label: 'Remember', target: (a) => str(a.fact) },
  recall: { family: 'memory', label: 'Recall', target: (a) => str(a.query) },
  forget: { family: 'memory', label: 'Forget', target: () => '' },
  use_skill: { family: 'agent', label: 'Skill', target: (a) => str(a.name) },
  read_skill_file: { family: 'agent', label: 'Skill file', target: (a) => str(a.path) },
  copy_skill_file: { family: 'agent', label: 'Copy skill file', target: (a) => str(a.path) },
  ask_user: { family: 'agent', label: 'Ask', target: (a) => str(a.question) },
  delegate_task: { family: 'agent', label: 'Delegate', target: () => '' },
  load_mcp_tools: { family: 'agent', label: 'Load tools', target: () => '' },
};

/** "mcp__github__create_issue" -> "github · create issue". */
function mcpLabel(name: string): string | null {
  const match = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name);
  return match ? `${match[1]} · ${(match[2] ?? '').replace(/_/g, ' ')}` : null;
}

/** How a tool call row names itself: its family, a short verb, and what it worked on. */
export function toolMeta(
  name: string,
  args: string,
): { family: ToolFamily; label: string; target: string } {
  const meta = META[name];
  if (!meta) {
    return {
      family: name.startsWith('mcp__') ? 'agent' : 'other',
      label: mcpLabel(name) ?? name,
      target: '',
    };
  }
  return {
    family: meta.family,
    label: meta.label,
    target: shorten(meta.target(parseArgs(args)).trim(), 160),
  };
}
