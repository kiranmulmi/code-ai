import { z } from 'zod';
import { LIMITS } from './constants.js';
import { workspaceVoiceSchema, type WorkspaceVoice } from './voice.js';

/**
 * Groups of built-in tools a workspace can turn off (a chat-only workspace doesn't need file
 * or command tools). Off, their definitions and the matching system prompt rules aren't sent,
 * which makes every model call smaller. ask_user is always on; attachment
 * tools come with attached files, skills and MCP tools with the workspace's own.
 */
export const TOOL_GROUPS = ['files', 'commands', 'web', 'memory', 'plans'] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

/**
 * Groups a new workspace starts with turned off: the user turns the Files tools on for a
 * workspace on purpose. Only new workspaces get this; saved ones keep their own choice.
 */
export const DEFAULT_DISABLED_TOOLS: readonly ToolGroup[] = ['files'];

const MAX_SLUG_LENGTH = 64;
/** What a workspace's data subfolder holds: a workspace named like one would be mistaken for old data. */
const RESERVED_SLUGS: ReadonlySet<string> = new Set(['chats', 'uploads', 'skills', 'agents']);

/**
 * The name of a workspace's data subfolder (`<folder>/.code-ai/<slug>/`), so several
 * workspaces can share a folder: its name in lowercase letters and digits (accents dropped),
 * any other run of characters a single '-', at most 64 long ("Client Site / v2" ->
 * "client-site-v2"). A name with none of those (all symbols, or another script) gets
 * "workspace-" and 8 hex characters from the name, so it stays the same; one that reads like
 * a data folder (chats, skills, ...) gets "-workspace" added. Never empty, '.', '..' or
 * anything with a path separator. Two workspaces on one folder need different slugs.
 */
export function workspaceSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
  if (!slug) return `workspace-${fnv1a(name.trim().toLowerCase())}`;
  return RESERVED_SLUGS.has(slug) ? `${slug}-workspace` : slug;
}

/** 32-bit FNV-1a of the text as 8 hex characters: stable, and runs in the browser too. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    hash ^= code;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export const TOOL_GROUP_LABELS: Record<ToolGroup, { label: string; detail: string }> = {
  files: { label: 'Files', detail: 'Read, search, write, move and delete files in the folder' },
  commands: { label: 'Commands', detail: 'Run shell commands: tests, builds, installs, git' },
  web: { label: 'Web', detail: 'Search the web and read pages' },
  memory: { label: 'Memory', detail: 'Save, look up and forget lasting facts' },
  plans: { label: 'Plans', detail: 'Write and track a step-by-step plan for bigger tasks' },
};

/**
 * How bigger tasks get planned (`PlanningMode`): `default` follows Settings → Agent; `off` (the
 * agent plans itself when needed) and `auto` (a planning step before each message) override it
 * for this workspace. In the order the workspace form shows them.
 */
export const WORKSPACE_PLANNING = ['default', 'off', 'auto'] as const;
export type WorkspacePlanning = (typeof WORKSPACE_PLANNING)[number];

export interface Workspace {
  id: string;
  name: string;
  instructions: string;
  /** The absolute folder on the user's machine the file tools work in. */
  path: string;
  planning: WorkspacePlanning;
  /** Tool groups turned off here (empty: all on). */
  disabledTools: ToolGroup[];
  /** Show the side panel's Terminal tab (off by default). */
  hasTerminalTab: boolean;
  /** Show the side panel's Git diff tab (off by default). */
  hasGitTab: boolean;
  /** Speech to text for the mic button; null until set up in the workspace settings. */
  voice: WorkspaceVoice | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** The sidebar folder (WorkspaceGroup) it's filed in; null at the top level. */
  groupId: string | null;
  chatCount?: number;
  /** In the list: when a chat here last changed, else when the workspace did. */
  lastActiveAt?: string | null;
}

/**
 * A folder in the workspace sidebar that collects workspaces. Only a way to file them: it has
 * nothing to do with the folders on disk, and deleting it moves its workspaces to the top level.
 */
export interface WorkspaceGroup {
  id: string;
  name: string;
  createdAt: string | null;
}

export interface WorkspaceDeletion {
  /** Files are never deleted with a workspace; this is where they stay. */
  filesKeptAt: string;
}

const name = z
  .string()
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'Give the workspace a name.')
      .max(LIMITS.workspaceName, `Keep the name under ${LIMITS.workspaceName} characters.`),
  );

// The API resolves "~", checks the folder and creates it if missing; this only
// catches what's wrong before a request is sent (the browser has no path module).
const folderPath = z
  .string()
  .trim()
  .min(1, 'Choose a folder for the workspace.')
  .max(LIMITS.folderPath, `Keep the path under ${LIMITS.folderPath} characters.`)
  .regex(/^(~(\/|$)|\/|[A-Za-z]:[\\/])/, 'Use an absolute path, like /Users/you/projects/app.');

const instructions = z
  .string()
  .trim()
  .max(LIMITS.instructions, `Keep instructions under ${LIMITS.instructions} characters.`);

const planning = z.enum(WORKSPACE_PLANNING);
const disabledTools = z.array(z.enum(TOOL_GROUPS)).transform((groups) => [...new Set(groups)]);

export const workspaceInputSchema = z.object({
  name,
  path: folderPath,
  instructions: instructions.default(''),
  planning: planning.default('default'),
  disabledTools: disabledTools.default([...DEFAULT_DISABLED_TOOLS]),
  hasTerminalTab: z.boolean().default(true),
  hasGitTab: z.boolean().default(true),
  voice: workspaceVoiceSchema.nullable().default(null),
});

export const workspaceUpdateSchema = z.object({
  name: name.optional(),
  path: folderPath.optional(),
  instructions: instructions.optional(),
  planning: planning.optional(),
  disabledTools: disabledTools.optional(),
  hasTerminalTab: z.boolean().optional(),
  hasGitTab: z.boolean().optional(),
  /** null turns speech to text off for the workspace. */
  voice: workspaceVoiceSchema.nullable().optional(),
  /** Files it in a sidebar folder; null moves it back to the top level. */
  groupId: z.string().uuid().nullable().optional(),
});

const groupName = z
  .string()
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'Give the folder a name.')
      .max(LIMITS.workspaceName, `Keep the name under ${LIMITS.workspaceName} characters.`),
  );

/** Creating or renaming a sidebar folder. */
export const workspaceGroupInputSchema = z.object({ name: groupName });

export type WorkspaceGroupInput = z.input<typeof workspaceGroupInputSchema>;
export type WorkspaceInput = z.input<typeof workspaceInputSchema>;
export type WorkspaceUpdate = z.input<typeof workspaceUpdateSchema>;
