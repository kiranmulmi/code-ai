import { z } from 'zod';
import { CONTEXT, LIMITS } from './constants.js';

/**
 * The context window the agent assumes for a model that doesn't say (most current models take
 * at least this many tokens of input and output together).
 */
export const DEFAULT_CONTEXT_WINDOW = CONTEXT.defaultContextWindow;

/** How hard a reasoning model thinks before answering, chosen per message. */
export const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Who serves a model: `openai` is any server that speaks the OpenAI API (base URL and key). */
export const MODEL_PROVIDERS = ['openai'] as const;

export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

/**
 * What a model is for: `chat` runs the agent (the composer's picker, sub-agents, the reviewer),
 * `voice` is a speech server for workspace voice settings, `image` looks at images for chat
 * models that can't (Settings → Agent → Image model).
 */
export const MODEL_CATEGORIES = ['chat', 'voice', 'image'] as const;

export type ModelCategory = (typeof MODEL_CATEGORIES)[number];

/**
 * A model the agent can run on, set up once for the whole app (not per workspace).
 * The API key never leaves the server: the UI only learns whether one is saved.
 */
export interface ModelProfile {
  id: string;
  /** What the UI calls it, e.g. "GPT-4.1 (OpenAI)". */
  name: string;
  /** The model name exactly as the server lists it, e.g. "gpt-4.1". */
  model: string;
  provider: ModelProvider;
  /** What the model is for; groups the Models page and filters the pickers. */
  category: ModelCategory;
  /** Any OpenAI-compatible server. Null means api.openai.com. */
  baseUrl: string | null;
  hasApiKey: boolean;
  /** Null lets the server decide. */
  maxTokens: number | null;
  /**
   * How many tokens the model takes in one request, input and output together. The agent
   * keeps each request inside it and summarizes older messages as a chat nears it. Null:
   * DEFAULT_CONTEXT_WINDOW.
   */
  contextWindow: number | null;
  /** Whether the composer offers a reasoning effort for this model. */
  supportsReasoning: boolean;
  /**
   * Whether the model can read images. When it can't, images are never sent to it: view_image
   * has the image model (Settings → Agent) describe them instead.
   */
  supportsImages: boolean;
  /**
   * Used when no model is chosen, e.g. by the CLI. Exactly one chat model is the default
   * (voice and image models never are).
   */
  isDefault: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

const name = z
  .string()
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'Give the model a name.')
      .max(LIMITS.modelName, `Keep the name under ${LIMITS.modelName} characters.`),
  );

const modelId = z
  .string()
  .trim()
  .min(1, 'Enter the model name as the server lists it.')
  .max(LIMITS.modelId, `Keep the model name under ${LIMITS.modelId} characters.`);

/** Empty or null means api.openai.com. Null is accepted so parsed input parses again the same. */
const baseUrl = z
  .string()
  .trim()
  .max(LIMITS.modelUrl, `Keep the URL under ${LIMITS.modelUrl} characters.`)
  .refine((value) => value === '' || /^https?:\/\/[^\s]+$/i.test(value), {
    message: 'Use an http:// or https:// URL, like http://localhost:11434/v1.',
  })
  .transform((value) => (value === '' ? null : value.replace(/\/+$/, '')))
  .nullable();

const apiKey = z
  .string()
  .trim()
  .max(LIMITS.apiKey, `Keep the API key under ${LIMITS.apiKey} characters.`);

const maxTokens = z
  .number({ invalid_type_error: 'Max tokens must be a whole number.' })
  .int('Max tokens must be a whole number.')
  .positive('Max tokens must be more than 0.')
  .max(10_000_000, 'Max tokens is too large.')
  .nullable();

const contextWindow = z
  .number({ invalid_type_error: 'The context window must be a whole number of tokens.' })
  .int('The context window must be a whole number of tokens.')
  .min(2_000, 'The context window must be at least 2,000 tokens.')
  .max(20_000_000, 'The context window is too large.')
  .nullable();

export const modelInputSchema = z.object({
  name,
  model: modelId,
  provider: z.enum(MODEL_PROVIDERS).default('openai'),
  category: z.enum(MODEL_CATEGORIES).default('chat'),
  baseUrl: baseUrl.default(null),
  /** Empty or left out: no key (local servers like Ollama don't need one). */
  apiKey: apiKey.default(''),
  maxTokens: maxTokens.default(null),
  contextWindow: contextWindow.default(null),
  supportsReasoning: z.boolean().default(false),
  supportsImages: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

/**
 * Like the input, but a left-out `apiKey` keeps the saved one (an empty one removes it), and a
 * left-out `provider` or `category` keeps the model's.
 */
export const modelUpdateSchema = modelInputSchema.extend({
  apiKey: apiKey.optional(),
  provider: z.enum(MODEL_PROVIDERS).optional(),
  category: z.enum(MODEL_CATEGORIES).optional(),
});

export type ModelInput = z.input<typeof modelInputSchema>;
export type ModelUpdate = z.input<typeof modelUpdateSchema>;
