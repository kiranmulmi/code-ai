import { z } from 'zod';
import { REASONING_EFFORTS } from './model.js';

/**
 * Quick chat: a plain conversation with a model, outside any workspace. Nothing about it is
 * saved: the browser keeps the messages in memory and sends them all with each new message,
 * so closing the chat ends it for good.
 */
export const QUICK_CHAT_LIMITS = {
  /** messages sent in one request, the new one included */
  maxMessages: 200,
  /** characters in one message */
  maxMessageChars: 100_000,
} as const;

export const quickChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z
    .string()
    .max(
      QUICK_CHAT_LIMITS.maxMessageChars,
      `Keep messages under ${QUICK_CHAT_LIMITS.maxMessageChars} characters.`,
    ),
});

export type QuickChatMessage = z.infer<typeof quickChatMessageSchema>;

/** `POST /v1/quick-chat`: the conversation so far, ending with the user's new message. */
export const quickChatRequestSchema = z.object({
  messages: z
    .array(quickChatMessageSchema)
    .min(1, 'Type a message first.')
    .max(QUICK_CHAT_LIMITS.maxMessages, 'This chat is too long. Close it and start a new one.')
    .refine((messages) => messages[messages.length - 1]?.role === 'user', {
      message: 'The last message must be yours.',
    })
    .refine((messages) => messages[messages.length - 1]?.content.trim() !== '', {
      message: 'Type a message first.',
    }),
  /** Left out: the default model. */
  modelId: z.string().uuid('Pick a model.').optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  /** The web tools (web_search, fetch_page); on unless turned off for this chat. */
  useWeb: z.boolean().default(true),
});

export type QuickChatRequest = z.infer<typeof quickChatRequestSchema>;

/** One server-sent event of `POST /v1/quick-chat`. */
export type QuickChatEvent =
  | { type: 'text_delta'; text: string }
  /** The text streamed so far came before a tool call: drop it, the answer follows. */
  | { type: 'text_reset' }
  /** A web tool started: `name` is web_search or fetch_page, `label` the query or page. */
  | { type: 'tool_start'; id: string; name: string; label: string }
  | { type: 'tool_end'; id: string; ok: boolean }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };
