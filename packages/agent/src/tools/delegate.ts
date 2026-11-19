import { isRecord } from '../errors.js';
import { defineTool } from './define.js';

/** A sub-agent's name in approvals and the chat, when the model gives none. */
const DEFAULT_LABEL = 'Sub-agent';
const MAX_LABEL_CHARS = 60;

/**
 * delegate_task: hands one self-contained part of the task to a sub-agent with a fresh context
 * and the same tools (it asks for approval like the agent does). Only sent when sub-agents are
 * on (Settings → Agent); sub-agents don't get it, so they never start others.
 */
export const delegateTask = defineTool<{ task: string; label?: string }>({
  name: 'delegate_task',
  description:
    "Hand one self-contained part of the task to a sub-agent and get its result back. It starts with a fresh context (it does not see this conversation), has the same tools, and asks the user before actions that change things. Use it for a large, separable piece of work whose details you don't need to keep in your own context: researching one topic across many pages, exploring an unfamiliar part of the codebase, or a well-defined change in one area. Don't use it for quick lookups or small steps you can do yourself. Write the task so a newcomer can do it: the goal, everything it needs to know, constraints, and what to report back.",
  properties: {
    task: {
      type: 'string',
      description:
        'Complete instructions for the sub-agent: goal, needed context (paths, names, decisions so far), constraints, and exactly what its final answer should contain.',
    },
    label: {
      type: 'string',
      description: `A short name for this sub-task, shown to the user (under ${MAX_LABEL_CHARS} characters), e.g. "Research pricing".`,
    },
  },
  optional: ['label'],
  async run({ task, label }, ctx) {
    if (!ctx.delegate) throw new Error('Sub-agents are turned off. Do this part yourself.');
    const text = task.trim();
    if (!text) throw new Error('Write the task for the sub-agent.');
    const name = (label ?? '').trim().slice(0, MAX_LABEL_CHARS) || DEFAULT_LABEL;
    return ctx.delegate({ task: text, label: name });
  },
});

/** The label a delegate_task call was given, for showing it before it runs. */
export function delegateLabel(args: unknown): string {
  const label = isRecord(args) && typeof args.label === 'string' ? args.label.trim() : '';
  return label.slice(0, MAX_LABEL_CHARS) || DEFAULT_LABEL;
}
