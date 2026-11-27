import { useCallback, useEffect, useState } from 'react';
import type { McpOverview } from '@app/shared';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Spinner } from '../../components/Spinner';
import { errorMessage } from '../../lib/api';
import { plural } from '../../lib/format';
import { RefreshIcon, GearIcon, ShieldIcon } from '../../lib/icons';
import { useToast } from '../../lib/toast';
import { useAsync } from '../../lib/useAsync';
import { approveMcpConfig, fetchMcpOverview, patchMcpServer, restartMcpServer } from './api';
import { onWorkspaceSaved } from '../workspaces/workspaceEvents';
import { McpServerRow } from './McpServerRow';
import { ChooseMcpServersModal } from './ChooseMcpServersModal';
import { McpServerFormModal } from './McpServerFormModal';

const ADD_LINK =
  'inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-subtle';

/**
 * The MCP tab: the MCP servers turned on in this workspace (chosen in its settings) and
 * their tools. Mounted only while the tab is open, since loading it starts the servers.
 */
export function McpPanel({
  workspaceId,
  isBusy,
  onChange,
}: {
  workspaceId: string;
  isBusy: boolean;
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
    <button
      type="button"
      onClick={() => setIsChooserOpen(true)}
      title="Choose which MCP servers this workspace uses"
      className={ADD_LINK}
    >
      <GearIcon size={12} /> Choose servers
    </button>
  );

  // The servers this workspace uses (chosen in its settings), on or off, so one turned off
  // here can be turned back on; the ones on come first.
  const servers = [...(data?.servers ?? [])].sort(
    (a, b) => Number(a.state === 'disabled') - Number(b.state === 'disabled'),
  );
  const onCount = servers.filter((server) => server.state !== 'disabled').length;
  const needsReview = data !== null && !data.isTrusted && data.fileError === null;

  return (
    <>
      <div className="mb-1.5 flex min-h-8 items-center justify-between gap-2">
        <span className="eyebrow">
          {servers.length ? `${onCount} of ${plural(servers.length, 'server')} on` : 'MCP servers'}
        </span>
        <div className="flex items-center gap-1">
          <IconButton
            onClick={overview.reload}
            disabled={overview.isLoading}
            aria-label="Check the servers again"
            title="Check the servers again"
          >
            {overview.isLoading ? <Spinner size={13} /> : <RefreshIcon />}
          </IconButton>
          {chooseServers}
        </div>
      </div>

      {!data ? (
        overview.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-[13px] text-ink-3">
            <Spinner /> Starting MCP servers…
          </div>
        ) : (
          <div
            role="alert"
            className="flex flex-col items-start gap-2 border border-l-[3px] border-line border-l-danger-line bg-danger-bg px-3 py-2.5 text-[13px] text-danger"
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
              className="mb-3 border border-l-[3px] border-line border-l-danger-line bg-danger-bg px-3.5 py-3 text-[13px]"
            >
              <div className="font-bold text-danger">Can&apos;t read mcp.json</div>
              <p className="mt-1 text-ink-2 [overflow-wrap:anywhere]">{data.fileError}</p>
              <p className="mt-1 text-ink-3">Fix the file, then check the servers again.</p>
            </div>
          )}

          {needsReview && (
            <div className="mb-3 border border-l-[3px] border-line border-l-warn-line bg-warn-bg px-3.5 py-3">
              <div className="flex items-center gap-2 font-bold text-ink">
                <ShieldIcon size={15} className="shrink-0 text-warn" />
                Review these servers before they start
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                mcp.json changed outside this app, or came with the folder. Local servers run
                commands on your computer, so check each one below.
              </p>
              <Button
                size="sm"
                variant="primary"
                className="mt-2.5"
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
            <div className="border border-dashed border-line px-5 py-8 text-center">
              <div className="font-bold text-ink">No MCP servers in this workspace</div>
              <p className="mx-auto mt-1 max-w-[42ch] text-[13px] leading-relaxed text-ink-3">
                MCP servers give the agent more tools, like GitHub, a database or a browser. Choose
                which ones this workspace uses.
              </p>
              <div className="mt-3 flex justify-center">{chooseServers}</div>
            </div>
          ) : (
            <ul className="divide-y divide-line-2">
              {servers.map((server) => (
                <McpServerRow
                  key={server.name}
                  server={server}
                  isBusy={isBusy}
                  pending={pending}
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
          )}

          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
            Servers are added in Choose servers and shared by every workspace, but only run where
            they&apos;re chosen; each is switched on or off here. Both are saved in{' '}
            <span className="font-mono [overflow-wrap:anywhere]">{data.file}</span>. Each MCP tool
            asks before it runs unless you turn on Always allow (for that tool everywhere).
          </p>
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
    </>
  );
}
