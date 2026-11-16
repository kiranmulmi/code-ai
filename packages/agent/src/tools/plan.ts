import { defineTool } from './define.js';
import { STEP_STATUSES } from '../planner.js';

export const createPlan = defineTool<{ goal: string; steps: string[]; done_when: string }>({
  name: 'create_plan',
  description:
    "Write a step-by-step plan for a task with several distinct steps: before you start it, or to re-plan when what you've learned changes the approach (it replaces the current plan). If a plan for this request is already at the start of your turn, don't make another unless you are re-planning. Don't use it for simple questions.",
  properties: {
    goal: { type: 'string', description: 'What the finished task achieves, in one sentence.' },
    steps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ordered, concrete steps (usually 2-8).',
    },
    done_when: {
      type: 'string',
      description: 'A concrete test for when the whole task is complete, or "" if obvious.',
    },
  },
  async run({ goal, steps, done_when }, ctx) {
    return ctx.planner.create(goal, steps, done_when);
  },
});

export const updatePlan = defineTool<{
  step_number: number;
  status: string;
  note: string;
  next_step?: number;
}>({
  name: 'update_plan',
  description:
    "Mark a plan step's progress: in_progress when you start the first step, then done (or skipped or failed) when you finish one, with a short note on the result. When finishing a step, give the step you start next as next_step, so one call does both. Call it in the same turn as other tool calls when you can.",
  properties: {
    step_number: { type: 'integer', description: '1-based step number from the plan.' },
    status: { type: 'string', enum: STEP_STATUSES },
    note: { type: 'string', description: 'Short result or reason, or "" for none.' },
    next_step: {
      type: 'integer',
      description: 'The step you start now (marked in_progress). Leave out when none is left.',
    },
  },
  optional: ['next_step'],
  async run({ step_number, status, note, next_step }, ctx) {
    return ctx.planner.update(step_number, status, note, next_step);
  },
});

export const addPlanSteps = defineTool<{ steps: string[] }>({
  name: 'add_plan_steps',
  description:
    'Add steps to the end of the current plan when you discover more work, for example a sub-company whose own subsidiaries still need looking up. Keeps the existing steps and their progress.',
  properties: {
    steps: {
      type: 'array',
      items: { type: 'string' },
      description: 'New concrete steps, in order.',
    },
  },
  async run({ steps }, ctx) {
    return ctx.planner.addSteps(steps);
  },
});
