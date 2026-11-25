// Observability: every step of a run goes to the terminal as one readable line, and to a JSONL
// file in ~/.code-ai/logs/ (one entry per line, AGENT_LOG_DIR to move it), so you can see why
// the agent did what it did after the fact. The console level is set in the app
// (Settings -> Agent): `info` shows the run's timeline, `debug` adds every model call.
//
// A run reads top to bottom, scoped by its chat (and sub-agent):
//
//   14:02:40  c57da5a3     ▶ "fix the login bug"                    GPT 4.1 · 1 file
//   14:02:41  c57da5a3     ◇ plan · 3 steps                          touches several files
//   14:02:44  c57da5a3     ▸ read_file  src/auth.ts                  ✓ 12ms · 4.2k chars
//   14:02:51  c57da5a3     ▸ edit_file  src/auth.ts                  ✗ 3ms · old text not found
//   14:03:02  c57da5a3 › researcher  ▶ sub-agent "Research pricing"
//   14:03:40  c57da5a3     ■ done                                    6 steps · 9 tools · 1m 0s · 52k in / 1.9k out
import fs from 'node:fs';
import path from 'node:path';
import type { ModelCallKind, RunStatus, Usage } from '@app/shared';
import type { LogLevel } from './config.js';
import {
  describeArgs,
  formatCount,
  formatDuration,
  formatLine,
  truncate,
  type LineLevel,
  type LogLine,
  type Segment,
} from './log-format.js';

/** What a run logs, as data: the JSONL file keeps these as they are. */
export type AgentLogEntry =
  | {
      type: 'run_start';
      prompt: string;
      model: string | null;
      attachments: number;
      skills: string[];
    }
  | { type: 'route'; mode: 'direct' | 'plan'; reason: string; steps: number }
  | {
      type: 'model_call';
      kind: ModelCallKind;
      model: string | null;
      durationMs: number;
      usage: Usage;
      finishReason: string | null;
      toolCalls: string[];
    }
  | {
      type: 'tool';
      name: string;
      args: string;
      ok: boolean;
      durationMs: number;
      chars: number;
      error?: string;
      /** the same call gave the same result before */
      isRepeat?: boolean;
    }
  | { type: 'plan_check'; open: number }
  | { type: 'subagent_start'; label: string; specialist: string }
  | { type: 'subagent_end'; label: string; status: RunStatus; durationMs: number }
  | { type: 'review'; verdict: string; issues: string[] }
  | { type: 'compaction'; summarized: number; tokensBefore: number; tokensAfter: number }
  | { type: 'steer'; text: string }
  | {
      type: 'run_end';
      status: RunStatus;
      steps: number;
      tools: number;
      durationMs: number;
      usage: Usage;
    }
  | { type: 'run_failed'; error: string };

export interface AgentLogger {
  /** The JSONL log file, or null when logging to a file is off. */
  file: string | null;
  record(entry: AgentLogEntry): void;
  warn(text: string, data?: object): void;
  error(text: string, data?: object): void;
  /** The same logger, its lines labelled with `name` too (a chat, a sub-agent). */
  scoped(name: string): AgentLogger;
}

export interface LoggerOptions {
  /** A function is asked on every line, so a server can follow a setting changed in the app. */
  level?: LogLevel | (() => LogLevel);
  logDir?: string;
  sessionName?: string;
  /** Colours in the terminal; by default when stderr is one. */
  color?: boolean;
  /** Where lines go; stderr by default. */
  write?: (line: string) => void;
}

/** Whether a stream shows ANSI colours: a terminal, or FORCE_COLOR (set by `concurrently`). */
export function supportsColor(stream: { isTTY?: boolean }): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR !== undefined) return process.env.FORCE_COLOR !== '0';
  return stream.isTTY === true;
}

const STATUS_TONE: Record<RunStatus, 'ok' | 'warn' | 'error'> = {
  done: 'ok',
  rejected: 'warn',
  refused: 'warn',
  truncated: 'warn',
  budget_exceeded: 'warn',
  stopped: 'warn',
  error: 'error',
};

function tokens(usage: Usage): string {
  const cached = usage.cachedInputTokens ? ` (${formatCount(usage.cachedInputTokens)} cached)` : '';
  return `${formatCount(usage.inputTokens)} in${cached} / ${formatCount(usage.outputTokens)} out`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** How an entry reads in the terminal, and at which level (null: file only). */
export function describeEntry(
  entry: AgentLogEntry,
): (Omit<LogLine, 'scope' | 'time'> & { level: LineLevel }) | null {
  switch (entry.type) {
    case 'run_start': {
      const note = [
        entry.model,
        entry.attachments ? plural(entry.attachments, 'file') : null,
        entry.skills.length ? `skills: ${entry.skills.join(', ')}` : null,
      ].filter(Boolean);
      return {
        level: 'info',
        icon: '▶',
        text: [{ text: `"${truncate(entry.prompt || '(files only)', 60)}"`, tone: 'strong' }],
        note: note.join(' · '),
      };
    }
    case 'route':
      return {
        level: 'info',
        icon: '◇',
        text: entry.mode === 'plan' ? `plan · ${plural(entry.steps, 'step')}` : 'answer directly',
        note: truncate(entry.reason, 70),
      };
    case 'model_call': {
      const asked = entry.toolCalls.length
        ? `→ ${truncate(entry.toolCalls.join(', '), 40)}`
        : entry.finishReason === 'length'
          ? '→ cut off'
          : '→ answer';
      return {
        level: 'debug',
        icon: '·',
        text: `${entry.kind} ${entry.kind === 'step' ? asked : ''}`.trimEnd(),
        note: [entry.model, formatDuration(entry.durationMs), tokens(entry.usage)]
          .filter(Boolean)
          .join(' · '),
      };
    }
    case 'tool': {
      const args = describeArgs(entry.args, 44);
      const outcome: Segment = entry.ok ? { text: '✓', tone: 'ok' } : { text: '✗', tone: 'error' };
      const detail = entry.ok
        ? `${formatCount(entry.chars)} chars`
        : truncate(entry.error ?? 'failed', 60);
      return {
        level: 'info',
        icon: '▸',
        text: [{ text: entry.name, tone: 'accent' }, args ? `  ${args}` : ''],
        note: [
          outcome,
          ` ${formatDuration(entry.durationMs)} · ${detail}`,
          ...(entry.isRepeat ? [{ text: ' · repeated', tone: 'warn' as const }] : []),
        ],
      };
    }
    case 'plan_check':
      return {
        level: 'info',
        icon: '↺',
        text: `check: ${plural(entry.open, 'plan step')} still open`,
      };
    case 'subagent_start':
      return {
        level: 'info',
        icon: '┌',
        text: [{ text: `sub-agent "${truncate(entry.label, 40)}"`, tone: 'strong' }],
        note: entry.specialist,
      };
    case 'subagent_end':
      return {
        level: 'info',
        icon: '└',
        text: `sub-agent "${truncate(entry.label, 40)}"`,
        note: [
          { text: entry.status, tone: STATUS_TONE[entry.status] },
          ` · ${formatDuration(entry.durationMs)}`,
        ],
      };
    case 'review':
      return {
        level: 'info',
        icon: '◎',
        text: ['review: ', { text: entry.verdict, tone: entry.verdict === 'pass' ? 'ok' : 'warn' }],
        note: entry.issues.length ? plural(entry.issues.length, 'issue') : '',
        body: entry.issues.length
          ? entry.issues.map((issue) => `- ${issue}`).join('\n')
          : undefined,
      };
    case 'compaction':
      return {
        level: 'info',
        icon: '⇣',
        text: `summarized ${plural(entry.summarized, 'earlier message')}`,
        note: `${formatCount(entry.tokensBefore)} → ${formatCount(entry.tokensAfter)} tokens`,
      };
    case 'steer':
      return {
        level: 'info',
        icon: '✎',
        text: `user added: "${truncate(entry.text, 60)}"`,
      };
    case 'run_end':
      return {
        level: 'info',
        icon: '■',
        text: [{ text: entry.status.replace('_', ' '), tone: STATUS_TONE[entry.status] }],
        note: [
          plural(entry.steps, 'step'),
          plural(entry.tools, 'tool'),
          formatDuration(entry.durationMs),
          tokens(entry.usage),
        ].join(' · '),
      };
    case 'run_failed':
      return { level: 'error', text: `run failed: ${entry.error}` };
  }
}

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, silent: 3 };
const LINE_RANK: Record<LineLevel, number> = { debug: 0, info: 1, warn: 2, error: 2, fatal: 2 };

export function createLogger({
  level = 'info',
  logDir,
  sessionName = 'session',
  color = supportsColor(process.stderr),
  write = (line) => process.stderr.write(`${line}\n`),
}: LoggerOptions = {}): AgentLogger {
  let file: string | null = null;
  if (logDir) {
    fs.mkdirSync(logDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    file = path.join(logDir, `${sessionName}-${stamp}.jsonl`);
  }
  const currentLevel = typeof level === 'function' ? level : () => level;

  const make = (scope: string[]): AgentLogger => {
    const toFile = (data: object) => {
      if (!file) return;
      const record = { time: new Date().toISOString(), scope: scope.join('/'), ...data };
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
    };
    const print = (line: Omit<LogLine, 'scope'>) => {
      if (LINE_RANK[line.level] < RANK[currentLevel()]) return;
      write(formatLine({ ...line, scope: scope.length ? scope : ['agent'] }, { color }));
    };
    return {
      file,
      record(entry) {
        toFile(entry);
        const line = describeEntry(entry);
        if (line) print(line);
      },
      warn(text, data = {}) {
        toFile({ type: 'warning', message: text, ...data });
        print({ level: 'warn', text });
      },
      error(text, data = {}) {
        toFile({ type: 'error', message: text, ...data });
        print({ level: 'error', text });
      },
      scoped: (name) => make([...scope, name]),
    };
  };
  return make([]);
}

/** A logger that drops everything (tests, or when nothing should be logged). */
export const silentLogger: AgentLogger = {
  file: null,
  record() {},
  warn() {},
  error() {},
  scoped: () => silentLogger,
};
