import { useMemo, useState, type ReactNode } from 'react';
import type { CommandFileChange, CommandFiles } from '@app/shared';
import { CodeHighlight } from '../../components/CodeHighlight';
import { CodeText } from '../../components/CodeText';
import { CopyButton } from '../../components/CopyButton';
import { prettyJson } from '../../lib/format';
import { ExpandIcon, FileTintIcon } from '../../lib/icons';
import { languageForPath } from '../../lib/languages';
import { fileTint } from '../panel/files/fileTint';
import type { ToolItem } from './conversation';
import { ToolInput } from './ToolInput';

type Tab = 'result' | 'input' | 'files';

/** read_file's header on a partial read: "[path: lines 1-200 of 333. …]". */
const READ_HEADER = /^\[[^\n]*: lines (\d+-\d+ of \d+)\.[^\n]*\]\n/;
/** run_command's status line: "exit code 0 · 0.1s", "killed by SIGTERM · 2.0s", … */
const EXIT_CODE = /^exit code (-?\d+)(?: · (.+))?$/;

/** The `path` argument of a call, if it has one. */
function pathArg(args: string): string | null {
  try {
    const parsed: unknown = JSON.parse(args);
    const path =
      typeof parsed === 'object' && parsed !== null ? (parsed as { path?: unknown }).path : null;
    return typeof path === 'string' ? path : null;
  } catch {
    return null;
  }
}

type Status = { tone: 'ok' | 'bad' | 'muted'; text: string };

/**
 * A result split for display. run_command repeats its command, status and file lists at the
 * top of its result; those already have a home (the Input tab, the status, the Files tab), so
 * only the output shows. A partial file read gets its line range as the status.
 */
interface ResultView {
  body: string;
  status: Status | null;
  language: string | null;
}

function viewOf(item: ToolItem): ResultView {
  const { result } = item;
  if (item.state === 'error') return { body: result, status: null, language: null };
  if (item.name === 'run_command' && result.startsWith('$ ')) {
    const split = result.indexOf('\n\n');
    const header = (split === -1 ? result : result.slice(0, split)).split('\n');
    const body = split === -1 ? '' : result.slice(split + 2);
    const line = header[1] ?? '';
    const exit = EXIT_CODE.exec(line);
    const status: Status | null = exit
      ? {
          tone: exit[1] === '0' ? 'ok' : 'bad',
          text: `exit ${exit[1]}${exit[2] ? ` · ${exit[2]}` : ''}`,
        }
      : line
        ? { tone: /^running/.test(line) ? 'muted' : 'bad', text: line.split(';')[0] ?? line }
        : null;
    return { body, status, language: null };
  }
  const path = item.name === 'read_file' ? pathArg(item.args) : null;
  const language = path ? languageForPath(path) : null;
  const header = READ_HEADER.exec(result);
  if (header) {
    return {
      body: result.slice(header[0].length),
      status: { tone: 'muted', text: `lines ${header[1]}` },
      language,
    };
  }
  return { body: result, status: null, language };
}

const lineCount = (text: string) => (text ? text.replace(/\n$/, '').split('\n').length : 0);

/** The output itself: code coloured for its file type, JSON coloured, anything else plain. */
function ResultBody({
  view,
  isError,
  isExpanded,
}: {
  view: ResultView;
  isError: boolean;
  isExpanded: boolean;
}) {
  const text = useMemo(
    () => (view.language || isError ? view.body : prettyJson(view.body)),
    [view, isError],
  );
  if (!text.trim()) {
    return <p className="py-1 text-[12px] italic text-ink-4">No output.</p>;
  }
  return (
    <pre
      className={`overflow-auto whitespace-pre-wrap py-0.5 font-mono text-[12px] leading-[1.65] [overflow-wrap:anywhere] ${
        isExpanded ? '' : 'max-h-[300px]'
      } ${isError ? 'text-danger' : 'text-ink-2'}`}
    >
      {view.language ? (
        <CodeHighlight code={text} language={view.language} />
      ) : (
        <CodeText text={text} />
      )}
    </pre>
  );
}

const CHANGE_LABEL: Record<CommandFileChange, { mark: string; className: string; title: string }> =
  {
    added: { mark: 'A', className: 'text-success', title: 'Created' },
    modified: { mark: 'M', className: 'text-warn', title: 'Changed' },
    deleted: { mark: 'D', className: 'text-danger', title: 'Deleted' },
  };

/** One file a command touched, as a row: how (A/M/D or read), its icon, its path. */
function FileRow({ path, change }: { path: string; change?: CommandFileChange }) {
  const label = change ? CHANGE_LABEL[change] : null;
  return (
    <li
      title={`${label ? label.title : 'Read'}: ${path}`}
      className="flex h-6 min-w-0 items-center gap-2 font-mono text-[12px] text-ink-2"
    >
      <span
        className={`w-3 shrink-0 text-center text-[10.5px] font-bold ${label ? label.className : 'text-ink-4'}`}
      >
        {label ? label.mark : '·'}
      </span>
      <FileTintIcon size={12} className={`shrink-0 ${fileTint(path).icon}`} />
      <span className={`min-w-0 truncate ${change === 'deleted' ? 'line-through' : ''}`}>
        {path}
      </span>
    </li>
  );
}

/** run_command: the files it changed (found by comparing the workspace) and read (guessed). */
function CommandFileList({ files }: { files: CommandFiles }) {
  const groups = [
    {
      title: 'Changed',
      rows: files.changed.map((entry) => (
        <FileRow key={`c:${entry.path}`} path={entry.path} change={entry.change} />
      )),
      more: files.moreChanged,
    },
    {
      title: 'Read',
      rows: files.read.map((file) => <FileRow key={`r:${file}`} path={file} />),
      more: files.moreRead,
    },
  ].filter((group) => group.rows.length > 0);
  return (
    <div className="flex flex-col gap-2.5 py-0.5">
      {groups.map((group) => (
        <section key={group.title}>
          <h4 className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-4">
            {group.title}
          </h4>
          <ul>{group.rows}</ul>
          {group.more > 0 && <p className="pl-5 text-[11px] text-ink-3">+{group.more} more</p>}
        </section>
      ))}
    </div>
  );
}

const STATUS_TONE: Record<Status['tone'], string> = {
  ok: 'bg-success',
  bad: 'bg-danger',
  muted: 'bg-ink-4',
};

/** The small line under the tabs: a status dot and text, then quiet facts. */
function MetaLine({ children }: { children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[10.5px] text-ink-3">
      {children}
    </span>
  );
}

/**
 * A tool call's details, opened under its row: no card, just a guide line in the tool's
 * colour with text tabs along the top (Result, Input, Files), a status and quick actions on
 * the right, and the content set straight on the page beneath.
 */
export function ToolDetails({
  item,
  color,
  files,
}: {
  item: ToolItem;
  /** the tool family's colour, for the guide line and the active tab */
  color: string;
  /** run_command's touched files, when it lists any */
  files: CommandFiles | null;
}) {
  const [tab, setTab] = useState<Tab>('result');
  const [isExpanded, setIsExpanded] = useState(false);
  const isRunning = item.state === 'running';
  const isError = item.state === 'error';
  const view = useMemo(() => viewOf(item), [item]);
  const fileCount = files ? files.changed.length + files.read.length : 0;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'result', label: isError ? 'Error' : 'Result' },
    { id: 'input', label: 'Input' },
    ...(fileCount ? [{ id: 'files' as const, label: 'Files', count: fileCount }] : []),
  ];
  const active = tabs.some((t) => t.id === tab) ? tab : 'result';
  const lines = lineCount(view.body);
  const copyText =
    active === 'input' ? prettyJson(item.args) : active === 'result' ? view.body : '';
  const canExpand = active === 'result' && !isRunning && lines > 14;

  return (
    <div
      className="mb-2 ml-3 mt-0.5 animate-enter border-l-2 pl-3.5 motion-reduce:animate-none"
      style={{
        borderColor: `color-mix(in srgb, ${isError ? 'var(--danger)' : color} 45%, transparent)`,
      }}
    >
      <div className="flex h-8 items-center gap-4 border-b border-line-2">
        <div
          role="tablist"
          aria-label={`${item.name} details`}
          className="flex h-full items-stretch gap-4"
        >
          {tabs.map((t) => {
            const isActive = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setTab(t.id)}
                className={`relative -mb-px flex items-center gap-1.5 border-b-2 text-[11.5px] font-semibold transition-colors ${
                  isActive ? 'text-ink' : 'border-transparent text-ink-3 hover:text-ink-2'
                }`}
                style={
                  isActive
                    ? { borderColor: isError && t.id === 'result' ? 'var(--danger)' : color }
                    : undefined
                }
              >
                {t.label}
                {t.count !== undefined && (
                  <span className="rounded-full bg-surface-2 px-1.5 text-[10px] leading-4 tabular-nums text-ink-3">
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {active === 'result' && !isRunning && (
            <MetaLine>
              {view.status && (
                <>
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_TONE[view.status.tone]}`}
                  />
                  <span className="truncate">{view.status.text}</span>
                </>
              )}
              {view.status && lines > 0 && <span className="text-ink-4">·</span>}
              {lines > 0 && (
                <span className="shrink-0">
                  {lines} {lines === 1 ? 'line' : 'lines'}
                </span>
              )}
            </MetaLine>
          )}
          {active !== 'result' && (
            <MetaLine>
              <span className="truncate text-ink-4">{item.name}</span>
            </MetaLine>
          )}
          {canExpand && (
            <button
              type="button"
              onClick={() => setIsExpanded((open) => !open)}
              aria-pressed={isExpanded}
              title={isExpanded ? 'Collapse output' : 'Show all output'}
              aria-label={isExpanded ? 'Collapse output' : 'Show all output'}
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-md transition-colors hover:bg-surface-2 hover:text-ink ${
                isExpanded ? 'text-ink' : 'text-ink-3'
              }`}
            >
              <ExpandIcon size={12} />
            </button>
          )}
          {copyText && !isRunning && (
            <CopyButton
              text={copyText}
              label={active === 'input' ? 'Copy input' : 'Copy output'}
              className="!h-6 !w-6 !rounded-md"
            />
          )}
        </div>
      </div>
      <div role="tabpanel" className="pt-2">
        {active === 'input' && <ToolInput tool={item.name} input={item.args} />}
        {active === 'files' && files && <CommandFileList files={files} />}
        {active === 'result' &&
          (isRunning ? (
            <p className="flex items-center gap-2 py-1 text-[12px] text-ink-3">
              <span aria-hidden className="live-dot scale-75" />
              Waiting for output…
            </p>
          ) : (
            <ResultBody view={view} isError={isError} isExpanded={isExpanded} />
          ))}
      </div>
    </div>
  );
}
