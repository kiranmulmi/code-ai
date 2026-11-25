import {
  formatDuration,
  formatLine,
  shortId,
  type LineLevel,
  type LogLine,
  type Segment,
} from '@app/agent';

/**
 * Turns pino's JSON lines into the app's readable log lines (see log-format in @app/agent):
 *
 *   14:02:43  http         GET    /chats/c57da5a3                 200   78ms
 *   14:02:44  http         POST   /chats/c57da5a3/runs            500   12ms  boom
 *   14:02:40  server       ✓ ready at http://localhost:4000      web app · sign-in off
 *
 * `LOG_FORMAT=json` skips this and keeps pino's JSON, for piping to a log tool.
 */
const PINO_LEVELS: Record<number, LineLevel> = {
  10: 'debug',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

/** Fields pino adds to every line that a reader doesn't need. */
const NOISE = new Set(['level', 'time', 'pid', 'hostname', 'msg', 'v']);

/** Requests slower than this are flagged. */
const SLOW_MS = 1000;

interface PinoError {
  message?: string;
  stack?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The API path without the /v1 prefix, its UUIDs shortened. */
export function displayPath(url: string): string {
  return shortId(url.replace(/^\/v1(?=\/|$)/, '') || '/');
}

function statusTone(status: number): 'ok' | 'muted' | 'warn' | 'error' {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  if (status === 304) return 'muted';
  return 'ok';
}

function errorBody(err: unknown): string | undefined {
  if (!isRecord(err)) return undefined;
  const { stack } = err as PinoError;
  // The stack's first line repeats the message; the frames are what's new.
  return stack?.split('\n').slice(1).join('\n') || undefined;
}

function httpLine(entry: Record<string, unknown>, level: LineLevel): Omit<LogLine, 'time'> | null {
  const { req, res } = entry;
  if (!isRecord(req) || !isRecord(res)) return null;
  const method = String(req.method ?? '?');
  const status = Number(res.statusCode ?? 0);
  const ms = Number(entry.responseTime ?? 0);
  const err = isRecord(entry.err) ? (entry.err as PinoError) : null;
  const note: Segment[] = [
    { text: String(status).padEnd(4), tone: statusTone(status) },
    { text: formatDuration(ms).padStart(6), tone: ms >= SLOW_MS ? 'warn' : 'muted' },
  ];
  if (err?.message) note.push({ text: `  ${err.message}`, tone: 'error' });
  return {
    level,
    scope: ['http'],
    text: [{ text: method.padEnd(6), tone: 'strong' }, ' ', displayPath(String(req.url ?? ''))],
    note,
    body: level === 'error' ? errorBody(entry.err) : undefined,
  };
}

/** Any other line: the message, then its other fields as key=value. */
function messageLine(entry: Record<string, unknown>, level: LineLevel): Omit<LogLine, 'time'> {
  const fields = Object.entries(entry)
    .filter(([key]) => !NOISE.has(key) && key !== 'err')
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
  const err = isRecord(entry.err) ? (entry.err as PinoError) : null;
  const msg = typeof entry.msg === 'string' ? entry.msg : '';
  const text = err?.message && !msg.includes(err.message) ? `${msg}: ${err.message}` : msg;
  return {
    level,
    scope: ['server'],
    text,
    note: fields.join('  '),
    body: err ? errorBody(entry.err) : undefined,
  };
}

/** One pino JSON line as a readable line; text that isn't JSON passes through. */
export function prettyLogLine(json: string, color: boolean): string {
  let entry: unknown;
  try {
    entry = JSON.parse(json);
  } catch {
    return json;
  }
  if (!isRecord(entry)) return json;
  const level = PINO_LEVELS[Number(entry.level)] ?? 'info';
  const line = httpLine(entry, level) ?? messageLine(entry, level);
  const time = typeof entry.time === 'number' ? new Date(entry.time) : new Date();
  return formatLine({ ...line, time }, { color });
}

/** A pino destination writing readable lines to `out`. */
export function prettyStream(
  out: NodeJS.WriteStream,
  color: boolean,
): { write(chunk: string): void } {
  return {
    write(chunk) {
      for (const json of chunk.split('\n')) {
        if (json.trim()) out.write(`${prettyLogLine(json, color)}\n`);
      }
    },
  };
}
