import {
  mcpTransportOf,
  TOOL_GROUPS,
  TOOL_GROUP_LABELS,
  type McpServerEntry,
  type ToolGroup,
} from '@app/shared';
import { Switch } from '../../components/Switch';
import { EditIcon } from '../../lib/icons';

const TRANSPORT_LABEL = { stdio: 'Local', http: 'HTTP', sse: 'SSE' } as const;

const LIST = 'mt-2 divide-y divide-line-2 overflow-hidden rounded-xl border border-line bg-surface';

/** One switch per tool group; on unless turned off. */
export function ToolGroupSwitches({
  disabled,
  onChange,
}: {
  disabled: readonly ToolGroup[];
  onChange: (disabled: ToolGroup[]) => void;
}) {
  return (
    <ul className={LIST}>
      {TOOL_GROUPS.map((group) => {
        const isOn = !disabled.includes(group);
        const { label, detail } = TOOL_GROUP_LABELS[group];
        return (
          <li key={group} className="flex items-center gap-3 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <div className={`text-[13.5px] font-medium ${isOn ? 'text-ink' : 'text-ink-3'}`}>
                {label}
              </div>
              <div className="text-[12.5px] leading-snug text-ink-3">{detail}</div>
            </div>
            <Switch
              isOn={isOn}
              label={`${label} tools`}
              title={isOn ? `Turn off the ${label} tools` : `Turn on the ${label} tools`}
              onChange={(next) =>
                onChange(
                  next
                    ? disabled.filter((item) => item !== group)
                    : TOOL_GROUPS.filter((item) => item === group || disabled.includes(item)),
                )
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

/** One switch per optional side panel tab, in the same list style as the tool switches. */
export function PanelTabSwitches({
  tabs,
}: {
  tabs: ReadonlyArray<{
    label: string;
    detail: string;
    isOn: boolean;
    onChange: (isOn: boolean) => void;
  }>;
}) {
  return (
    <ul className={LIST}>
      {tabs.map(({ label, detail, isOn, onChange }) => (
        <li key={label} className="flex items-center gap-3 px-3.5 py-2.5">
          <div className="min-w-0 flex-1">
            <div className={`text-[13.5px] font-medium ${isOn ? 'text-ink' : 'text-ink-3'}`}>
              {label}
            </div>
            <div className="text-[12.5px] leading-snug text-ink-3">{detail}</div>
          </div>
          <Switch
            isOn={isOn}
            label={`${label} tab`}
            title={isOn ? `Hide the ${label} tab` : `Show the ${label} tab`}
            onChange={onChange}
          />
        </li>
      ))}
    </ul>
  );
}

/** How a server starts: its command line (local) or its URL (HTTP/SSE). */
function launchOf(server: McpServerEntry['server']): string {
  return mcpTransportOf(server) === 'stdio'
    ? [server.command ?? '', ...(server.args ?? [])].join(' ')
    : (server.url ?? '');
}

/**
 * One tile per MCP server set up in the app, each with its switch; off here until turned on.
 * `query` only hides tiles: switching one still keeps the hidden servers' choices.
 */
export function McpServerSwitches({
  servers,
  enabled,
  onChange,
  onEdit,
  query = '',
}: {
  servers: readonly McpServerEntry[];
  enabled: readonly string[];
  onChange: (enabled: string[]) => void;
  /** shows an edit button on each tile */
  onEdit?: (name: string) => void;
  /** filters the tiles by name, transport or command/URL */
  query?: string;
}) {
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? servers.filter(({ name, server }) =>
        [name, TRANSPORT_LABEL[mcpTransportOf(server)], launchOf(server)]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    : servers;

  if (shown.length === 0) {
    return (
      <div className="mt-2 rounded-xl border border-dashed border-line px-3.5 py-6 text-center text-[13px] text-ink-3">
        No servers match “{query.trim()}”.
      </div>
    );
  }

  return (
    <ul className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {shown.map(({ name, server }) => {
        const isOn = enabled.includes(name);
        const launch = launchOf(server);
        return (
          <li
            key={name}
            className={`group flex min-w-0 flex-col gap-2 rounded-xl border px-3.5 py-3 transition-colors ${
              isOn ? 'border-line bg-accent-soft' : 'border-line bg-surface hover:bg-subtle'
            }`}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate font-mono text-[13px] font-medium ${isOn ? 'text-ink' : 'text-ink-2'}`}
                  title={name}
                >
                  {name}
                </div>
                <span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-ink-3">
                  {TRANSPORT_LABEL[mcpTransportOf(server)]}
                </span>
              </div>
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(name)}
                  aria-label={`Edit ${name}`}
                  title="Edit (for every workspace)"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-3 opacity-0 transition hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <EditIcon size={13} />
                </button>
              )}
              <Switch
                isOn={isOn}
                label={`MCP server ${name}`}
                title={isOn ? `Turn ${name} off here` : `Turn ${name} on here`}
                onChange={(next) =>
                  onChange(
                    servers
                      .map((entry) => entry.name)
                      .filter((item) => (item === name ? next : enabled.includes(item))),
                  )
                }
              />
            </div>
            <div
              className="line-clamp-2 break-all font-mono text-[11.5px] leading-snug text-ink-3"
              title={launch}
            >
              {launch}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
