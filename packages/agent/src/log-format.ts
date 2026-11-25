// How every log line looks in the terminal, for the agent and the API alike. One line per
// thing that happened, in columns that line up:
//
//   14:02:40  c57da5a3     ▶ run "fix the login bug"            gpt-4.1 · 2 files
//   14:02:42  c57da5a3     ▸ read_file src/auth.ts              ✓ 12ms · 4.2k chars
//   14:02:43  http         GET    /chats/c57da5a3…              200   78ms
//
// time · who (a chat, a sub-agent, http, server) · what happened · dim details on the right.

export type LineLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type Tone = 'plain' | 'muted' | 'accent' | 'ok' | 'warn' | 'error' | 'strong';

/** A piece of a line: plain text, or text in a tone. */
export type Segment = string | { text: string; tone: Tone };

export interface LogLine {
  time?: Date;
  level: LineLevel;
  /** Who it's about, outermost first: ['c57da5a3', 'researcher']. */
  scope: string[];
  /** One symbol in front of the text (▶ ▸ ◆ ■ …); warn/error lines get theirs by default. */
  icon?: string;
  text: Segment[] | string;
  /** Secondary details, shown dim after the text. */
  note?: Segment[] | string;
  /** Extra lines (a stack trace, a list), indented under the line. */
  body?: string;
}

export interface FormatOptions {
  color: boolean;
}

const ANSI: Record<Tone | 'time' | 'scope0' | 'scope1' | 'scope2' | 'scope3', [number, number]> = {
  plain: [0, 0],
  muted: [2, 22],
  accent: [36, 39],
  ok: [32, 39],
  warn: [33, 39],
  error: [31, 39],
  strong: [1, 22],
  time: [2, 22],
  scope0: [35, 39],
  scope1: [34, 39],
  scope2: [36, 39],
  scope3: [33, 39],
};

/** Wide enough for a chat id and a sub-agent: `c57da5a3 › researcher`. */
const SCOPE_WIDTH = 22;
const TEXT_WIDTH = 46;
const LEVEL_ICON: Partial<Record<LineLevel, { icon: string; tone: Tone }>> = {
  warn: { icon: '▲', tone: 'warn' },
  error: { icon: '✖', tone: 'error' },
  fatal: { icon: '✖', tone: 'error' },
};

function paint(text: string, tone: keyof typeof ANSI, color: boolean): string {
  const [open, close] = ANSI[tone];
  return color && open ? `\x1b[${open}m${text}\x1b[${close}m` : text;
}

function segments(value: Segment[] | string | undefined): Segment[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

function plainLength(parts: Segment[]): number {
  return parts.reduce((sum, part) => sum + (typeof part === 'string' ? part : part.text).length, 0);
}

function render(parts: Segment[], color: boolean, base: Tone = 'plain'): string {
  return parts
    .map((part) =>
      typeof part === 'string' ? paint(part, base, color) : paint(part.text, part.tone, color),
    )
    .join('');
}

/** The same scope always gets the same colour, so lines of one chat are easy to follow. */
function scopeTone(name: string): keyof typeof ANSI {
  if (name === 'http') return 'scope1';
  if (name === 'server') return 'scope2';
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (['scope0', 'scope3', 'scope2', 'scope1'] as const)[hash % 4] ?? 'scope0';
}

export function clockTime(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

export function formatLine(line: LogLine, { color }: FormatOptions): string {
  const time = paint(clockTime(line.time ?? new Date()), 'time', color);
  const scopeText = line.scope.join(' › ') || '-';
  const scope = line.scope.length
    ? line.scope
        .map((name) => paint(name, scopeTone(name), color))
        .join(paint(' › ', 'muted', color))
    : paint('-', 'muted', color);
  const scopePad = ' '.repeat(Math.max(1, SCOPE_WIDTH + 1 - scopeText.length));

  const levelIcon = LEVEL_ICON[line.level];
  const iconText = line.icon ?? levelIcon?.icon;
  const iconTone: Tone = levelIcon?.tone ?? 'accent';
  const icon = iconText ? `${paint(iconText, iconTone, color)} ` : '';
  const textTone: Tone =
    line.level === 'debug'
      ? 'muted'
      : line.level === 'info'
        ? 'plain'
        : (levelIcon?.tone ?? 'plain');
  const text = segments(line.text);
  const note = segments(line.note).filter((part) => (typeof part === 'string' ? part : part.text));
  const used = (iconText ? iconText.length + 1 : 0) + plainLength(text);
  const gap = note.length ? ' '.repeat(Math.max(2, TEXT_WIDTH - used)) : '';

  let out = `${time}  ${scope}${scopePad}${icon}${render(text, color, textTone)}${gap}${render(note, color, 'muted')}`;
  if (line.body) {
    const indent = ' '.repeat(8 + 2 + SCOPE_WIDTH + 1 + 2);
    const body = line.body
      .trimEnd()
      .split('\n')
      .map((row) => indent + paint(row.trimStart() ? `│ ${row}` : '│', 'muted', color))
      .join('\n');
    out += `\n${body}`;
  }
  return out;
}

// ---- small formatters shared by the agent and the API ----

const UUID = /\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** A UUID shortened to its first 8 characters: enough to tell chats apart in a log. */
export function shortId(id: string): string {
  return id.replace(UUID, '$1');
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Arguments the reader cares about first, when a tool has one obvious subject. */
const KEY_ARGS = [
  'path',
  'command',
  'query',
  'url',
  'pattern',
  'name',
  'label',
  'task',
  'question',
];

/** A tool call's arguments in a few words: its main value, else compact key=value pairs. */
export function describeArgs(raw: string, max = 60): string {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    return truncate(raw, max);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return truncate(String(raw), max);
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  const key = KEY_ARGS.find(
    (name) => typeof (parsed as Record<string, unknown>)[name] === 'string',
  );
  if (key) return truncate(String((parsed as Record<string, unknown>)[key]), max);
  const pairs = entries.map(([name, value]) => {
    const shown = typeof value === 'string' ? value : JSON.stringify(value);
    return `${name}=${truncate(shown ?? '', 24)}`;
  });
  return truncate(pairs.join(' '), max);
}
