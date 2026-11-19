import { z } from 'zod';
import { ATTACHMENT_LIMITS, SKILL_LIMITS } from './constants.js';
import type { ChatSummary } from './chat.js';
import { REASONING_EFFORTS } from './model.js';
import { skillNameSchema } from './skill.js';
import type { NumberedPlanStep, Plan } from './plan.js';
import type { QuestionAnswer, QuestionOption } from './question.js';

export const RUN_STATUSES = [
  'done',
  'rejected',
  'refused',
  'truncated',
  'budget_exceeded',
  'stopped',
  'error',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export interface Usage {
  /** All input the model read, cached or not. */
  inputTokens: number;
  outputTokens: number;
  /** Of the input: read from the server's prompt cache (billed far lower). */
  cachedInputTokens?: number;
  /** Of the input: written to the prompt cache (a new chat's start; billed a little higher). */
  cacheWriteTokens?: number;
}

/**
 * What a model call was for: a step of the agent loop, the planner deciding whether to plan,
 * summarizing older messages to fit the context window, the summary written at a limit, the
 * reviewer checking the final answer, or any call a sub-agent made (delegate_task).
 */
export const MODEL_CALL_KINDS = [
  'step',
  'planner',
  'compaction',
  'limit_summary',
  'review',
  'subagent',
] as const;

export type ModelCallKind = (typeof MODEL_CALL_KINDS)[number];

/**
 * The parts a model call's tokens went to. Input: the system prompt's sections, the tool
 * definitions, a summary of older messages, the user's messages, context the app added to
 * them (memories, files, notes), the agent's earlier replies and tool calls, tool results,
 * images, and (for a call that isn't a step) its own prompt. Output: reply text, tool calls,
 * and the rest (reasoning and formatting the response doesn't show).
 */
export const TOKEN_GROUPS = [
  'system',
  'tools',
  'summary',
  'user',
  'context',
  'history',
  'results',
  'images',
  'prompt',
  'reply',
  'tool_calls',
  'reasoning',
] as const;

export type TokenGroupId = (typeof TOKEN_GROUPS)[number];

/** One thing inside a group, e.g. one tool's definition or one tool call's result. */
export interface TokenItem {
  label: string;
  tokens: number;
  /** how many of it were sent (a result re-sent on every later step counts each time) */
  count: number;
}

/**
 * Tokens of one part of a call. Counted from the text sent and scaled so a call's parts add
 * up to what the model server reported, so they're estimates; the largest items are listed,
 * the rest summed as "Others".
 */
export interface TokenGroup {
  id: TokenGroupId;
  tokens: number;
  items: TokenItem[];
}

/** One request to the model and its response, for the token usage breakdown. */
export interface ModelCallUsage extends Usage {
  kind: ModelCallKind;
  /** the model the server says answered, null if it didn't say */
  model: string | null;
  /** from sending the request to the end of the response */
  durationMs: number;
  /** the tools the response asked to run, in order (a step only) */
  toolCalls: string[];
  /** what the input tokens went to, largest first (empty if not known) */
  input: TokenGroup[];
  /** what the output tokens went to, largest first (empty if not known) */
  output: TokenGroup[];
  /**
   * The server reported no tokens for this call, so its counts are the parts counted from the
   * text sent, not the server's.
   */
  isEstimated?: boolean;
}

/** The tokens of a call's parts, added up. */
export function groupTokens(groups: readonly TokenGroup[]): number {
  return groups.reduce((sum, group) => sum + group.tokens, 0);
}

/** How one user prompt ended. */
export interface RunResult {
  text: string;
  status: RunStatus;
  /** working steps (model calls that could use tools); `calls` lists every call */
  steps: number;
  toolsUsed: string[];
  usage: Usage;
  /** each model call the request made, in order; `usage` is their sum */
  calls: ModelCallUsage[];
}

/** Live progress the agent reports while it works on one prompt. */
export type AgentEvent =
  | { type: 'planning' }
  | { type: 'route'; mode: 'direct' | 'plan'; reason: string; steps: number }
  | { type: 'model_call'; step: number }
  /** The model started streaming reasoning ("thinking") text: sent once per model call. */
  | { type: 'reasoning' }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: string }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; preview: string }
  | { type: 'plan'; plan: Plan | null }
  | { type: 'check'; unfinished: NumberedPlanStep[] }
  | { type: 'limit'; reason: string }
  /**
   * After each model call: the request's size (input tokens), the model's window, and the size
   * at which older messages get summarized (the point the context meter fills toward).
   */
  | { type: 'context'; usedTokens: number; windowTokens: number; summarizeAtTokens: number }
  /**
   * The run's tokens so far, so they show live. `usage` counts every call made and `steps` the
   * working steps (not the planner or summaries), as `RunResult` does at the end. Servers report a call's tokens only once it ends, so while one
   * streams (planner and summaries too) these come with `isEstimated`: its input counted from
   * the request up front, its output from what has streamed so far (a few times a second).
   * The event after the call ends has the server's counts and no `isEstimated`.
   */
  | { type: 'usage'; steps: number; usage: Usage; isEstimated?: boolean }
  /** Older messages were summarized to stay inside the context window. */
  | { type: 'compaction'; summarizedMessages: number; tokensBefore: number; tokensAfter: number }
  /**
   * A message the user sent during the run (`POST /v1/chats/:id/run/messages`) reached the
   * model: it was added to the conversation before this step. `id` is the one that POST gave.
   */
  | { type: 'steer'; id: string; text: string; sentAt: string }
  /** The reviewer started checking the final answer. */
  | { type: 'reviewing' }
  /** The reviewer's verdict: `revise` sends the issues back to the agent for another pass. */
  | { type: 'review'; verdict: ReviewVerdict; issues: string[] }
  /**
   * Something a sub-agent did, for the delegate_task call `callId` that started it. Its own
   * events, as the agent's; a sub-agent never starts another.
   */
  | { type: 'subagent'; callId: string; event: AgentEvent };

export type ReviewVerdict = 'pass' | 'revise';

/**
 * Everything `POST /v1/runs` streams, one per server-sent event as `data: <json>`.
 * `chat` comes first, then agent events, approval requests and questions, then `done` or
 * `error`.
 */
export type StreamEvent =
  | AgentEvent
  | { type: 'chat'; chat: ChatSummary }
  | {
      type: 'approval';
      id: string;
      tool: string;
      input: unknown;
      /** the sub-agent (delegate_task label) asking, when it isn't the agent itself */
      subagent?: string;
      /** that sub-agent's specialist, e.g. "researcher" */
      specialist?: string;
    }
  | { type: 'approval_closed'; id: string; allowed: boolean }
  /** The agent asks the user (ask_user) and waits; answered with `POST /v1/questions/:id`. */
  | { type: 'question'; id: string; question: string; options: QuestionOption[] }
  /** Answered, skipped (by the user, or because the run stopped or the tab closed). */
  | { type: 'question_closed'; id: string; answer: QuestionAnswer }
  | { type: 'done'; result: RunResult }
  | { type: 'error'; message: string };

export const runRequestSchema = z
  .object({
    workspaceId: z.string().uuid('Pick a workspace.'),
    chatId: z.string().uuid().optional(),
    /** May be empty when files are attached. */
    message: z.string(),
    /** Files uploaded first with POST /v1/workspaces/:id/attachments. */
    attachmentIds: z
      .array(z.string().uuid('Unknown attachment.'))
      .max(
        ATTACHMENT_LIMITS.perMessage,
        `Attach at most ${ATTACHMENT_LIMITS.perMessage} files to one message.`,
      )
      .optional(),
    /** Left out: the default model. */
    modelId: z.string().uuid('Pick a model.').optional(),
    /** Left out: the server's default. Ignored for models without reasoning support. */
    reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
    /**
     * Run tools without asking, for this run only (the composer's Auto-approve). Only matters
     * when approvals are set to ask; never turns on a tool that approvals set to refuse.
     */
    autoApprove: z.boolean().optional(),
    /** Skills the user picked for this message (by name): they come with it in full. */
    skills: z
      .array(skillNameSchema)
      .max(SKILL_LIMITS.perMessage, `Pick at most ${SKILL_LIMITS.perMessage} skills.`)
      .optional(),
  })
  .refine((run) => run.message.trim() !== '' || (run.attachmentIds?.length ?? 0) > 0, {
    message: 'Type a message first.',
    path: ['message'],
  });

export type RunRequest = z.infer<typeof runRequestSchema>;

export const approvalDecisionSchema = z.object({
  allow: z.boolean(),
});

export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

/**
 * `POST /v1/chats/:id/run/messages`: a message for the chat's run in progress. The agent reads
 * it before its next step (a `steer` event says when); text only, no files or skills.
 */
export const steerRequestSchema = z.object({
  message: z.string().refine((text) => text.trim() !== '', 'Type a message first.'),
});

export type SteerRequest = z.infer<typeof steerRequestSchema>;

/** The answer to a `steer` request: the id its `steer` event will carry. */
export interface SteerAccepted {
  id: string;
}

/** `PATCH /v1/chats/:id/run`: turns Auto-approve on or off for the chat's run in progress. */
export const runChangeSchema = z.object({
  autoApprove: z.boolean(),
});

export type RunChange = z.infer<typeof runChangeSchema>;
