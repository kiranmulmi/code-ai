// ============================================================================================
//  Code AI: tunable numbers, all in one place.
//
//  Edit a value here, then rebuild (`npm run build:packages`, or restart `npm run dev`) and
//  every app (API, web, CLI) picks it up. Sizes are in characters unless the name says bytes or
//  tokens; times are in milliseconds unless the name says seconds (S / Seconds).
//
//  Keep this file free of imports: everything else imports it.
//  Not here on purpose: UI pixel sizes and animation timings (they live with their components)
//  and the desktop app's start/stop timeouts (apps/desktop is packaged on its own and can't
//  import this).
// ============================================================================================

// ---------- Agent settings (Settings -> Agent) ----------

/** Defaults for a new install; each user can change them in Settings -> Agent. */
export const AGENT_SETTING_DEFAULTS = {
  /** working steps (model calls that can use tools) per message */
  maxSteps: 30,
  /** input + output tokens per message (cached input counts at CONTEXT.cachedInputWeight) */
  maxTotalTokens: 400_000,
  /** longer prompts are rejected */
  maxInputChars: 20_000,
  /** sub-agents that may work at the same time when the agent starts several in one step */
  maxParallelSubagents: 3,
};

/** The range Settings -> Agent accepts. */
export const SETTINGS_LIMITS = {
  maxSteps: { min: 1, max: 200 },
  maxTotalTokens: { min: 1_000, max: 50_000_000 },
  maxInputChars: { min: 100, max: 1_000_000 },
  maxParallelSubagents: { min: 1, max: 8 },
  searxngUrl: 500,
} as const;

// ---------- Context window and token use ----------

export const CONTEXT = {
  /** the window assumed for a model whose settings don't give one */
  defaultContextWindow: 128_000,
  /** room kept for the reply when the model has no max output tokens: this share of the window */
  replyReserveShare: 0.1,
  /** summarize older messages at this share of the usable window... */
  summarizeAtShare: 0.8,
  /** ...or at this many tokens, whichever comes first */
  summarizeAtTokens: 200_000,
  /** newest messages kept word for word when summarizing: this share of the usable window */
  keepRecentShare: 0.25,
  /** one summarizing call reads at most this share of the usable window */
  summaryChunkShare: 0.5,
  /** each message in the text sent for summarizing is cut to this share of the window (chars)... */
  summaryItemShare: 0.05,
  /** ...but kept between these many characters */
  summaryItemMinChars: 500,
  summaryItemMaxChars: 4_000,
  /** past this share (after summarizing), the oldest tool results are left out of a call */
  hardLimitShare: 0.95,
  /** rough characters per token, for estimates */
  charsPerToken: 4,
  /** tokens each message adds for its role and separators */
  messageOverheadTokens: 4,
  /** what one attached image roughly costs */
  imageTokens: 1_500,
  /** input read from the server's prompt cache counts at this share against the token budget */
  cachedInputWeight: 0.1,
  /** the most one tool result may be; every result is resent with each later step */
  maxToolOutputChars: 12_000,
  /** on small windows a tool result is capped at this share of the window (chars)... */
  toolOutputShare: 0.15,
  /** ...but never below this */
  minToolOutputChars: 2_000,
  /** saved memories shown to the model: this share of the window (chars), between min and max */
  memoryShare: 0.05,
  minMemoryChars: 1_000,
  maxMemoryChars: 6_000,
  /** at most this many saved memories are shown (newest first); the rest are reachable by recall */
  maxMemoriesShown: 40,
  /** the write-up when out of steps or tokens: each finding cut to this, and all of them to total */
  limitSummaryItemChars: 3_000,
  limitSummaryTotalChars: 60_000,
};

// ---------- Guardrails ----------

export const GUARDRAILS = {
  /**
   * Keep the agent and the Files panel out of the app's data folders (APP_DATA_FOLDER in
   * @app/agent's guardrails: the one in the home folder and the one in each workspace, which
   * hold model API keys, MCP tokens, chats and memory). When true, the file tools and the
   * Files panel refuse paths inside them, and run_command refuses commands that name them.
   * When false, those refusals are off. The folders still stay out of file listings,
   * searches and the workspace overview, and secrets in tool output are still masked.
   */
  protectAppData: false,
} as const;

// ---------- Planning ----------

/** Spotting a run that is stuck: steps in a row where every tool call failed or repeated. */
export const STUCK = {
  /** after this many such steps the agent is told to change approach (once per streak) */
  nudgeAfter: 3,
  /** after this many it stops and writes up what it found */
  stopAfter: 6,
};

export const PLANNING = {
  /** the most steps a plan may have */
  maxPlanSteps: 20,
  /** the planning step sees this many recent messages of the chat... */
  historyMessages: 8,
  /** ...each cut to this length */
  historyMessageChars: 1_200,
};

// ---------- The agent's tools ----------

export const TOOL_LIMITS = {
  readFile: {
    /** larger files are refused (use search_files to find the part you need) */
    maxFileBytes: 5_000_000,
    /** one part of a file; longer files are read in parts */
    partChars: 10_000,
    /** longer lines (minified code, data) are cut */
    maxLineChars: 1_000,
  },
  searchFiles: {
    maxMatches: 80,
    /** larger files are skipped */
    maxFileBytes: 1_000_000,
    /** each matching line is cut to this */
    maxLineChars: 160,
  },
  findFiles: { maxResults: 200 },
  listFiles: { maxEntries: 250 },
  fetchPage: {
    timeoutMs: 20_000,
    /** the most downloaded from one page */
    maxBytes: 3_000_000,
    /** one part of a page's text; long pages are read in parts */
    partChars: 6_000,
    maxRedirects: 5,
  },
  webSearch: { maxResults: 8, timeoutMs: 15_000 },
  runCommand: {
    defaultTimeoutSeconds: 120,
    maxTimeoutSeconds: 600,
    /** a background command's first output is reported after this long */
    backgroundStartupMs: 4_000,
    /** after a command ends or times out: how long leftovers get before they are killed */
    killGraceMs: 1_500,
    /** long output keeps its start and end, this long each */
    outputHeadChars: 2_000,
    outputTailChars: 8_000,
    /** files compared before and after a command, to list what it changed; past this, none are */
    maxFilesTracked: 20_000,
    /** files named in each of its "files changed" / "files read" lines */
    maxFilesListed: 12,
  },
  backgroundTasks: {
    /** running tasks one workspace may have at once */
    maxRunning: 10,
    /** stopped tasks kept per workspace, so their output can still be read */
    keepStopped: 10,
    /** after asking a task to stop: how long it gets before it is killed */
    stopGraceMs: 3_000,
  },
  /** one part of an attached file's text (read_attachment) */
  readAttachmentPartChars: 18_000,
  /** one part of a skill's file (read_skill_file) */
  readSkillFilePartChars: 18_000,
};

// ---------- MCP servers ----------

export const MCP_LIMITS = {
  maxToolsPerServer: 500,
  /** a tool's description is cut to this */
  maxDescriptionChars: 2_000,
  /** the last lines a local server wrote to stderr, kept to explain a failure */
  stderrLines: 20,
};

// ---------- Chat titles ----------

export const CHAT_TITLES = {
  /** the title is written from the chat's first this-many messages */
  fromMessages: 3,
  /** each message sent for the title is cut to this */
  messageChars: 600,
  maxTitleChars: 60,
};

// ---------- Token usage breakdown (the "tokens" dialog) ----------

export const TOKEN_USAGE = {
  /** items listed per group in one call's breakdown; the rest are summed as "Others" */
  itemsPerCall: 8,
  /** items listed per group when the web app adds breakdowns up */
  itemsInTotal: 12,
  labelChars: 80,
  /** how often a streaming call's token estimate is updated */
  liveIntervalMs: 250,
};

// ---------- Sizes the API, the store and the web forms enforce ----------

export const LIMITS = {
  workspaceName: 80,
  chatTitle: 120,
  instructions: 8000,
  folderPath: 1024,
  filePreviewBytes: 200_000,
  modelName: 80,
  modelId: 200,
  modelUrl: 500,
  apiKey: 1000,
} as const;

export const ATTACHMENT_LIMITS = {
  /** per file, after base64 decoding */
  maxBytes: 15 * 1024 * 1024,
  perMessage: 10,
  nameLength: 200,
} as const;

/** What the agent's ask_user tool may ask, and how long an answer may be. */
export const QUESTION_LIMITS = {
  questionChars: 500,
  minOptions: 2,
  maxOptions: 4,
  labelChars: 120,
  descriptionChars: 300,
  answerChars: 4000,
} as const;

export const SKILL_LIMITS = {
  nameLength: 64,
  descriptionLength: 1024,
  bodyChars: 40_000,
  /** skills one workspace can have (all of them are listed to the agent) */
  count: 100,
  /** skills the user can pick for one message */
  perMessage: 5,
  /** an uploaded skill folder: at most this many files (SKILL.md included)… */
  fileCount: 100,
  /** …each at most this large… */
  fileBytes: 2 * 1024 * 1024,
  /** …and together at most this large */
  totalBytes: 10 * 1024 * 1024,
  /** a file's path inside the skill folder */
  pathLength: 240,
  /** a skill's SKILL.md is read only up to this size */
  readBytes: 256 * 1024,
} as const;

/** A workspace's own specialist sub-agents (.code-ai/<workspace>/agents/<name>.md). */
export const AGENT_LIMITS = {
  /** specialists read from one workspace (all of them are listed to the agent) */
  count: 20,
  /** a file is read only up to this size */
  fileBytes: 32 * 1024,
  nameLength: 40,
  descriptionLength: 300,
  /** the role text under the front matter */
  instructionsChars: 20_000,
} as const;

/** Longest text each AI writer takes. */
export const WRITER_LIMITS = {
  /** the "improve" button's draft prompt */
  improvePromptChars: 20_000,
  /** a request to the instructions assistant */
  instructionsRequestChars: 2000,
  /** a request to the skill writer */
  skillRequestChars: 2000,
};

/** How much of a tool result the chat shows; the model gets all of it. */
export const TOOL_RESULT_PREVIEW_CHARS = 600;
/** Largest file the editor saves. */
export const FILE_EDIT_MAX_CHARS = 400_000;
/** Longest command the user can start as a background task. */
export const TASK_COMMAND_MAX_CHARS = 4_000;

// ---------- API ----------

export const API_LIMITS = {
  /** sign-in tokens already checked, kept so polling doesn't verify the same one again */
  authTokenCacheSize: 200,
  /** an approval request counts as declined after this long */
  approvalTimeoutMs: 5 * 60_000,
  /** a question to the user counts as skipped after this long */
  questionTimeoutMs: 30 * 60_000,
  /** messages sent during a run that the agent hasn't read yet, at most */
  maxWaitingMessages: 10,
  /** terminal output kept for replay when the browser reattaches */
  terminalScrollbackChars: 200_000,
  /** a terminal ticket must be used this soon after it is issued */
  terminalTicketMs: 30_000,
  /** "Reveal in Finder": an opener still running after this long is taken to have worked */
  revealWaitMs: 5_000,
};

/** The Files panel (the file tree and its search). */
export const FILES_PANEL = {
  /** a folder's entries sent at a time; "Show more" asks for the next ones */
  folderPage: 500,
  /** at most this many in one request (a refresh reloads what was already shown) */
  maxFolderPage: 5_000,
  maxNameResults: 200,
  maxContentMatches: 300,
  /** search: files walked at most */
  searchMaxWalked: 50_000,
  /** search: larger files are skipped */
  searchMaxFileBytes: 1_000_000,
  searchMaxLineChars: 240,
  searchMaxLinesPerFile: 50,
  searchTimeLimitMs: 6_000,
};

/** The Git panel. */
export const GIT_LIMITS = {
  maxFiles: 500,
  maxDiffBytes: 400_000,
  maxOutputBytes: 4_000_000,
  timeoutMs: 15_000,
};

/** What the AI writers read of a project to understand it. */
export const PROJECT_PEEK = {
  maxNames: 60,
  maxFiles: 2,
  maxFileChars: 2500,
};

/** The snapshot of the workspace folder given to the model with every request. */
export const WORKSPACE_OVERVIEW = {
  /** files and folders listed, top level first */
  maxEntries: 80,
  /** 1 = top level only; 2 also lists what each top-level folder holds */
  maxDepth: 2,
  /** entries shown inside each deeper folder; the rest are counted as "+N more" */
  maxPerFolder: 8,
  /** characters of the README / agent notes shown */
  docChars: 1500,
  /** notes or package.json larger than this aren't read */
  maxDocBytes: 256_000,
};

// ---------- Web app ----------

export const WEB_APP = {
  minPasswordLength: 8,
  /** seconds before the same sign-in email can be sent again */
  resendEmailAfterS: 60,
  /** code larger than this isn't syntax-coloured in the file preview... */
  maxHighlightChars: 200_000,
  /** ...or in chat code blocks */
  maxCodeBlockHighlightChars: 100_000,
  /** the file preview's search highlights at most this many matches */
  maxPreviewMatches: 999,
  /** wait for a pause in typing this long before searching files */
  fileSearchDelayMs: 250,
  /** wait for a pause in typing this long before checking a workspace folder */
  folderCheckDelayMs: 300,
  /** how often an open background task's output is fetched */
  taskOutputPollMs: 1_500,
  /** how often the list of running tasks is checked */
  runningTasksPollMs: 10_000,
  /** how often the Git panel and its change count refresh */
  gitPollMs: 10_000,
  /** toasts shown at once */
  maxToasts: 4,
};

/** A workspace's notes (notes.json in its data folder). */
export const NOTE_LIMITS = {
  /** notes one workspace can have */
  count: 500,
  titleChars: 200,
  bodyChars: 100_000,
} as const;

/** Tool plugins (plugins/<name>/ in the app's data folder), made in the Tools tab. */
export const PLUGIN_LIMITS = {
  /** also the MCP server name, which can be at most 32 */
  nameLength: 32,
  descriptionLength: 300,
  /** tools.mjs */
  codeChars: 100_000,
  envCount: 30,
  /** a request to the plugin writer */
  requestChars: 4000,
  /** a test: loading the code and running one tool */
  testTimeoutMs: 60_000,
} as const;
