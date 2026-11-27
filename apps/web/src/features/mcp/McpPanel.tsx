import { useCallback, useEffect, useState } from 'react';
import type { McpOverview } from '@app/shared';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Spinner } from '../../components/Spinner';
import { errorMessage } from '../../lib/api';
import { PlusIcon, RefreshIcon, ServerIcon, ShieldIcon } from '../../lib/icons';
import { useToast } from '../../lib/toast';
import { useAsync } from '../../lib/useAsync';
import { approveMcpConfig, fetchMcpOverview, patchMcpServer, restartMcpServer } from './api';
import { onWorkspaceSaved } from '../workspaces/workspaceEvents';
import { McpServerRow } from './McpServerRow';
import { ChooseMcpServersModal } from './ChooseMcpServersModal';
import { McpServerFormModal } from './McpServerFormModal';
import { EmptyHero, SectionHeader, SectionNote, SectionPage } from '../customize/SectionLayout';

/**
 * The MCP servers page (Customize tab): the servers this workspace uses, a summary of their
 * state, and each one's tools. Mounted only while the tab is open, since loading it starts the servers.
 */
export function McpPanel({
  workspaceId,
  isBusy,
  onChange,
  pluginNames,
  onOpenTools,
}: {
  workspaceId: string;
  isBusy: boolean;
  /** the servers that are the user's own tool plugins (edited on the Tools page) */
  pluginNames?: ReadonlySet<string>;
  /** opens the Tools page */
  onOpenTools?: () => void;
  /** after a server was turned on or off, approved or restarted (the tab counts) */
  onChange?: () => void;
}) {
  const toast = useToast();
  const load = useCallback(() => fetchMcpOverview(workspaceId), [workspaceId]);
  const overview = useAsync(load);
  const [pending, setPending] = useState<string | null>(null);
  const [isChooserOpen, setIsChooserOpen] = useState(false);
  const closeChooser = useCallback(() => setIsChooserOpen(false), []);
  const [editing, setEditing] = useState<string | null>(null);
  const closeEditor = useCallback(() => setEditing(null), []);
  const { data, setData, reload } = overview;
  // The workspace form (a popup over this screen) may have turned servers on or off.
  useEffect(() => onWorkspaceSaved(reload), [reload]);

  const save = async (key: string, action: () => Promise<McpOverview>, message: string) => {
    setPending(key);
    try {
      const next = await action();
      setData(() => next);
      onChange?.();
      toast(message);
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't change the MCP servers."), 'error');
    } finally {
      setPending(null);
    }
  };

  const chooseServers = (
    <Button variant="primary" onClick={() => setIsChooserOpen(true)}>
      <PlusIcon size={12} /> Add or choose servers
    </Button>
  );

  // The servers this workspace uses (chosen in Choose servers), on or off, so one turned off
  // here can be turned back on; the ones on come first.
  const servers = [...(data?.servers ?? [])].sort(
    (a, b) => Number(a.state === 'disabled') - Number(b.state === 'disabled'),
  );
  const tally = {
    running: servers.filter((server) => server.state === 'connected').length,
    attention: servers.filter((server) => server.state === 'error' || server.state === 'untrusted')
      .length,
    off: servers.filter((server) => server.state === 'disabled').length,
    tools: servers.reduce((sum, server) => sum + server.tools.length, 0),
  };
  const needsReview = data !== null && !data.isTrusted && data.fileError === null;

  return (
    <SectionPage>
      <SectionHeader
        icon={<ServerIcon size={18} />}
        title="MCP servers"
        description="Connect the agent to outside apps and data, like GitHub, a database or a browser. Servers are shared by every workspace but only run where they're switched on."
        actions={
          <>
            <IconButton
              onClick={overview.reload}
              disabled={overview.isLoading}
              aria-label="Check the servers again"
              title="Check the servers again"
              className="h-9 w-9 border border-line"
            >
              {overview.isLoading ? <Spinner size={13} /> : <RefreshIcon />}
            </IconButton>
            {chooseServers}
          </>
        }
      />

      {!data ? (
        overview.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-[13px] text-ink-3">
            <Spinner /> Starting MCP servers…
          </div>
        ) : (
          <div
            role="alert"
            className="flex flex-col items-start gap-2 rounded-xl border border-l-[3px] border-line border-l-danger-line bg-danger-bg px-4 py-3 text-[13px] text-danger"
          >
            {errorMessage(overview.error, "Couldn't load the MCP servers.")}
            <Button size="sm" onClick={overview.reload}>
              Try again
            </Button>
          </div>
        )
      ) : (
        <>
          {data.fileError && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-l-[3px] border-line border-l-danger-line bg-danger-bg px-4 py-3 text-[13px]"
            >
              <div className="font-bold text-danger">Can&apos;t read mcp.json</div>
              <p className="mt-1 text-ink-2 [overflow-wrap:anywhere]">{data.fileError}</p>
              <p className="mt-1 text-ink-3">Fix the file, then check the servers again.</p>
            </div>
          )}

          {needsReview && (
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-l-[3px] border-line border-l-warn-line bg-warn-bg px-4 py-3 sm:flex-row sm:items-center">
              <ShieldIcon size={18} className="shrink-0 text-warn" />
              <div className="min-w-0 flex-1">
                <div className="font-bold text-ink">Review these servers before they start</div>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">
                  mcp.json changed outside this app, or came with the folder. Local servers run
                  commands on your computer, so check each one below.
                </p>
              </div>
              <Button
                variant="primary"
                disabled={isBusy || pending !== null}
                title={isBusy ? 'Wait for the agent to finish' : undefined}
                onClick={() =>
                  void save('approve', () => approveMcpConfig(workspaceId), 'MCP servers approved')
                }
              >
                {pending === 'approve' && <Spinner size={12} />}
                Approve and start
              </Button>
            </div>
          )}

          {servers.length === 0 && !data.fileError ? (
            <EmptyHero
              icon={<ServerIcon size={20} />}
              title="No MCP servers in this workspace"
              actions={chooseServers}
            >
              MCP servers give the agent more tools. Add a new one, or switch on one you already use
              in another workspace.
            </EmptyHero>
          ) : (
            <>
              <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Running" value={tally.running} tone="success" />
                <Stat
                  label="Need attention"
                  value={tally.attention}
                  tone={tally.attention ? 'warn' : 'none'}
                />
                <Stat label="Off here" value={tally.off} tone="none" />
                <Stat label="Tools available" value={tally.tools} tone="none" />
              </dl>
              <ul className="panel divide-y divide-line-2 overflow-hidden">
                {servers.map((server) => (
                  <McpServerRow
                    key={server.name}
                    server={server}
                    isBusy={isBusy}
                    pending={pending}
                    isPlugin={pluginNames?.has(server.name) ?? false}
                    onOpenTools={onOpenTools}
                    onToggle={(isOn) =>
                      void save(
                        `toggle:${server.name}`,
                        () => patchMcpServer(workspaceId, server.name, { enabled: isOn }),
                        isOn ? `${server.name} turned on` : `${server.name} turned off`,
                      )
                    }
                    onEdit={() => setEditing(server.name)}
                    onRestart={() =>
                      void save(
                        `restart:${server.name}`,
                        () => restartMcpServer(workspaceId, server.name),
                        `${server.name} restarted`,
                      )
                    }
                    onAutoApprove={(tool, isOn) => {
                      const current = server.config.autoApprove ?? [];
                      const autoApprove = isOn
                        ? [...current, tool]
                        : current.filter((name) => name !== tool);
                      void save(
                        `tool:${server.name}`,
                        () => patchMcpServer(workspaceId, server.name, { autoApprove }),
                        isOn ? `${tool} runs without asking` : `${tool} asks before it runs`,
                      );
                    }}
                  />
                ))}
              </ul>
            </>
          )}

          <SectionNote>
            Open a server&apos;s tools to let one run without asking (Always allow, for that tool
            everywhere). Editing a server changes it in every workspace that uses it. Saved in{' '}
            <span className="font-mono [overflow-wrap:anywhere]">{data.file}</span>.
          </SectionNote>
        </>
      )}

      {isChooserOpen && (
        <ChooseMcpServersModal
          workspaceId={workspaceId}
          onClose={closeChooser}
          onSaved={onChange}
        />
      )}

      {editing && (
        <McpServerFormModal
          serverName={editing}
          onClose={closeEditor}
          onSaved={() => {
            reload();
            onChange?.();
          }}
          onDeleted={() => {
            reload();
            onChange?.();
          }}
        />
      )}
    </SectionPage>
  );
}

/** One number in the summary strip over the list. */
function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'success' | 'warn' | 'none';
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3.5 py-2.5">
      <dt className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-3">
        {tone !== 'none' && (
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${tone === 'success' ? 'bg-success-line' : 'bg-warn-line'}`}
          />
        )}
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-extrabold tabular-nums text-ink">{value}</dd>
    </div>
  );
}
