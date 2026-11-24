// Specialist sub-agents for delegate_task. Each one is a role: what it's for (the main agent
// picks by this), extra instructions for its system prompt, which tool groups it may use, and
// whether it may change anything. The built-in ones run the main agent with every tool group;
// only read-only ones lose the tools that change things. Custom agents can narrow their groups.
import { TOOL_GROUPS, type ToolGroup } from '@app/shared';

export interface Specialist {
  /** kebab-case, what the main agent passes as `agent` */
  name: string;
  /** when to pick it, in one sentence: the main agent decides by this */
  description: string;
  /** added to the sub-agent's system prompt; empty for none */
  instructions: string;
  /** the tool groups it may use (the workspace's own off groups stay off) */
  toolGroups: readonly ToolGroup[];
  /** only tools that change nothing: no writes, commands or memory changes */
  readOnly?: boolean;
  /** which model it runs on: the sub-agent model (default) or the reviewer's */
  model?: 'subagent' | 'review';
}

export const GENERAL_SPECIALIST = 'general';

export const BUILT_IN_SPECIALISTS: readonly Specialist[] = [
  {
    name: GENERAL_SPECIALIST,
    description: 'Any self-contained task that fits none of the others; has every tool.',
    instructions: '',
    toolGroups: TOOL_GROUPS,
  },
  {
    name: 'researcher',
    description:
      'Finding and checking facts on the web or in the workspace files, with sources. Changes nothing.',
    instructions: `You are the team's researcher. Find the facts the task asks for, open the best sources rather than trusting snippets, and cross-check anything important. Report each finding with its source (link or file path). Say plainly what you couldn't confirm.`,
    toolGroups: TOOL_GROUPS,
    readOnly: true,
  },
  {
    name: 'coder',
    description:
      'Writing or changing code and files in the workspace, and running commands, builds and tests to check them.',
    instructions: `You are the team's coder. Read the code around a change before making it, follow the project's existing style, and keep changes to what the task asks. After changing code, run the project's tests or build when it has them and report the real result. List every file you changed.`,
    toolGroups: TOOL_GROUPS,
  },
  {
    name: 'reviewer',
    description:
      'Checking work already done (code, a draft, findings) for mistakes, gaps and risks. Changes nothing.',
    instructions: `You are the team's reviewer. Check the work the task points to against what it was meant to do. Read the actual files or sources; don't trust summaries. Report concrete problems first, most serious first, each with where it is and how to fix it. If it's fine, say so briefly. Don't fix things yourself.`,
    toolGroups: TOOL_GROUPS,
    readOnly: true,
    model: 'review',
  },
  {
    name: 'writer',
    description:
      'Turning findings already gathered (in the task or on the team notes) into a clear document, summary or reply.',
    instructions: `You are the team's writer. Write from the material in the task and the team notes; don't research new facts. Keep every fact, figure, link and caveat accurate to the source material, organise it for the reader, and cut repetition.`,
    toolGroups: TOOL_GROUPS,
    readOnly: true,
  },
];

/** The specialists by name; later entries with the same name replace earlier ones. */
export function specialistMap(list: readonly Specialist[]): Map<string, Specialist> {
  return new Map(list.map((s) => [s.name, s]));
}

/** Tool groups the specialist may not use, joined with the workspace's own off groups. */
export function specialistOffGroups(
  specialist: Specialist,
  workspaceOff: readonly ToolGroup[],
): ToolGroup[] {
  const off = new Set<ToolGroup>(workspaceOff);
  for (const group of TOOL_GROUPS) if (!specialist.toolGroups.includes(group)) off.add(group);
  return TOOL_GROUPS.filter((group) => off.has(group));
}

/** One line per specialist, for delegate_task's description. */
export function renderSpecialists(list: readonly Specialist[]): string {
  return list.map((s) => `- ${s.name}: ${s.description}`).join('\n');
}
