import { useState } from 'react';
import type { McpServerState, McpServerStatus } from '@app/shared';
import { Badge, type BadgeTone } from '../../components/Badge';
import { Spinner } from '../../components/Spinner';
import { Switch } from '../../components/Switch';
import { plural } from '../../lib/format';
import {
  ChevronRightIcon,
  EditIcon,
  RefreshIcon,
  ServerIcon,
  TerminalIcon,
  WrenchIcon,
} from '../../lib/icons';

const STATE: Record<McpServerState, { dot: string; label: string; tone: BadgeTone }> = {
  connected: { dot: 'bg-success-line', label: 'Running', tone: 'green' },
  error: { dot: 'bg-danger-line', label: "Didn't start", tone: 'red' },
  disabled: { dot: 'bg-ink-4', label: 'Off', tone: 'grey' },
  untrusted: { dot: 'bg-warn-line', label: 'Needs review', tone: 'yellow' },
};

const TRANSPORT_LABEL = { stdio: 'Local', http: 'HTTP', sse: 'SSE' } as const;

const BUSY_TITLE = 'Wait for the agent to finish';

/** Small row actions: shown on hover or focus (always on touch screens). */
const ACTION =
  'grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-3 opacity-0 transition hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed [@media(hover:none)]:opacity-100';

/** What starts the server: its command line, or its URL. */
function launchLine(server: McpServerStatus): string {
  if (server.transport !== 'stdio') return server.config.url ?? '';
  return [server.config.command ?? '', ...(server.config.args ?? [])].join(' ');
}

/**
 * One MCP server: icon with a status dot, name, state and transport badges, how it starts,
 * actions and its on/off switch. Its tools fold open as a table with "Always allow" switches.
 */
export function McpServerRow({
  server,
  isBusy,
  pending,
  onToggle,
  onRestart,
  onAutoApprove,
  onEdit,
  isPlugin = false,
  onOpenTools,
}: {
  server: McpServerStatus;
  /** one of the user's own tool plugins */
  isPlugin?: boolean;
  /** opens the Tools page */
  onOpenTools?: () => void;
  /** the agent is working in this workspace: changes wait */
  isBusy: boolean;
  /** the change being saved right now, if any */
  pending: string | null;
  onToggle: (isOn: boolean) => void;
  onRestart: () => void;
  onAutoApprove: (tool: string, isOn: boolean) => void;
  /** opens the server's form (shared by every workspace) */
  onEdit: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const state = STATE[server.state];
  const isOn = server.state !== 'disabled';
  const isLocked = isBusy || pending !== null;
  const line = launchLine(server);
  const allowedCount = server.tools.filter((tool) => tool.isAutoApproved).length;
  const canRestart = server.state === 'connected' || server.state === 'error';
  const needsReview = server.state === 'untrusted';
  const hasTools = server.tools.length > 0;
  // Variables can change what a command does (NODE_OPTIONS, PATH...), so a review shows them;
  // header values are usually tokens, so only their names.
  const envLines = [
    ...Object.entries(server.config.env ?? {}).map(([key, value]) => `env ${key}=${value}`),
    ...Object.keys(server.config.headers ?? {}).map((key) => `header ${key}: …`),
  ];
  const toolsTitle = `${plural(server.tools.length, 'tool')} · ${
    allowedCount ? `${allowedCount} always allowed` : 'each asks before it runs'
  }`;

  return (
    <li className={isOn ? '' : 'bg-subtle'}>
      <div className="group flex items-start gap-3 px-4 py-3.5">
        <span
          aria-hidden
          className={`relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
            isOn ? 'bg-accent-soft text-accent-2' : 'bg-surface-2 text-ink-3'
          }`}
        >
          {isPlugin ? <TerminalIcon size={15} /> : <ServerIcon size={15} />}
          <span
            title={state.label}
            className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface ${state.dot}`}
          />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate font-mono text-[13px] font-semibold text-ink">
              {server.name}
            </span>
            <Badge tone={state.tone} className="h-4 px-1.5 text-[10.5px]">
              {state.label}
            </Badge>
            <Badge tone="grey" className="h-4 px-1.5 text-[10.5px]">
              {TRANSPORT_LABEL[server.transport]}
            </Badge>
            {isPlugin && (
              <Badge tone="blue" className="h-4 px-1.5 text-[10.5px]">
                your tool
              </Badge>
            )}
          </div>
          <div className="mt-1 truncate font-mono text-[11.5px] text-ink-3" title={line}>
            {line}
          </div>

          {hasTools && (
            <button
              type="button"
              onClick={() => setIsOpen((open) => !open)}
              aria-expanded={isOpen}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 -ml-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <ChevronRightIcon
                size={10}
                className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}
              />
              {toolsTitle}
            </button>
          )}
        </div>

        <span className="flex shrink-0 items-center gap-1">
          {isPlugin && onOpenTools && (
            <button
              type="button"
              onClick={onOpenTools}
              className={ACTION}
              aria-label={`Open ${server.name} in Tools`}
              title="Open in Tools"
            >
              <WrenchIcon size={12} />
            </button>
          )}
          {canRestart && (
            <button
              type="button"
              onClick={onRestart}
              disabled={isLocked}
              aria-label={`Restart ${server.name}`}
              title={isBusy ? BUSY_TITLE : 'Restart the server'}
              className={ACTION}
            >
              {pending === `restart:${server.name}` ? (
                <Spinner size={11} />
              ) : (
                <RefreshIcon size={12} />
              )}
            </button>
          )}
          {isBusy ? (
            <span title={BUSY_TITLE} className={`${ACTION} cursor-not-allowed`}>
              <EditIcon size={12} />
            </span>
          ) : (
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${server.name}`}
              title="Edit (changes it in every workspace)"
              className={ACTION}
            >
              <EditIcon size={12} />
            </button>
          )}
          <span className="ml-2">
            <Switch
              isOn={isOn}
              onChange={onToggle}
              disabled={isLocked}
              label={isOn ? `Turn ${server.name} off` : `Turn ${server.name} on`}
              title={isBusy ? BUSY_TITLE : isOn ? 'Turn off here' : 'Turn on here'}
            />
          </span>
        </span>
      </div>

      {needsReview && envLines.length > 0 && (
        // Under review, show everything that decides what runs: no truncation.
        <dl className="mx-4 mb-3 ml-16 flex flex-col gap-0.5 rounded-lg bg-warn-bg px-3 py-2 font-mono text-[11.5px] text-ink-2 [overflow-wrap:anywhere]">
          <dd>{line}</dd>
          {envLines.map((entry) => (
            <dd key={entry} className="text-ink-3">
              {entry}
            </dd>
          ))}
        </dl>
      )}

      {server.error && (
        <pre className="mb-3 ml-16 mr-4 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg border-l-[3px] border-l-danger-line bg-danger-bg px-3 py-2 font-mono text-[11px] leading-relaxed text-danger [overflow-wrap:anywhere]">
          {server.error}
        </pre>
      )}

      {hasTools && isOpen && (
        <div className="mb-3 ml-16 mr-4 overflow-hidden rounded-xl border border-line-2 bg-surface">
          <div className="flex items-center justify-between border-b border-line-2 bg-subtle px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            <span>Tool</span>
            <span>Always allow</span>
          </div>
          <ul className="divide-y divide-line-2">
            {server.tools.map((tool) => (
              <li key={tool.name} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[12px] text-ink">{tool.name}</div>
                  {tool.description && (
                    <div className="truncate text-[11.5px] text-ink-3" title={tool.description}>
                      {tool.description}
                    </div>
                  )}
                </div>
                <Switch
                  isOn={tool.isAutoApproved}
                  onChange={(next) => onAutoApprove(tool.name, next)}
                  disabled={isLocked}
                  label={`Always allow ${tool.name}`}
                  title={
                    isBusy
                      ? BUSY_TITLE
                      : tool.isAutoApproved
                        ? 'Runs without asking'
                        : 'Asks before each run'
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
