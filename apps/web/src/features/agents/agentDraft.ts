// The specialist form's state and checks, kept out of the components so they can be tested.
import {
  TOOL_GROUPS,
  TOOL_GROUP_LABELS,
  specialistInputSchema,
  toAgentName,
  type SpecialistData,
  type SpecialistInfo,
  type SpecialistModel,
  type ToolGroup,
} from '@app/shared';

export interface AgentDraft {
  name: string;
  description: string;
  instructions: string;
  toolGroups: ToolGroup[];
  readOnly: boolean;
  model: SpecialistModel;
}

export type AgentField = 'name' | 'description' | 'instructions' | 'toolGroups';
export type AgentErrors = Partial<Record<AgentField, string>>;

/** A new specialist: every tool group, may change things, on the sub-agent model. */
export const EMPTY_DRAFT: AgentDraft = {
  name: '',
  description: '',
  instructions: '',
  toolGroups: [...TOOL_GROUPS],
  readOnly: false,
  model: 'subagent',
};

export function draftFrom(info: SpecialistInfo): AgentDraft {
  return {
    name: info.name,
    description: info.description,
    instructions: info.instructions,
    toolGroups: [...info.toolGroups],
    readOnly: info.readOnly,
    model: info.model,
  };
}

export function isSameDraft(a: AgentDraft, b: AgentDraft): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.instructions === b.instructions &&
    a.readOnly === b.readOnly &&
    a.model === b.model &&
    a.toolGroups.length === b.toolGroups.length &&
    a.toolGroups.every((group) => b.toolGroups.includes(group))
  );
}

/** Turns one tool group on or off, keeping the app's order. */
export function toggleGroup(groups: readonly ToolGroup[], group: ToolGroup, isOn: boolean) {
  return TOOL_GROUPS.filter((item) => (item === group ? isOn : groups.includes(item)));
}

/** The draft checked as the API checks it (the name tidied first), or the first error per field. */
export function checkDraft(
  draft: AgentDraft,
): { ok: true; data: SpecialistData } | { ok: false; errors: AgentErrors } {
  const checked = specialistInputSchema.safeParse({ ...draft, name: toAgentName(draft.name) });
  if (checked.success) return { ok: true, data: checked.data };
  const errors: AgentErrors = {};
  for (const issue of checked.error.issues) {
    const field = issue.path[0];
    if (
      (field === 'name' ||
        field === 'description' ||
        field === 'instructions' ||
        field === 'toolGroups') &&
      !errors[field]
    ) {
      errors[field] = issue.message;
    }
  }
  return { ok: false, errors };
}

/**
 * A choice that saves but probably isn't meant: read-only drops every tool that changes
 * something, so commands alone leaves it nothing to work with. Null when it's fine.
 */
export function draftWarning(draft: Pick<AgentDraft, 'toolGroups' | 'readOnly'>): string | null {
  if (!draft.readOnly || !draft.toolGroups.includes('commands')) return null;
  return draft.toolGroups.length === 1
    ? 'A read-only specialist can’t run commands, so this one would have no tools. Turn off read-only or add another group.'
    : 'A read-only specialist can’t run commands: it won’t get the Commands tools.';
}

/** One line on what it may do: "Files, Web · read-only · reviewer model". */
export function describeAccess(s: Pick<AgentDraft, 'toolGroups' | 'readOnly' | 'model'>): string {
  const groups =
    s.toolGroups.length === TOOL_GROUPS.length
      ? 'All tools'
      : s.toolGroups.map((group) => TOOL_GROUP_LABELS[group].label).join(', ') || 'No tools';
  return [groups, s.readOnly ? 'read-only' : null, s.model === 'review' ? 'reviewer model' : null]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Fixing a broken file: the name to save it under. A file already named right keeps its name
 * (and saving writes over it); otherwise the name tidied, and the old file is removed after.
 */
export function fixTarget(file: string): { name: string; replacesFile: string | null } {
  const base = file.replace(/\.md$/, '');
  const name = toAgentName(base);
  return { name, replacesFile: name === base ? null : file };
}
