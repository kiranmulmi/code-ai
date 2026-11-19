// The one place that talks to the model. It uses the OpenAI Chat Completions
// API, which OpenAI and many other servers speak (Ollama, OpenRouter, Groq,
// LM Studio, vLLM, Together, DeepSeek, ...). Models are set up in the app's
// Settings -> Models and passed in per run as ModelSettings.
import OpenAI from 'openai';
import type {
  ChatCompletionContentPart,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import type { ReasoningEffort } from 'openai/resources/shared';
import type { Usage } from '@app/shared';
import { StoppedError, isRecord } from './errors.js';
import type { ModelMessage, ToolCall } from './memory/short-term.js';
import type { ToolDefinition } from './tools/define.js';

/** Which model one run talks to, and how. */
export interface ModelSettings {
  /** What the app calls the model, used in error messages. */
  label: string;
  /** Who serves it: any OpenAI-compatible server. */
  provider?: 'openai';
  /** Any OpenAI-compatible server. Undefined means api.openai.com. */
  baseURL?: string;
  apiKey: string;
  /** The model name exactly as the server lists it. */
  model: string;
  /** null = let the server decide */
  maxTokens: number | null;
  /** input + output tokens the model takes in one request; null = DEFAULT_CONTEXT_WINDOW */
  contextWindow: number | null;
  /** only for reasoning models that support it; null = the server's default */
  reasoningEffort: string | null;
}

export interface ModelRequest {
  system: string;
  messages: ModelMessage[];
  tools?: ToolDefinition[];
  /** Data URLs of the images user messages refer to (`images`), by attachment id. */
  images?: ReadonlyMap<string, string>;
  /** Called with each piece of text as it streams in. */
  onText?: (delta: string) => void;
  /**
   * Called with each piece of output as it streams in, shown or not (text, refusal, tool calls,
   * reasoning), so the caller can count the call's tokens before the server reports them.
   */
  onOutput?: (piece: string) => void;
  /** Called with each piece of reasoning ("thinking") text, for servers that stream it. */
  onReasoning?: (piece: string) => void;
  /** Cancels the call (the user stopped the run). */
  signal?: AbortSignal;
  /**
   * The same for every call of one chat (its id); the Chat Completions call doesn't use it.
   */
  conversationId?: string;
}

/** The complete assistant turn: text plus any tool calls. */
export interface ModelReply {
  role: 'assistant';
  content: string | null;
  refusal?: string | null;
  tool_calls?: ToolCall[];
}

export interface ModelResponse {
  message: ModelReply;
  finishReason: string;
  usage: Usage;
  model: string;
}

/**
 * One model turn, streamed. Text is passed to `onText` as it arrives; the
 * returned message is the complete turn (text plus any tool calls).
 */
export type CallModel = (req: ModelRequest) => Promise<ModelResponse>;

export function createModelCaller(config: ModelSettings): CallModel {
  let client: OpenAI | undefined;
  function getClient(): OpenAI {
    // Local servers (Ollama, LM Studio) don't check the key, but the SDK needs a value.
    client ??= new OpenAI({ apiKey: config.apiKey || 'not-set', baseURL: config.baseURL });
    return client;
  }

  return async function callModel({
    system,
    messages,
    tools = [],
    images,
    onText,
    onOutput,
    onReasoning,
    signal,
  }) {
    if (!config.model) {
      throw new Error(`"${config.label}" has no model name. Set one in Settings → Models.`);
    }

    const params: ChatCompletionCreateParamsStreaming = {
      model: config.model,
      messages: [
        { role: 'system', content: system },
        ...messages.map((m) => toApiMessage(m, images)),
      ],
      stream: true,
      stream_options: { include_usage: true }, // token counts arrive in the last chunk
    };
    // Some servers reject an empty tools list, so only send tools when there are some.
    if (tools.length) {
      params.tools = tools;
      params.tool_choice = 'auto';
    }
    // Optional: only sent when set, because not every server accepts them.
    if (config.maxTokens) params.max_tokens = config.maxTokens;
    // Passed through as written: servers accept different values than OpenAI's list.
    if (config.reasoningEffort) params.reasoning_effort = config.reasoningEffort as ReasoningEffort;

    // Set fresh on each attempt below; a retry starts over.
    let content: string;
    let refusal: string | null;
    let pieces: (ToolCall | undefined)[];
    let finishReason: string | null;
    let usage: unknown;
    let model = config.model;

    for (let attempt = 0; ; attempt++) {
      content = '';
      refusal = null;
      pieces = [];
      finishReason = null;
      usage = null;
      let streamed = false; // once output reached the caller, a retry would repeat it
      const output = (piece: string) => {
        streamed = true;
        onOutput?.(piece);
      };
      try {
        const stream = await getClient().chat.completions.create(params, { signal });
        for await (const chunk of stream) {
          if (chunk.model) model = chunk.model;
          if (chunk.usage) usage = chunk.usage;
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta ?? {};

          if (delta.content) {
            content += delta.content;
            streamed = true;
            onText?.(delta.content);
            output(delta.content);
          }
          if (delta.refusal) {
            refusal = (refusal ?? '') + delta.refusal;
            output(delta.refusal);
          }
          // Not in OpenAI's types: the reasoning text some servers stream (DeepSeek, vLLM, Ollama,
          // OpenRouter). Not kept, only counted.
          const reasoning = reasoningPiece(delta);
          if (reasoning) {
            output(reasoning);
            streamed = true;
            onReasoning?.(reasoning);
          }

          // Tool calls arrive in pieces: the first piece has the id and name, later
          // pieces add to the arguments string. `index` says which call a piece is for.
          for (const piece of delta.tool_calls ?? []) {
            const i = piece.index ?? pieces.length;
            const call = (pieces[i] ??= {
              id: '',
              type: 'function',
              function: { name: '', arguments: '' },
            });
            if (piece.id) call.id = piece.id;
            if (piece.function?.name && !call.function.name) {
              call.function.name = piece.function.name;
              output(piece.function.name);
            }
            if (piece.function?.arguments) {
              call.function.arguments += piece.function.arguments;
              output(piece.function.arguments);
            }
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
        break;
      } catch (error) {
        if (signal?.aborted) throw new StoppedError();
        if (!streamed && attempt < STREAM_RETRIES && isStreamError(error)) {
          await wait(STREAM_RETRY_DELAY_MS * (attempt + 1), signal);
          continue;
        }
        throw describeApiError(
          error,
          config,
          messages.some((m) => m.role === 'user' && Boolean(m.images?.length)),
        );
      }
    }

    // Some servers leave ids empty; every call needs one to match its result.
    const toolCalls = pieces
      .filter((call): call is ToolCall => Boolean(call))
      .map((call, i) => ({ ...call, id: call.id || `call_${Date.now()}_${i}` }));

    return {
      message: { role: 'assistant', content, refusal, tool_calls: toolCalls },
      finishReason: finishReason ?? 'stop',
      model,
      usage: readUsage(usage),
    };
  };
}

/** A streamed piece of reasoning text, under the field names servers use for it, or ''. */
function reasoningPiece(delta: unknown): string {
  if (!isRecord(delta)) return '';
  const piece = delta.reasoning_content ?? delta.reasoning;
  return typeof piece === 'string' ? piece : '';
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * Token counts from a reply's `usage`, prompt caching included. Servers report the cache in
 * different fields (OpenAI's `prompt_tokens_details.cached_tokens`, Anthropic-style
 * `cache_read_input_tokens` / `cache_creation_input_tokens`), and some leave cache writes out
 * of `prompt_tokens` while counting cache reads in it. `inputTokens` is always the whole input.
 */
export function readUsage(raw: unknown): Usage {
  if (!isRecord(raw)) return { inputTokens: 0, outputTokens: 0 };
  const details = isRecord(raw.prompt_tokens_details) ? raw.prompt_tokens_details : {};
  const prompt = count(raw.prompt_tokens);
  const read = count(raw.cache_read_input_tokens) || count(details.cached_tokens);
  const write = count(raw.cache_creation_input_tokens);
  // prompt_tokens can't be smaller than what it includes: if it is, the writes are outside it.
  const input = prompt >= read + write ? prompt : prompt + write;
  return {
    inputTokens: input,
    outputTokens: count(raw.completion_tokens),
    ...(read ? { cachedInputTokens: read } : {}),
    ...(write ? { cacheWriteTokens: write } : {}),
  };
}

/**
 * A stored message as the API takes it: a user message that refers to images gets them as
 * image parts after its text; the `images` field itself is never sent.
 */
function toApiMessage(
  message: ModelMessage,
  images: ReadonlyMap<string, string> = new Map(),
): ChatCompletionMessageParam {
  if (message.role !== 'user') return message;
  const { images: ids = [], content } = message;
  const urls = ids.flatMap((id) => images.get(id) ?? []);
  if (!urls.length) return { role: 'user', content };
  const parts: ChatCompletionContentPart[] = [
    { type: 'text', text: content },
    ...urls.map((url): ChatCompletionContentPart => ({ type: 'image_url', image_url: { url } })),
  ];
  return { role: 'user', content: parts };
}

/** Retries of an error sent inside the stream, before any output (the SDK retries the rest). */
const STREAM_RETRIES = 2;
const STREAM_RETRY_DELAY_MS = 250;

/**
 * An error the server sent inside an open stream (an `error` event, no HTTP status), or a
 * dropped stream. HTTP errors were already retried by the SDK; client errors aren't worth it.
 */
function isStreamError(error: unknown): boolean {
  if (error instanceof OpenAI.APIUserAbortError) return false;
  if (error instanceof OpenAI.APIConnectionError) return true;
  return error instanceof OpenAI.APIError && error.status === undefined;
}

/** Waits `ms`, or stops early (StoppedError) when the run is stopped. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new StoppedError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new StoppedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function describeApiError(error: unknown, config: ModelSettings, hasImages: boolean): unknown {
  const where = config.baseURL || 'https://api.openai.com/v1';
  if (error instanceof OpenAI.AuthenticationError) {
    return new Error(
      `Authentication failed at ${where}: check the API key of "${config.label}" in Settings → Models.`,
      { cause: error },
    );
  }
  if (error instanceof OpenAI.NotFoundError) {
    return new Error(
      `Not found at ${where}: check the model name ("${config.model}") and server URL of "${config.label}" in Settings → Models. ${error.message}`,
      { cause: error },
    );
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new Error(
      'Rate limited by the model server even after retries. Wait a bit and try again.',
      { cause: error },
    );
  }
  if (error instanceof OpenAI.BadRequestError) {
    const hint = hasImages
      ? ` If "${config.label}" can't read images, switch to a vision model for this chat.`
      : '';
    return new Error(`The model server rejected the request: ${error.message}${hint}`, {
      cause: error,
    });
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new Error(`Could not reach ${where}. Is the server running and the URL right?`, {
      cause: error,
    });
  }
  if (error instanceof OpenAI.APIError) {
    // Errors sent inside the stream have no status: leave it out rather than say "undefined".
    const status = error.status === undefined ? '' : ` ${error.status}`;
    return new Error(`Model server error${status}: ${error.message}`, { cause: error });
  }
  return error;
}
