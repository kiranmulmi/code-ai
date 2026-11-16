import { defineTool } from './define.js';
import { STEP_STATUSES } from '../planner.js';

export const createPlan = defineTool<{ goal: string; steps: string[]; done_when: string }>({
  name: 'create_plan',
  description:
    "Write a step-by-step plan for a task with several distinct steps, or re-plan when the approach changes (it replaces the current plan). Not for simple questions, and not again if this request's plan is already at the start of your turn.",
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
    "Mark a plan step's progress, with a short note. When finishing a step, set next_step to the one you start, so one call does both. Call it alongside other tool calls when you can.",
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
    'Add steps to the end of the current plan when you discover more work. Existing steps and progress are kept.',
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
