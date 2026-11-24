import { z } from 'zod';
import { AGENT_SETTING_DEFAULTS, SETTINGS_LIMITS } from './constants.js';
import { APPROVAL_MODES, type ApprovalMode } from './info.js';

export const LOG_LEVELS = ['debug', 'info', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * `off` (the default): no planning step; the agent makes a plan itself (create_plan) when a task
 * has several steps. `auto`: a planning step, one extra model call before each message, decides
 * whether to plan first: steadier with smaller models, but it costs a call on every message.
 */
export const PLANNING_MODES = ['auto', 'off'] as const;
export type PlanningMode = (typeof PLANNING_MODES)[number];

/**
 * When a reviewer (a separate model call that sees only the request, the findings and the
 * answer) checks the agent's final answer before the user gets it. `off`: never. `tasks`: when
 * the agent used tools for the request. `always`: every answer.
 */
export const REVIEW_MODES = ['off', 'tasks', 'always'] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

/**
 * How the agent behaves, app-wide, set in Settings -> Agent. Server options (PORT, ...)
 * stay in .env.
 */
export interface AgentSettings {
  /** auto: a planning step before each request decides whether to plan; off: the agent decides itself. */
  planning: PlanningMode;
  /** Working steps (model calls that can use tools) per user prompt; planner and summary calls don't count. */
  maxSteps: number;
  /** Input + output token budget per user prompt; input read from the server's cache counts at a tenth. */
  maxTotalTokens: number;
  /** Prompts longer than this many characters are rejected. */
  maxInputChars: number;
  /** Tools that change things: ask before each, run without asking, or refuse. */
  approval: ApprovalMode;
  /** The SearXNG instance the web_search tool uses. */
  searxngUrl: string;
  /** What the agent prints to the server's terminal. The JSONL run logs are always written. */
  logLevel: LogLevel;
  /** The agent may hand parts of a task to sub-agents (delegate_task), each with a fresh context. */
  subagents: boolean;
  /** The model sub-agents run on (a saved model's id); null: the chat's model. */
  subagentModelId: string | null;
  /** Sub-agents that may work at the same time; more started in one step wait their turn. */
  maxParallelSubagents: number;
  /** When a reviewer checks the agent's final answer. */
  review: ReviewMode;
  /** The model the reviewer runs on (a saved model's id); null: the chat's model. */
  reviewModelId: string | null;
  /**
   * The model that looks at images for a chat model that can't (a saved model's id); null:
   * none, so such a model can't see images at all.
   */
  visionModelId: string | null;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  planning: 'auto',
  ...AGENT_SETTING_DEFAULTS,
  approval: 'ask',
  searxngUrl: 'http://localhost:8080',
  logLevel: 'info',
  subagents: false,
  subagentModelId: null,
  review: 'tasks',
  reviewModelId: null,
  visionModelId: null,
};

const wholeNumber = (label: string, { min, max }: { min: number; max: number }) =>
  z
    .number({ invalid_type_error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${min.toLocaleString('en')}.`)
    .max(max, `${label} can be at most ${max.toLocaleString('en')}.`);

/** A saved model's id, or null (or empty, from a form) for the chat's own model. */
const optionalModelId = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .pipe(z.string().uuid('Pick a saved model.').nullable())
  .nullable()
  .transform((value) => value ?? null);

export const agentSettingsSchema = z.object({
  planning: z.enum(PLANNING_MODES),
  maxSteps: wholeNumber('Max steps', SETTINGS_LIMITS.maxSteps),
  maxTotalTokens: wholeNumber('The token budget', SETTINGS_LIMITS.maxTotalTokens),
  maxInputChars: wholeNumber('The prompt limit', SETTINGS_LIMITS.maxInputChars),
  approval: z.enum(APPROVAL_MODES),
  searxngUrl: z
    .string()
    .trim()
    .max(SETTINGS_LIMITS.searxngUrl, `Keep the URL under ${SETTINGS_LIMITS.searxngUrl} characters.`)
    .regex(/^https?:\/\/[^\s]+$/i, 'Use an http:// or https:// URL, like http://localhost:8080.')
    .transform((value) => value.replace(/\/+$/, '')),
  logLevel: z.enum(LOG_LEVELS),
  subagents: z.boolean(),
  subagentModelId: optionalModelId,
  maxParallelSubagents: wholeNumber('Parallel sub-agents', SETTINGS_LIMITS.maxParallelSubagents),
  review: z.enum(REVIEW_MODES),
  reviewModelId: optionalModelId,
  visionModelId: optionalModelId,
});

export type AgentSettingsInput = z.input<typeof agentSettingsSchema>;

/**
 * Saved settings, read leniently: a missing or invalid value (an older row, a hand edit)
 * falls back to its default instead of stopping the app.
 */
export function readAgentSettings(raw: unknown): AgentSettings {
  const stored = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const { shape } = agentSettingsSchema;
  const field = <K extends keyof AgentSettings>(key: K): AgentSettings[K] => {
    const parsed = shape[key].safeParse(stored[key]);
    return parsed.success ? (parsed.data as AgentSettings[K]) : DEFAULT_AGENT_SETTINGS[key];
  };
  return {
    planning: field('planning'),
    maxSteps: field('maxSteps'),
    maxTotalTokens: field('maxTotalTokens'),
    maxInputChars: field('maxInputChars'),
    approval: field('approval'),
    searxngUrl: field('searxngUrl'),
    logLevel: field('logLevel'),
    subagents: field('subagents'),
    subagentModelId: field('subagentModelId'),
    maxParallelSubagents: field('maxParallelSubagents'),
    review: field('review'),
    reviewModelId: field('reviewModelId'),
    visionModelId: field('visionModelId'),
  };
}
