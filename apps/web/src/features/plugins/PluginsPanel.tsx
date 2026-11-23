import { useCallback, useState } from 'react';
import type { PluginSummary } from '@app/shared';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { errorMessage } from '../../lib/api';
import { plural } from '../../lib/format';
import { PlusIcon, WarnIcon, WrenchIcon } from '../../lib/icons';
import { useToast } from '../../lib/toast';
import type { AsyncResource } from '../../lib/useAsync';
import { patchMcpServer } from '../mcp/api';
import { PanelMessage } from '../panel/PanelMessage';
import { PluginDialog } from './PluginDialog';
import type { PluginsState } from './usePlugins';

/** Which plugin the dialog is for: a new one, or one to edit. */
type DialogTarget = { kind: 'new' } | { kind: 'edit'; name: string };

/**
 * The Tools tab: tool plugins the AI writes for you. Each is a small MCP server kept by the
 * app; the switch turns it on in this workspace, and the agent gets its tools from the next
 * message.
 */
export function PluginsPanel({
  workspaceId,
  plugins,
  isBusy,
}: {
  workspaceId: string;
  plugins: AsyncResource<PluginsState>;
  isBusy: boolean;
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  const { reload, data } = plugins;

  const on = new Set(data?.mcp.enabled ?? []);

  const toggle = async (plugin: PluginSummary, isOn: boolean) => {
    setSwitching(plugin.name);
    try {
      await patchMcpServer(workspaceId, plugin.name, { enabled: isOn });
      toast(isOn ? `${plugin.name} is on here` : `${plugin.name} is off here`);
      reload();
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't change it."), 'error');
    } finally {
      setSwitching(null);
    }
  };

  return (
    <>
      <div className="mb-2 flex min-h-7 items-center justify-between gap-2">
        <span className="eyebrow">
          {data?.plugins.length ? plural(data.plugins.length, 'plugin') : 'Tool plugins'}
        </span>
        <Button size="sm" onClick={() => setDialog({ kind: 'new' })}>
          <PlusIcon size={11} /> New tool
        </Button>
      </div>

      {!data ? (
        <PanelMessage isLoading={plugins.isLoading} error={plugins.error} onRetry={reload} />
      ) : (
        <>
          {!data.mcp.isTrusted && data.plugins.some((p) => on.has(p.name)) && (
            <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-line border-l-4 border-l-warn bg-surface px-3 py-2 text-[12px] text-ink-2">
              <WarnIcon size={13} className="mt-0.5 shrink-0 text-warn" />
              This workspace&apos;s MCP choices changed outside the app. Approve them in the MCP tab
              before these tools run.
            </p>
          )}
          <ul className={data.plugins.length ? 'panel divide-y divide-line-2' : ''}>
            {data.plugins.length === 0 && (
              <li className="border border-dashed border-line px-4 py-5 text-center text-[13px] text-ink-3">
                No tools of your own yet. Describe one, like &quot;look up today&apos;s exchange
                rate&quot;, and AI writes the code. Test it, save it, turn it on.
              </li>
            )}
            {data.plugins.map((plugin) => (
              <li
                key={plugin.name}
                className="group relative flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-subtle"
              >
                <WrenchIcon size={14} className="mt-0.5 shrink-0 text-accent" />
                <button
                  type="button"
                  onClick={() => setDialog({ kind: 'edit', name: plugin.name })}
                  title="Edit this plugin"
                  className="min-w-0 flex-1 text-left outline-none after:absolute after:inset-0 focus-visible:after:rounded-md focus-visible:after:ring-1 focus-visible:after:ring-accent"
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="truncate font-mono text-[12.5px] font-semibold text-ink">
                      {plugin.name}
                    </span>
                    {!plugin.isRegistered && (
                      <Badge tone="yellow" className="h-4 px-1.5 text-[10.5px]">
                        save to restore
                      </Badge>
                    )}
                  </span>
                  {plugin.description && (
                    <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-3">
                      {plugin.description}
                    </span>
                  )}
                </button>
                <span className="relative z-10 mt-0.5">
                  <Switch
                    isOn={on.has(plugin.name)}
                    disabled={isBusy || switching !== null || !plugin.isRegistered}
                    onChange={(isOn) => void toggle(plugin, isOn)}
                    label={`Use ${plugin.name} in this workspace`}
                    title={
                      isBusy
                        ? 'Wait for the chat to finish'
                        : on.has(plugin.name)
                          ? 'On in this workspace'
                          : 'Off in this workspace'
                    }
                  />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
        Tool plugins are shared by all workspaces; switch each one on where you need it. The agent
        sees their tools from your next message and asks before running one (allow a tool for good
        in the MCP tab).
      </p>

      {dialog && (
        <PluginDialog
          key={dialog.kind === 'edit' ? dialog.name : 'new'}
          name={dialog.kind === 'edit' ? dialog.name : null}
          workspaceId={workspaceId}
          onClose={closeDialog}
          onSaved={(plugin, previousName) => {
            reload();
            // A new plugin is turned on where it was made.
            if (previousName === null) void toggle(plugin, true);
          }}
          onDeleted={reload}
        />
      )}
    </>
  );
}
