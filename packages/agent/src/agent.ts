// The agent loop.
//
//   1. Plan:    a planning step decides "answer directly" or writes a plan.
//   2. Act:     the model works in a loop - call tools, read results, decide again,
//               updating the plan as it goes.
//   3. Check:   before accepting a final answer, open plan steps are sent back
//               to the model once to finish or explain; then, if review is on, a
//               reviewer (critic.ts) checks the answer and can send issues back once.
//   4. Limit:   if the step or token budget runs out, one last tool-free call
//               writes up what was found instead of stopping empty-handed.
//
// Every model call is kept inside the model's context window (context.ts): near it, older
// messages are summarized; past it, the oldest tool results are shortened for that call.
import {
  CONTEXT,
  TOKEN_USAGE,
  DEFAULT_CONTEXT_WINDOW,
  groupTokens,
  toolResultPreview,
  type AgentEvent,
  type Attachment,
  type ModelCallKind,
  type ReviewMode,
  type RunResult,
  type RunStatus,
  type Skill,
  type ToolGroup,
} from '@app/shared';
import { imageDataUrl, type AttachmentStore } from './attachments.js';
import type { SkillStore } from './skills.js';
import { loadAgentConfig, type AgentConfig } from './config.js';
import { StoppedError } from './errors.js';
import { createModelCaller, type CallModel, type ModelRequest, type ModelSettings } from './llm.js';
import {
  systemPromptSections,
  buildPlannerPrompt,
  planCheckMessage,
  LIMIT_SUMMARY_PROMPT,
  attachmentContext,
  pickedSkillsContext,
  renderSkills,
  imagesShownMessage,
  memoryContext,
  steeringMessage,
  COMPACTION_PROMPT,
  summaryMessage,
} from './prompt.js';
import {
  inputBreakdown,
  outputBreakdown,
  type MessageInfo,
  type StepParts,
} from './usage-breakdown.js';
import {
  CHARS_PER_TOKEN,
  compactThreshold,
  HARD_LIMIT,
  ContextMeter,
  compactionCut,
  contextBudget,
  contextLimits,
  keepRecentTokens,
  shrinkToolResults,
  transcriptChunks,
} from './context.js';
import { withoutReason, type ToolDefinition } from './tools/define.js';
import { ATTACHMENT_TOOLS, DELEGATE_TOOL, SKILL_TOOLS, buildToolset } from './tools/index.js';
import { Board } from './team/board.js';
import {
  BUILT_IN_SPECIALISTS,
  GENERAL_SPECIALIST,
  specialistMap,
  specialistOffGroups,
  type Specialist,
} from './team/specialists.js';
import type { AnyTool, AskUserFn, DelegatedTask, ToolContext } from './tools/define.js';
import { REVIEW_PROMPT, parseReview, reviewMessage, reviseMessage, type Review } from './critic.js';
import type { WorkspaceTasks } from './background-tasks.js';
import { Planner, decide } from './planner.js';
import { Conversation, type ModelMessage, type ToolCall } from './memory/short-term.js';
import { renderMemories, type MemoryStore } from './memory/long-term.js';
import {
  Budget,
  checkInput,
  createApprover,
  limitToolOutput,
  redactSecrets,
  type ApprovalSource,
  type ApproveFn,
  type AskFn,
} from './guardrails.js';
import { createLogger, type AgentLogger } from './logger.js';
import { errorMessage, isRecord } from './errors.js';
import { oneAtATime } from './one-at-a-time.js';

export type { ApprovalSource, ApproveFn, AskFn };

/** A message the user sent while the agent worked (see `SteeringInbox`). */
export interface SteeringMessage {
  id: string;
  text: string;
  /** when the user sent it (ISO) */
  sentAt: string;
}

/**
 * Where messages the user sends during a run wait for the agent. It takes them before each
 * model call (after the step's tool results) and before it accepts a final answer.
 */
export interface SteeringInbox {
  /** The messages waiting, oldest first; each is handed out once. */
  take(): SteeringMessage[];
}

/** How the agent talks to the model, the human and the logs: the same for every chat. */
export interface AgentRunOptions {
  /** overrides for loadAgentConfig(process.env) values */
  config?: Partial<AgentConfig>;
  /** how to ask the human for tool approval */
  ask?: AskFn;
  /** replaces `ask` + config.approval */
  approve?: ApproveFn;
  /** asks the user a question mid-run (ask_user); without it the tool tells the model to ask in its reply */
  askUser?: AskUserFn;
  /**
   * live progress for a UI:
   * planning, route, model_call, text_delta, tool_call, tool_result, plan, check, limit
   */
  onEvent?: (event: AgentEvent) => void;
  /** aborted when the user stops the run: the model call is cancelled, tools stop early */
  signal?: AbortSignal;
  /** messages the user sends while the run works; without it a run reads none */
  steering?: SteeringInbox;
  /** the model this run talks to (from the app's model settings) */
  model?: ModelSettings;
  /** replaces the API call and `model` (used by tests) */
  callModel?: CallModel;
  /** the model sub-agents (delegate_task) run on; without it, the run's own model */
  subagentModel?: ModelSettings;
  /** replaces the sub-agents' API call (tests) */
  subagentCallModel?: CallModel;
  /** the model the reviewer runs on; without it, the run's own model */
  reviewModel?: ModelSettings;
  /** replaces the reviewer's API call (tests) */
  reviewCallModel?: CallModel;
  /** the context window when `model` doesn't give one (tests); else DEFAULT_CONTEXT_WINDOW */
  contextWindow?: number;
  logger?: AgentLogger;
}

/**
 * One chat's state and workspace. The app loads these from the workspace folder for each
 * request (see runInChat in @app/db); without a conversation the chat starts empty.
 */
export interface AgentOptions extends AgentRunOptions {
  conversation?: Conversation;
  /** the chat's id, sent with every model call as its `conversationId` */
  chatId?: string;
  planner?: Planner;
  /** the memory list the model last saw in this chat */
  memoryShown?: string | null;
  /** the workspace's memory store */
  longTermMemory: MemoryStore;
  /** the workspace folder: the only place the file tools may use */
  filesDir: string;
  /** the workspace's instructions, added to the system prompt */
  instructions?: string;
  /** the user talks by voice and hears the replies: ask for short, speakable answers */
  voiceReplies?: boolean;
  /** tools beyond the built-in ones, e.g. from the workspace's MCP servers (McpHub) */
  extraTools?: readonly AnyTool[];
  /** the files users attached in this workspace's chats (read by the attachment tools) */
  attachments?: AttachmentStore;
  /** the workspace's skills: listed in the system prompt, loaded with use_skill */
  skills?: SkillStore;
  /** tool groups the workspace turned off: not sent, and refused if called */
  disabledTools?: readonly ToolGroup[];
  /** the workspace's background tasks (BackgroundTasks.forWorkspace); without it commands can't run in the background */
  tasks?: WorkspaceTasks;
  /** set for a sub-agent (delegate_task): its prompt says it reports to another agent */
  role?: 'agent' | 'subagent';
  /**
   * the specialists delegate_task offers (team/specialists.ts); later ones replace built-ins
   * with the same name. Without it, the built-in ones.
   */
  specialists?: readonly Specialist[];
  /** a sub-agent's team: the request's shared notes, who it posts as, and its specialist */
  team?: { board: Board; author: string; specialist: Specialist };
}

/** What comes with one user prompt besides its text. */
export interface RunInput {
  /** files the user attached to this message (already in `attachments`) */
  attachments?: readonly Attachment[];
  /** skills the user picked for this message: they come with it in full */
  skills?: readonly Skill[];
}

export interface Agent {
  /** Handle one user prompt end to end. */
  run(prompt: string, input?: RunInput): Promise<RunResult>;
  planner: Planner;
  conversation: Conversation;
  longTermMemory: MemoryStore;
  readonly memoryShown: string | null;
  logFile: string | null;
  reset(): void;
}

function modelCallerFor({ callModel, model }: AgentRunOptions): CallModel {
  if (callModel) return callModel;
  if (model) return createModelCaller(model);
  throw new Error('No model chosen. Add one in Settings → Models.');
}

export function createAgent(options: AgentOptions): Agent {
  const config: AgentConfig = { ...loadAgentConfig(process.env), ...options.config };
  const { signal, chatId } = options;
  const baseCallModel = modelCallerFor(options);
  // Every model call carries the stop signal and the chat's id, and none starts once the run is
  // stopped.
  const callModel: CallModel = (request) => {
    if (signal?.aborted) return Promise.reject(new StoppedError());
    return baseCallModel({ ...request, signal, ...(chatId ? { conversationId: chatId } : {}) });
  };
  /** The reviewer's calls: its own model when one is set, with the same stop signal. */
  const reviewBase =
    options.reviewCallModel ??
    (options.reviewModel ? createModelCaller(options.reviewModel) : baseCallModel);
  const callReviewer: CallModel = (request) => {
    if (signal?.aborted) return Promise.reject(new StoppedError());
    return reviewBase({ ...request, signal });
  };
  const isStopped = () => signal?.aborted === true;
  const isSubagent = options.role === 'subagent';
  const emit = options.onEvent ?? (() => {});
  /** For one model call: reports, once, that the model began reasoning. */
  const reasoningOnce = () => {
    let reported = false;
    return () => {
      if (reported) return;
      reported = true;
      emit({ type: 'reasoning' });
    };
  };
  /**
   * One model call for a request: timed, and its tokens recorded on the request's budget with
   * what they went to (`step` names a step's parts).
   */
  const callRecorded = async (
    budget: Budget,
    kind: ModelCallKind,
    request: ModelRequest,
    step?: StepParts,
    caller: CallModel = callModel,
  ) => {
    const startedAt = Date.now();
    // The server reports the call's tokens only once it ends. Until then the run's tokens show
    // with an estimate for it: the request's size up front, then its output as it streams.
    const estimatedInput = groupTokens(inputBreakdown(request, 0, step));
    let outputCharacters = 0;
    let lastLiveAt = 0;
    const emitLive = () => {
      lastLiveAt = Date.now();
      const sofar = budget.usage();
      emit({
        type: 'usage',
        // Only a working step counts as one; the planner and summaries don't.
        steps: budget.steps + (kind === 'step' ? 1 : 0),
        usage: {
          ...sofar,
          inputTokens: sofar.inputTokens + estimatedInput,
          outputTokens: sofar.outputTokens + Math.ceil(outputCharacters / CHARS_PER_TOKEN),
        },
        isEstimated: true,
      });
    };
    emitLive();
    const response = await caller({
      ...request,
      onOutput: (piece) => {
        outputCharacters += piece.length;
        if (Date.now() - lastLiveAt >= LIVE_USAGE_INTERVAL_MS) emitLive();
      },
    });
    const { usage, message } = response;
    const input = inputBreakdown(request, usage.inputTokens, step);
    const output = outputBreakdown(message, usage.outputTokens);
    // A call the server reported nothing for (some servers send no usage) still sent its
    // tokens: count them from the text (the unscaled parts), so the run's totals and token
    // budget include them.
    const isEstimated = usage.inputTokens === 0 && usage.outputTokens === 0;
    budget.recordCall(
      isEstimated ? { inputTokens: groupTokens(input), outputTokens: groupTokens(output) } : usage,
      {
        kind,
        model: response.model || null,
        durationMs: Date.now() - startedAt,
        toolCalls: message.tool_calls?.map((call) => call.function.name) ?? [],
        input,
        output,
        ...(isEstimated ? { isEstimated } : {}),
      },
    );
    emit({ type: 'usage', steps: budget.steps, usage: budget.usage() });
    return response;
  };
  const contextWindow = contextBudget(
    options.model?.contextWindow ?? options.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    options.model?.maxTokens ?? null,
  );
  const limits = contextLimits(contextWindow);
  const meter = new ContextMeter();
  const logger = options.logger ?? createLogger({ level: config.logLevel, logDir: config.logDir });
  const approve = options.approve ?? createApprover(config.approval, options.ask);
  // ask_user: sub-agents working at the same time take turns asking, since the user answers one
  // question at a time. A sub-agent is given its parent's queue, so it doesn't add its own.
  const askUser = ((ask: AskUserFn | undefined): AskUserFn | null => {
    if (!ask) return null;
    if (isSubagent) return ask;
    const queue = oneAtATime();
    return (question) => queue(() => ask(question));
  })(options.askUser);

  // A sub-agent never gets delegate_task: no sub-agents of sub-agents.
  const canDelegate = config.subagents && !isSubagent;
  const specialists = [
    ...specialistMap([...BUILT_IN_SPECIALISTS, ...(options.specialists ?? [])]).values(),
  ];
  const specialistsByName = specialistMap(specialists);
  const team = options.team ?? null;
  const specialist = team?.specialist ?? null;
  // A specialist only gets its own tool groups (and never one the workspace turned off).
  const disabledTools = specialist
    ? specialistOffGroups(specialist, options.disabledTools ?? [])
    : (options.disabledTools ?? []);
  const toolset = buildToolset(options.extraTools, disabledTools, {
    subagents: canDelegate,
    notes: canDelegate || team !== null,
    readOnly: specialist?.readOnly ?? false,
    specialists,
  });
  const teamSection = canDelegate ? ('lead' as const) : specialist;
  const plannerPrompt = buildPlannerPrompt(toolset.summary);
  const instructions = options.instructions ?? '';
  const { filesDir, longTermMemory } = options;
  const skillStore = options.skills ?? null;
  // Tools sent only when needed: MCP tools the model loaded (load_mcp_tools), the attachment
  // and skill tools when this request has use for them, and tools the chat already called.
  const activeTools = new Set<string>();
  const loadTools = (names: readonly string[]) => {
    const result = { loaded: [] as string[], already: [] as string[], unknown: [] as string[] };
    for (const name of names) {
      const matches = name.endsWith('*')
        ? [...toolset.deferred].filter((tool) => tool.startsWith(name.slice(0, -1)))
        : toolset.deferred.has(name)
          ? [name]
          : [];
      if (!matches.length) result.unknown.push(name);
      for (const tool of matches) {
        if (activeTools.has(tool)) result.already.push(tool);
        else {
          activeTools.add(tool);
          result.loaded.push(tool);
        }
      }
    }
    return result;
  };
  // Rebuilt at the start of each run with the workspace's skills as they are then.
  const voiceReplies = options.voiceReplies ?? false;
  // Without the planning step the model is told to make its own plans.
  const hasPlanningStep = config.planning === 'auto';
  // Kept in its sections too, for the token usage breakdown.
  let systemSections = systemPromptSections(
    instructions,
    filesDir,
    '',
    toolset.deferredSummary,
    disabledTools,
    { voiceReplies, hasPlanningStep, isSubagent, team: teamSection },
  );
  let systemPrompt = systemSections.map((section) => section.text).join('');
  let skillList = '';
  const conversation = options.conversation ?? new Conversation();
  const planner = options.planner ?? new Planner();
  const attachmentStore = options.attachments ?? null;
  // Images the model asked to see (view_image) in the current batch of tool calls.
  let imagesToShow: string[] = [];
  const toolContext: ToolContext = {
    planner,
    longTermMemory,
    workspace: filesDir,
    searxngUrl: config.searxngUrl,
    attachments: attachmentStore,
    skills: skillStore,
    tasks: options.tasks ?? null,
    askUser,
    loadTools: toolset.deferred.size ? loadTools : null,
    signal,
    showImage: (id) => {
      if (!imagesToShow.includes(id)) imagesToShow.push(id);
    },
  };
  /** The budget of the run in progress, for delegate_task. */
  let currentBudget: Budget | null = null;
  /** The team notes of the request in progress (a sub-agent uses its parent's). */
  let board: Board | null = team?.board ?? null;
  /** Sub-agents running now, and those waiting for a slot (maxParallelSubagents). */
  let subagentsRunning = 0;
  const subagentQueue: (() => void)[] = [];
  /** Sub-agents in the current batch of delegate_task calls: they split the tokens left. */
  let delegateBatchSize = 1;
  // Data URLs of the images in the conversation, loaded once per request.
  const imageUrls = new Map<string, string>();
  const missingImages = new Set<string>();

  // The memory list the model has seen in this conversation (null: not loaded yet).
  // Lets a run tell whether memories changed outside the chat, e.g. in the Memory panel.
  let memoryShown = options.memoryShown ?? null;

  async function readMemories(): Promise<string> {
    try {
      return renderMemories(await longTermMemory.all(), { maxChars: limits.memoryChars });
    } catch (error) {
      logger.warn(`Couldn't read saved memories: ${errorMessage(error)}`);
      return memoryShown ?? '';
    }
  }

  /**
   * Saved memories go in front of the first message of a chat, so the model
   * follows them without having to think of calling recall. They are sent again
   * only if they changed since, which keeps the conversation append-only.
   */
  async function withMemories(prompt: string): Promise<{ list: string; text: string }> {
    const list = await readMemories();
    const first = memoryShown === null;
    const changed = list !== memoryShown;
    memoryShown = list;
    if (!changed || (first && !list)) return { list, text: prompt };
    return { list, text: `${memoryContext(list, { changed: !first })}\n\n${prompt}` };
  }

  /** The images the conversation refers to, as data URLs for the model call. */
  async function imagesFor(
    messages: readonly ModelMessage[],
  ): Promise<ReadonlyMap<string, string>> {
    if (!attachmentStore) return imageUrls;
    for (const message of messages) {
      if (message.role !== 'user') continue;
      for (const id of message.images ?? []) {
        if (imageUrls.has(id) || missingImages.has(id)) continue;
        try {
          const url = await imageDataUrl(attachmentStore, id);
          if (url) imageUrls.set(id, url);
          else missingImages.add(id);
        } catch (error) {
          missingImages.add(id);
          logger.warn(`Couldn't load attached image ${id}: ${errorMessage(error)}`);
        }
      }
    }
    return imageUrls;
  }

  /** After a batch of tool calls: the images view_image opened, as one message the model sees. */
  async function showRequestedImages(): Promise<void> {
    if (!imagesToShow.length) return;
    const ids = imagesToShow;
    imagesToShow = [];
    const names = await Promise.all(
      ids.map(async (id) => (await attachmentStore?.get(id).catch(() => null))?.name ?? id),
    );
    conversation.addUser(imagesShownMessage(names), { internal: true, images: ids });
  }

  /** Run one tool call and return the text to send back to the model. */
  async function runTool(name: string, rawArguments: string, callId = ''): Promise<string> {
    const tool = toolset.byName.get(name);
    if (!tool) return toolError(`There is no tool named "${name}".`);
    if (toolset.disabled.has(name)) {
      return toolError(
        `This workspace has turned off the tools ${name} belongs to (in its settings). Do the task without it, or tell the user it's off.`,
      );
    }
    // Called without loading it first (it knew the name): it's loaded from here on.
    if (toolset.deferred.has(name)) activeTools.add(name);

    // Arguments arrive as a JSON string, and nothing guarantees it is valid.
    let input: unknown;
    try {
      input = rawArguments ? JSON.parse(rawArguments) : {};
    } catch {
      return toolError(`The arguments were not valid JSON: ${rawArguments}`);
    }
    const invalid = tool.validate(input);
    if (invalid) return toolError(`${invalid} Fix the arguments and call ${name} again.`);

    if (tool.needsApproval && !(await approve(name, input))) {
      logger.warn(`${name} was not approved`);
      return toolError(
        "The user did not approve this action. Don't retry it; ask them or continue without it.",
      );
    }

    try {
      const notes = board ? { board, author: team?.author ?? 'main agent' } : null;
      const context: ToolContext =
        name === DELEGATE_TOOL && canDelegate
          ? { ...toolContext, notes, delegate: (task: DelegatedTask) => delegate(callId, task) }
          : { ...toolContext, notes };
      const output = await tool.runValidated(input, context);
      // Secrets are masked before the result goes anywhere: the model, the chat file, the
      // live stream and the log all get this text.
      const text = redactSecrets(
        typeof output === 'string' ? output : JSON.stringify(output, null, 2),
      );
      logger.event('tool_result', { tool: name, ok: true, chars: text.length });
      return limitToolOutput(text, limits.toolOutputChars);
    } catch (error) {
      const message = redactSecrets(errorMessage(error));
      logger.event('tool_result', { tool: name, ok: false, error: message });
      return toolError(message);
    }
  }

  /** A built-in read-only tool the workspace has on: it may run alongside others like it. */
  function canRunAlongside(name: string): boolean {
    const tool = toolset.byName.get(name);
    return Boolean(tool?.isReadOnly && !tool.needsApproval && !toolset.disabled.has(name));
  }

  /**
   * The model's calls in order, with each run of read-only calls grouped to run together, and
   * each run of delegate_task calls too (sub-agents ask for their own approvals, and at most
   * maxParallelSubagents of them work at once).
   */
  function batchCalls(calls: readonly ToolCall[]): ToolCall[][] {
    const kindOf = (name: string) =>
      canDelegate && name === DELEGATE_TOOL ? 'delegate' : canRunAlongside(name) ? 'read' : null;
    const batches: ToolCall[][] = [];
    for (const call of calls) {
      const last = batches.at(-1);
      const kind = kindOf(call.function.name);
      if (last && kind && last.every((c) => kindOf(c.function.name) === kind)) {
        last.push(call);
      } else {
        batches.push([call]);
      }
    }
    return batches;
  }

  /** Waits for a free sub-agent slot; call the returned function when done. */
  async function subagentSlot(): Promise<() => void> {
    const max = Math.max(1, config.maxParallelSubagents);
    if (subagentsRunning >= max) {
      await new Promise<void>((resolve) => subagentQueue.push(resolve));
    } else {
      subagentsRunning += 1;
    }
    return () => {
      const next = subagentQueue.shift();
      if (next)
        next(); // hands its slot straight to the next one waiting
      else subagentsRunning -= 1;
    };
  }

  /** The workspace's skills, one line each; a problem reading them only leaves them out. */
  async function readSkills(): Promise<string> {
    if (!skillStore) return '';
    try {
      return renderSkills(await skillStore.list());
    } catch (error) {
      logger.warn(`Couldn't read the workspace's skills: ${errorMessage(error)}`);
      return '';
    }
  }

  async function run(
    prompt: string,
    { attachments = [], skills = [] }: RunInput = {},
  ): Promise<RunResult> {
    const budget = new Budget(config);
    currentBudget = budget;
    // Fresh team notes for each request (a sub-agent keeps the one it was given).
    if (canDelegate) board = new Board();
    const toolsUsed: string[] = [];
    const finish = (status: RunStatus, text: string): RunResult => {
      const result: RunResult = {
        text,
        status,
        steps: budget.steps,
        toolsUsed,
        usage: budget.usage(),
        calls: budget.calls,
      };
      logger.event('run_end', { status, steps: result.steps, toolsUsed, usage: result.usage });
      return result;
    };

    // Files alone are a request too: to look at them.
    const typed =
      !prompt.trim() && attachments.length ? 'Take a look at the attached files.' : prompt;
    const inputCheck = checkInput(typed, config);
    if (!inputCheck.ok) return finish('rejected', inputCheck.reason);

    logger.event('run_start', {
      prompt,
      attachments: attachments.length,
      skills: skills.map((skill) => skill.name),
    });
    skillList = await readSkills();
    const hasAttachments = attachments.length > 0 || conversation.hasAttachments();
    systemSections = systemPromptSections(
      instructions,
      filesDir,
      skillList,
      toolset.deferredSummary,
      disabledTools,
      { voiceReplies, hasPlanningStep, hasAttachments, isSubagent, team: teamSection },
    );
    systemPrompt = systemSections.map((section) => section.text).join('');
    // Tools this chat already called stay sent: its earlier calls refer to them.
    for (const message of conversation.messages) {
      if (message.role !== 'assistant') continue;
      for (const call of message.tool_calls ?? []) activeTools.add(call.function.name);
    }
    // The attachment tools while the chat has files, use_skill while there are skills.
    if (hasAttachments) {
      for (const name of ATTACHMENT_TOOLS) activeTools.add(name);
    }
    if (skillList || skills.length) for (const name of SKILL_TOOLS) activeTools.add(name);
    const history = conversation.visible();
    const runStart = conversation.messages.length;
    // What was asked, for the planner, a summary or a write-up at the limit; messages the
    // user sends while the agent works are added to it.
    let request = [
      typed,
      attachments.length ? attachmentContext(attachments) : null,
      skills.length ? pickedSkillsContext(skills) : null,
    ]
      .filter(Boolean)
      .join('\n\n');
    const memories = await withMemories(request);
    conversation.addUser(memories.text, {
      display: prompt,
      attachments,
      skills: skills.map((skill) => skill.name),
    });

    const repeats: RepeatLog = new Map();
    let planThisRun = false; // the check step only applies to plans made for this request
    let checksLeft = config.maxPlanChecks;
    let answerBeforeCheck: string | null = null; // the answer given before the last check, if any
    let reviewsLeft = config.maxReviews;

    /**
     * Adds the messages the user sent since the last step, if any, and returns whether there
     * were some. Only between steps: every tool call needs its result before another message.
     */
    const takeSteering = (): boolean => {
      const messages = options.steering?.take() ?? [];
      for (const { id, text, sentAt } of messages) {
        conversation.addUser(steeringMessage(text), { display: text, steeredAt: sentAt });
        request = `${request}\n\nAdded by the user while you worked:\n${text}`;
        logger.event('steer', { text });
        emit({ type: 'steer', id, text, sentAt });
      }
      return messages.length > 0;
    };

    try {
      // ---- 1. Plan ----
      if (config.planning === 'auto') {
        planThisRun = await planFirst(request, history, memories.list, budget, toolsUsed);
      }

      while (true) {
        if (isStopped()) return finish('stopped', STOPPED_TEXT);
        // ---- 4. Limit ----
        const limit = budget.exceeded();
        if (limit) {
          logger.warn(`Stopped: the agent ${limit}`);
          emit({ type: 'limit', reason: limit });
          return finish(
            'budget_exceeded',
            await summarizeAtLimit(request, limit, runStart, budget),
          );
        }

        takeSteering();
        emit({ type: 'model_call', step: budget.steps + 1 });
        const sent = await prepareRequest(request, runStart, budget);
        const { message, finishReason, usage, model } = await callRecorded(
          budget,
          'step',
          {
            system: systemPrompt,
            messages: sent.messages,
            images: await imagesFor(sent.messages),
            tools: sent.tools,
            onText: (text) => emit({ type: 'text_delta', text }),
            onReasoning: reasoningOnce(),
          },
          { sections: systemSections, infos: sent.infos },
        );
        meter.calibrate(sent.raw, usage.inputTokens);
        emit({
          type: 'context',
          // Input only: that is what the summarize threshold is measured against.
          usedTokens: usage.inputTokens || sent.tokens,
          windowTokens: contextWindow.window,
          summarizeAtTokens: compactThreshold(contextWindow),
        });
        logger.event('model_response', {
          finish_reason: finishReason,
          usage,
          model,
          tool_calls: message.tool_calls?.length ?? 0,
        });

        if (message.refusal || finishReason === 'content_filter') {
          // Not added to history: a blocked turn can hold a cut-off tool call.
          logger.warn('The model declined or the server filtered this response');
          return finish(
            'refused',
            message.refusal || 'The model server blocked this response with its content filter.',
          );
        }

        const calls = (message.tool_calls ?? []).filter((c) => c.type === 'function');
        conversation.addAssistant(message);

        // No tool calls: the model has its answer. (Check calls, not finishReason:
        // some servers report "stop" even when they return tool calls.)
        if (calls.length === 0) {
          const text = (message.content ?? '').trim();
          if (finishReason === 'length') {
            logger.warn('The response hit the token limit');
            return finish('truncated', `${text}\n\n[Response cut off at the token limit.]`);
          }
          // The user said more while it worked: answer with that in mind, not before it.
          if (takeSteering()) {
            answerBeforeCheck = null;
            continue;
          }
          // ---- 3. Check ----
          // After a check, a reply much shorter than the earlier answer is an addendum
          // ("nothing new found, X is still missing"), so keep both. A full rewrite replaces it.
          const answer: string =
            answerBeforeCheck && text.length < answerBeforeCheck.length * 0.6
              ? [answerBeforeCheck, text].filter(Boolean).join('\n\n')
              : text;
          if (planThisRun && checksLeft > 0 && !planner.isComplete()) {
            checksLeft -= 1;
            answerBeforeCheck = answer;
            const unfinished = planner.unfinishedSteps();
            logger.step(`check: ${unfinished.length} plan step(s) still open`);
            emit({ type: 'check', unfinished });
            conversation.addUser(planCheckMessage(unfinished, planner.plan?.doneWhen ?? ''), {
              internal: true,
            });
            continue;
          }
          if (answer && reviewsLeft > 0 && shouldReview(config.review, toolsUsed)) {
            reviewsLeft -= 1;
            const review = await reviewAnswer(request, runStart, budget, answer);
            if (isStopped()) return finish('stopped', STOPPED_TEXT);
            if (review.verdict === 'revise') {
              answerBeforeCheck = answer;
              conversation.addUser(reviseMessage(review.issues), { internal: true });
              continue;
            }
          }
          return finish('done', answer || '(The model returned an empty response.)');
        }

        // Every tool call needs a matching result before the next model call. Read-only calls
        // next to each other run at the same time; the rest one at a time, in order.
        for (const batch of batchCalls(calls)) {
          if (isStopped()) {
            // The model asked for them, so they still need results; they just don't run.
            for (const call of batch) {
              conversation.addToolResult(
                call.id,
                toolError('Stopped by the user before this ran.'),
              );
            }
            continue;
          }
          delegateBatchSize = batch.filter((c) => c.function.name === DELEGATE_TOOL).length || 1;
          const results = await Promise.all(
            batch.map(async (call) => {
              const { name, arguments: args } = call.function;
              toolsUsed.push(name);
              logger.step(`${name} ${summarize(args)}`);
              emit({ type: 'tool_call', id: call.id, name, args });
              const ran =
                finishReason === 'length'
                  ? toolError(
                      "Your output hit the token limit, so this call's arguments were cut off. Retry with smaller input.",
                    )
                  : await runTool(name, args, call.id);
              const result = noteRepeat(repeats, name, args, ran);
              if (result !== ran) logger.warn(`${name} was called again with the same result`);
              emit({ type: 'tool_result', id: call.id, name, ...toolResultPreview(result) });
              if (PLAN_TOOLS.has(name)) emit({ type: 'plan', plan: planner.plan });
              if (name === 'create_plan' && !ran.startsWith('Error: ')) planThisRun = true; // re-planned mid-task
              if (MEMORY_TOOLS.has(name) && !ran.startsWith('Error: ')) {
                memoryShown = await readMemories(); // the model knows its own changes
              }
              return { id: call.id, result };
            }),
          );
          // In the order the model asked, whichever finished first.
          for (const { id, result } of results) conversation.addToolResult(id, result);
        }
        if (isStopped()) return finish('stopped', STOPPED_TEXT);
        // Only now: every tool call needs its result before any other message.
        await showRequestedImages();
      }
    } catch (error) {
      // Stopped mid-call: nothing half-written was added, so the chat stays consistent.
      if (error instanceof StoppedError || isStopped()) return finish('stopped', STOPPED_TEXT);
      throw error;
    }
  }

  /**
   * What the next model call is sent: the conversation as the model sees it (forModel), first
   * summarized if it nears the context window, then trimmed if it's still too big.
   */
  async function prepareRequest(
    request: string,
    runStart: number,
    budget: Budget,
  ): Promise<{
    messages: ModelMessage[];
    tools: ToolDefinition[];
    /** how each message came about, for the token usage breakdown */
    infos: MessageInfo[];
    raw: number;
    tokens: number;
  }> {
    const tools = toolset.definitionsFor(activeTools);
    let view = conversation.forModel();
    let size = meter.estimate(systemPrompt, tools, view.messages);
    if (size.tokens > compactThreshold(contextWindow)) {
      if (await compact(view, request, runStart, budget, size.tokens, tools)) {
        view = conversation.forModel();
        size = meter.estimate(systemPrompt, tools, view.messages);
      }
    }
    let messages = view.messages;
    const ceiling = HARD_LIMIT * contextWindow.usable;
    if (size.tokens > ceiling) {
      messages = shrinkToolResults(messages, meter.toRaw(size.tokens - ceiling));
      const shrunk = meter.estimate(systemPrompt, tools, messages);
      logger.warn(
        `The request was too big for the context window (${size.tokens} of ${contextWindow.usable} tokens): old tool results were left out of this call (now ${shrunk.tokens}).`,
      );
      size = shrunk;
    }
    // shrinkToolResults keeps every message in place, so the view's indexes still match.
    const summaryIndex = conversation.latestSummary()?.index;
    const infos = view.indexes.map((index) => ({
      isInternal: conversation.isInternal(index),
      display: conversation.displayText(index),
      isSummary: index === summaryIndex,
    }));
    return { messages, tools, infos, ...size };
  }

  /**
   * Summarizes the older part of the model's view (one tool-free call, or a few for a long
   * one) and stores the summary, keeping recent messages word for word. False when there was
   * nothing to summarize or the summary failed; the caller then trims instead.
   */
  async function compact(
    view: { messages: ModelMessage[]; indexes: number[] },
    request: string,
    runStart: number,
    budget: Budget,
    tokensBefore: number,
    tools: ToolDefinition[],
  ): Promise<boolean> {
    const cut = compactionCut(view.messages, keepRecentTokens(contextWindow));
    if (cut === null) return false;
    // An earlier summary is the view's first message, so it's among what gets summarized.
    const hadSummary = conversation.latestSummary() !== null;
    const covered = view.messages.slice(0, cut);
    // The stored index the kept part starts at; past the end when nothing is kept.
    const upTo = view.indexes[cut] ?? conversation.messages.length;
    let summary = '';
    try {
      for (const chunk of transcriptChunks(covered, contextWindow)) {
        const content = summary
          ? `The summary so far:\n${summary}\n\nThe conversation that follows it:\n${chunk}`
          : chunk;
        const { message } = await callRecorded(budget, 'compaction', {
          system: COMPACTION_PROMPT,
          messages: [{ role: 'user', content }],
        });
        summary = (message.content ?? '').trim() || summary;
      }
    } catch (error) {
      if (error instanceof StoppedError || isStopped()) throw error;
      logger.warn(`Couldn't summarize the earlier conversation: ${errorMessage(error)}`);
      return false;
    }
    if (!summary) return false;

    conversation.addSummary(
      summaryMessage(summary, {
        plan: planner.plan ? planner.render() : null,
        memories: memoryShown || null,
        // This run's request was summarized too: keep it word for word.
        request: upTo > runStart ? request : null,
      }),
      upTo,
    );
    const tokensAfter = meter.estimate(
      systemPrompt,
      tools,
      conversation.forModel().messages,
    ).tokens;
    const summarized = covered.length - (hadSummary ? 1 : 0);
    logger.event('compaction', { summarized, tokensBefore, tokensAfter, upTo });
    emit({ type: 'compaction', summarizedMessages: summarized, tokensBefore, tokensAfter });
    return true;
  }

  /**
   * The planning step. Returns true when it made a plan. The plan is added to the
   * conversation as if the model had called create_plan itself, so the model
   * sees it as its own plan and the UI shows it like any other step.
   */
  async function planFirst(
    prompt: string,
    history: ModelMessage[],
    memories: string,
    budget: Budget,
    toolsUsed: string[],
  ): Promise<boolean> {
    emit({ type: 'planning' });
    const unfinished = planner.plan && !planner.isComplete() ? planner.render() : null;
    const { decision } = await decide({
      callModel: (request) => callRecorded(budget, 'planner', request),
      system: plannerPrompt,
      request: prompt,
      history,
      currentPlan: unfinished,
      memories,
      instructions,
      skills: skillList,
    });
    logger.event('planning', decision);
    emit({
      type: 'route',
      mode: decision.mode,
      reason: decision.reason,
      steps: decision.mode === 'plan' ? decision.steps.length : 0,
    });

    if (decision.mode !== 'plan') {
      logger.step(`answering directly${decision.reason ? `: ${decision.reason}` : ''}`);
      return false;
    }
    const id = `plan_${Date.now()}`;
    const args = JSON.stringify({
      goal: decision.goal,
      steps: decision.steps,
      done_when: decision.done_when,
    });
    const rendered = planner.create(decision.goal, decision.steps, decision.done_when);
    conversation.addAssistant({
      content: '',
      tool_calls: [{ id, type: 'function', function: { name: 'create_plan', arguments: args } }],
    });
    conversation.addToolResult(id, rendered);
    toolsUsed.push('create_plan');
    logger.step(
      `plan: ${decision.steps.length} steps${decision.reason ? ` (${decision.reason})` : ''}`,
    );
    emit({ type: 'tool_call', id, name: 'create_plan', args });
    emit({ type: 'tool_result', id, name: 'create_plan', ok: true, preview: rendered });
    emit({ type: 'plan', plan: planner.plan });
    return true;
  }

  /** Out of steps or tokens: one tool-free call that writes up what was found so far. */
  /**
   * The reviewer checks the answer against the request and this run's findings. A failed
   * review call passes the answer: the review only ever adds a chance to fix it.
   */
  async function reviewAnswer(
    request: string,
    runStart: number,
    budget: Budget,
    answer: string,
  ): Promise<Review> {
    emit({ type: 'reviewing' });
    const content = reviewMessage({
      request,
      plan: planner.plan ? planner.render() : null,
      findings: describeRun(conversation.messages.slice(runStart + 1)),
      answer,
    });
    let review: Review = { verdict: 'pass', issues: [] };
    try {
      const { message } = await callRecorded(
        budget,
        'review',
        { system: REVIEW_PROMPT, messages: [{ role: 'user', content }] },
        undefined,
        callReviewer,
      );
      review = parseReview(message.content ?? '');
    } catch (error) {
      if (error instanceof StoppedError || isStopped()) throw error;
      logger.warn(`The review failed, so the answer stands: ${errorMessage(error)}`);
    }
    logger.event('review', { verdict: review.verdict, issues: review.issues });
    emit({ type: 'review', verdict: review.verdict, issues: review.issues });
    return review;
  }

  /**
   * delegate_task: a sub-agent with a fresh conversation and plan works on the task, with the
   * same workspace, tools (but delegate_task), stop signal and approvals (labelled with it).
   * It may use what is left of this run's token budget; its calls count toward this run.
   */
  async function delegate(callId: string, { task, label, agent }: DelegatedTask): Promise<string> {
    const budget = currentBudget;
    if (!budget) throw new Error('No run in progress.');
    const chosen = specialistsByName.get(agent) ?? specialistsByName.get(GENERAL_SPECIALIST);
    if (!chosen) throw new Error(`There is no specialist "${agent}".`);
    // Sub-agents started in the same step share what is left; each waits for a free slot.
    const share = delegateBatchSize;
    const release = await subagentSlot();
    try {
      if (isStopped()) throw new StoppedError();
      const tokensLeft = Math.floor((budget.maxTotalTokens - budget.budgetTokens()) / share);
      if (tokensLeft <= 0)
        throw new Error('The token budget is used up. Finish without a sub-agent.');
      const from: ApprovalSource = { subagent: label, specialist: chosen.name };
      const ownModel =
        chosen.model === 'review' && (options.reviewCallModel || options.reviewModel)
          ? options.reviewCallModel
            ? { callModel: options.reviewCallModel }
            : { callModel: undefined, model: options.reviewModel }
          : options.subagentCallModel
            ? { callModel: options.subagentCallModel }
            : options.subagentModel
              ? { callModel: undefined, model: options.subagentModel }
              : {};
      logger.step(`sub-agent "${label}" (${chosen.name}) started`);
      const child = createAgent({
        ...options,
        ...ownModel,
        role: 'subagent',
        config: {
          ...config,
          planning: 'off',
          review: 'off',
          subagents: false,
          maxTotalTokens: tokensLeft,
        },
        team: board ? { board, author: label, specialist: chosen } : undefined,
        approve: (name, input) => approve(name, input, from),
        askUser: askUser ?? undefined,
        onEvent: (event) => emit({ type: 'subagent', callId, event }),
        conversation: new Conversation(),
        planner: new Planner(),
        memoryShown: null,
        steering: undefined,
        voiceReplies: false,
        chatId: undefined,
      });
      const result = await child.run(task);
      for (const call of result.calls) {
        budget.recordCall(call, { ...call, kind: 'subagent' });
      }
      emit({ type: 'usage', steps: budget.steps, usage: budget.usage() });
      logger.step(`sub-agent "${label}" ended: ${result.status}`);
      if (result.status === 'stopped') throw new StoppedError();
      const note =
        result.status === 'done'
          ? ''
          : `[The sub-agent ended early (${result.status}); its report may be incomplete.]\n\n`;
      return `${note}${result.text}`;
    } finally {
      release();
    }
  }

  async function summarizeAtLimit(
    prompt: string,
    limit: string,
    runStart: number,
    budget: Budget,
  ): Promise<string> {
    const fallback = `I stopped because I ${limit}. Ask me to continue if you want me to keep going.`;
    const findings = describeRun(conversation.messages.slice(runStart + 1));
    const content = [
      `Request:\n${prompt}`,
      planner.plan ? `Plan:\n${planner.render()}` : null,
      `Findings so far:\n${findings || '(nothing yet)'}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      emit({ type: 'model_call', step: budget.steps + 1 });
      const { message } = await callRecorded(budget, 'limit_summary', {
        system: LIMIT_SUMMARY_PROMPT,
        messages: [{ role: 'user', content }],
        onText: (text) => emit({ type: 'text_delta', text }),
        onReasoning: reasoningOnce(),
      });
      const text = (message.content ?? '').trim();
      if (!text) return fallback;
      conversation.addAssistant({ content: text }); // so "continue" has context next time
      return text;
    } catch (error) {
      logger.error(`Couldn't write a summary at the limit: ${errorMessage(error)}`);
      return fallback;
    }
  }

  return {
    run,
    planner,
    longTermMemory,
    conversation,
    get memoryShown() {
      return memoryShown;
    },
    logFile: logger.file,
    reset() {
      conversation.reset();
      planner.reset();
      memoryShown = null;
    },
  };
}

const STOPPED_TEXT = 'Stopped by the user.';

/** How often a streaming call's estimated tokens are reported, at most. */
const LIVE_USAGE_INTERVAL_MS = TOKEN_USAGE.liveIntervalMs;

const PLAN_TOOLS = new Set(['create_plan', 'update_plan', 'add_plan_steps']);

/** Whether the reviewer checks this answer: `tasks` skips answers that needed no tools. */
function shouldReview(mode: ReviewMode, toolsUsed: readonly string[]): boolean {
  if (mode === 'always') return true;
  if (mode === 'tasks') return toolsUsed.some((name) => !PLAN_TOOLS.has(name));
  return false;
}
const MEMORY_TOOLS = new Set(['remember', 'forget']);

/** This run's messages as plain text (for the summary call), newest kept if too long. */
function describeRun(
  messages: readonly ModelMessage[],
  { perItem = CONTEXT.limitSummaryItemChars, total = CONTEXT.limitSummaryTotalChars } = {},
): string {
  const cut = (text: string) => (text.length > perItem ? `${text.slice(0, perItem)}…` : text);
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      if (m.content) lines.push(`Agent: ${cut(m.content)}`);
      for (const call of m.tool_calls ?? []) {
        lines.push(`Agent called ${call.function.name} ${cut(call.function.arguments)}`);
      }
    } else if (m.role === 'tool') {
      lines.push(`Result: ${cut(m.content)}`);
    }
  }
  let text = lines.join('\n\n');
  if (text.length > total) text = `…(earlier findings cut)…\n${text.slice(-total)}`;
  return text;
}

/** Each distinct call this run made (tool and arguments) with the result it last got. */
type RepeatLog = Map<string, string>;

const REPEATED_CALL_NOTE =
  "Note: you made this exact call before in this task and got the same result. Don't repeat it: use the result you have, change the arguments, or try another way. If you are waiting for something to change (a background task), say so instead of checking again right away.";

/**
 * The result, with a note when the same call (same tool, same arguments) last got this exact
 * result: a model stuck in a loop repeats a call that can't help, until the step limit.
 */
function noteRepeat(repeats: RepeatLog, name: string, args: string, result: string): string {
  const key = `${name} ${canonicalArguments(args)}`;
  const previous = repeats.get(key);
  repeats.set(key, result);
  return previous === result ? `${result}\n\n${REPEATED_CALL_NOTE}` : result;
}

/** The arguments as sorted JSON without the approval reason, so the same call matches itself. */
function canonicalArguments(args: string): string {
  try {
    return JSON.stringify(withoutReason(JSON.parse(args || '{}')), (_key, value: unknown) =>
      isRecord(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value,
    );
  } catch {
    return args;
  }
}

// The chat format has no error flag on tool results, so mark errors in the text.
function toolError(message: string): string {
  return `Error: ${message}`;
}

function summarize(args: string): string {
  const text = typeof args === 'string' ? args : JSON.stringify(args ?? {});
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}
