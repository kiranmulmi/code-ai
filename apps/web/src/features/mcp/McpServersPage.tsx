import { Link, useLocation, useNavigate } from 'react-router-dom';
import { mcpTransportOf, type McpServerEntry } from '@app/shared';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { PageLoader } from '../../components/PageLoader';
import { TopbarActions, usePageHeader } from '../../layout/pageHeader';
import { errorMessage } from '../../lib/api';
import { APP_NAME } from '../../lib/brand';
import { PlusIcon, ServerIcon } from '../../lib/icons';
import { fromPath } from '../../lib/routerState';
import { useAsync } from '../../lib/useAsync';
import { SettingsTabs } from '../settings/SettingsTabs';
import { fetchMcpServers } from './api';

const LIST_PATH = '/settings/mcp';

/** What a server runs: its URL, or its command line. */
function target({ server }: McpServerEntry): string {
  return server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(' ');
}

/**
 * `/settings/mcp`: the MCP servers set up for the whole app. Each workspace turns them on or
 * off in its MCP tab; a new server is off everywhere until then.
 */
export function McpServersPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const servers = useAsync(fetchMcpServers);
  const backTo = fromPath(location.state) ?? '/';

  usePageHeader({
    title: 'Settings',
    subtitle:
      'MCP servers give the agent more tools. Set them up once here, then turn them on in each workspace’s MCP tab.',
    breadcrumbs: [{ label: APP_NAME, to: backTo }, { label: 'Settings' }],
  });

  const addServer = () => navigate(`${LIST_PATH}/new`, { state: { from: LIST_PATH } });
  const list = servers.data;

  return (
    <div className="w-full">
      <SettingsTabs />
      <TopbarActions>
        <Button variant="primary" onClick={addServer}>
          <PlusIcon /> Add server
        </Button>
      </TopbarActions>

      {!list && servers.error ? (
        <p
          role="alert"
          className="rounded-xl border border-l-4 border-line border-l-danger-line bg-danger-bg px-4 py-3 text-[13px] text-danger"
        >
          {errorMessage(servers.error, "Couldn't load the MCP servers.")}
        </p>
      ) : !list ? (
        <PageLoader />
      ) : list.length === 0 ? (
        <div className="panel flex flex-col items-center px-4 py-8 text-center">
          <span className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent">
            <ServerIcon size={22} />
          </span>
          <h2 className="text-[16px] font-bold text-ink">No MCP servers yet</h2>
          <p className="mb-5 mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-ink-3">
            MCP servers give the agent more tools, like GitHub, Jira, a database or a browser. Add
            one with its command or URL, then turn it on in the workspaces that need it.
          </p>
          <Button variant="primary" onClick={addServer}>
            <PlusIcon /> Add your first server
          </Button>
        </div>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((entry) => {
            const transport = mcpTransportOf(entry.server);
            const autoApproved = entry.server.autoApprove?.length ?? 0;
            return (
              <li
                key={entry.name}
                className="flex min-w-0 items-center gap-x-2 rounded-lg border border-line bg-surface px-2 py-1 transition-colors hover:border-line-strong"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface-2 text-ink-3">
                  <ServerIcon size={12} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                    <span className="truncate font-mono text-[12px] font-medium text-ink">
                      {entry.name}
                    </span>
                    <Badge>{transport === 'stdio' ? 'local' : transport}</Badge>
                    {autoApproved > 0 && (
                      <span
                        title={`${autoApproved} tool${autoApproved === 1 ? '' : 's'} always allowed`}
                      >
                        <Badge tone="yellow">{autoApproved} auto</Badge>
                      </span>
                    )}
                  </div>
                  <p
                    className="truncate font-mono text-[10.5px] leading-tight text-ink-3"
                    title={target(entry)}
                  >
                    {target(entry)}
                  </p>
                </div>
                <Link
                  to={`${LIST_PATH}/${encodeURIComponent(entry.name)}/edit`}
                  state={{ from: LIST_PATH }}
                  className="ml-auto inline-flex h-6 shrink-0 items-center rounded-md border border-line bg-surface px-2 text-[11.5px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-subtle"
                >
                  Edit
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
