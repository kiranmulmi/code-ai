import { isRecord } from '../errors.js';
import { GENERAL_SPECIALIST, renderSpecialists, type Specialist } from '../team/specialists.js';
import { defineTool, type Tool } from './define.js';

/** A sub-agent's name in approvals and the chat, when the model gives none. */
const DEFAULT_LABEL = 'Sub-agent';
const MAX_LABEL_CHARS = 60;

export const DELEGATE_TOOL_NAME = 'delegate_task';

type DelegateInput = { task: string; label?: string; agent?: string };

/**
 * delegate_task: hands one self-contained part of the task to a specialist sub-agent with a
 * fresh context. Only sent when sub-agents are on (Settings → Agent); sub-agents don't get it,
 * so they never start others. Several calls in one step run at the same time.
 */
export function makeDelegateTask(specialists: readonly Specialist[]): Tool<DelegateInput> {
  const names = specialists.map((s) => s.name);
  return defineTool<DelegateInput>({
    name: DELEGATE_TOOL_NAME,
    description: `Hand one self-contained part of the task to a specialist sub-agent and get its report back. It starts with a fresh context (it does not see this conversation), has only its specialist's tools, and asks the user before actions that change things. Use it for a large, separable piece of work whose details you don't need to keep in your own context: researching one topic across many pages, exploring an unfamiliar part of the codebase, a well-defined change in one area, or an independent review. Don't use it for quick lookups or small steps you can do yourself. Several delegate_task calls in the same step run at the same time, so split independent work (e.g. one researcher per topic) into parallel calls; work that depends on another's result goes in a later step. Sub-agents share the team notes (post_note / read_notes) with you and each other. Write the task so a newcomer can do it: the goal, everything it needs to know, constraints, and what to report back.

Specialists:
${renderSpecialists(specialists)}`,
    properties: {
      task: {
        type: 'string',
        description:
          'Complete instructions for the sub-agent: goal, needed context (paths, names, decisions so far), constraints, and exactly what its final answer should contain.',
      },
      agent: {
        type: 'string',
        enum: names,
        description: `Which specialist does it. Default "${GENERAL_SPECIALIST}".`,
      },
      label: {
        type: 'string',
        description: `A short name for this sub-task, shown to the user (under ${MAX_LABEL_CHARS} characters), e.g. "Research pricing".`,
      },
    },
    optional: ['label', 'agent'],
    async run({ task, label, agent }, ctx) {
      if (!ctx.delegate) throw new Error('Sub-agents are turned off. Do this part yourself.');
      const text = task.trim();
      if (!text) throw new Error('Write the task for the sub-agent.');
      const specialist = (agent ?? '').trim() || GENERAL_SPECIALIST;
      if (!names.includes(specialist)) {
        throw new Error(
          `There is no specialist "${specialist}". Pick one of: ${names.join(', ')}.`,
        );
      }
      const name = (label ?? '').trim().slice(0, MAX_LABEL_CHARS) || DEFAULT_LABEL;
      return ctx.delegate({ task: text, label: name, agent: specialist });
    },
  });
}

/** The label a delegate_task call was given, for showing it before it runs. */
export function delegateLabel(args: unknown): string {
  const label = isRecord(args) && typeof args.label === 'string' ? args.label.trim() : '';
  return label.slice(0, MAX_LABEL_CHARS) || DEFAULT_LABEL;
}
