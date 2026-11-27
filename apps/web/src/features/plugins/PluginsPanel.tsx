import { useCallback, useState } from 'react';
import type { PluginSummary } from '@app/shared';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { errorMessage } from '../../lib/api';
import { EditIcon, PlusIcon, SparkIcon, TerminalIcon, WarnIcon } from '../../lib/icons';
import { useToast } from '../../lib/toast';
import type { AsyncResource } from '../../lib/useAsync';
import { patchMcpServer } from '../mcp/api';
import { PanelMessage } from '../panel/PanelMessage';
import {
  CardAction,
  CardGrid,
  EmptyHero,
  GroupHeading,
  ItemCard,
  SectionHeader,
  SectionNote,
  SectionPage,
} from '../customize/SectionLayout';
import { PluginDialog } from './PluginDialog';
import type { PluginsState } from './usePlugins';

/** Which plugin the dialog is for: a new one, or one to edit. */
type DialogTarget = { kind: 'new' } | { kind: 'edit'; name: string };

/**
 * The Tools page (Customize tab): tool plugins the AI writes for you. Each is a small MCP server kept by the
 * app; the switch turns it on in this workspace, and the agent gets its tools from the next
 * message.
 */
export function PluginsPanel({
  workspaceId,
  plugins,
  isBusy,
  onOpenMcp,
}: {
  workspaceId: string;
  plugins: AsyncResource<PluginsState>;
  isBusy: boolean;
  /** opens the MCP servers page (approvals, Always allow) */
  onOpenMcp?: () => void;
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

  const list = data?.plugins ?? [];
  const onCount = list.filter((plugin) => on.has(plugin.name)).length;
  const newTool = (
    <Button variant="primary" onClick={() => setDialog({ kind: 'new' })}>
      <PlusIcon size={12} /> New tool
    </Button>
  );

  /** One plugin as a card; its switch says (and sets) whether it's on here. */
  const card = (plugin: PluginSummary) => {
    const isOn = on.has(plugin.name);
    return (
      <ItemCard
        key={plugin.name}
        isMuted={!isOn}
        icon={<TerminalIcon size={15} />}
        name={plugin.name}
        openTitle="Edit, test or delete this tool"
        onOpen={() => setDialog({ kind: 'edit', name: plugin.name })}
        badges={
          !plugin.isRegistered && (
            <Badge tone="yellow" className="h-4 px-1.5 text-[10.5px]">
              save to restore
            </Badge>
          )
        }
        description={plugin.description || 'No description.'}
        corner={
          <CardAction
            label={`Edit ${plugin.name}`}
            onClick={() => setDialog({ kind: 'edit', name: plugin.name })}
          >
            <EditIcon size={13} />
          </CardAction>
        }
        meta={
          <span className={isOn ? 'font-semibold text-success' : ''}>
            {isOn ? 'On in this workspace' : 'Off here'}
          </span>
        }
        footerEnd={
          <Switch
            isOn={isOn}
            disabled={isBusy || switching !== null || !plugin.isRegistered}
            onChange={(next) => void toggle(plugin, next)}
            label={`Use ${plugin.name} in this workspace`}
            title={isBusy ? 'Wait for the chat to finish' : isOn ? 'Turn off here' : 'Turn on here'}
          />
        }
      />
    );
  };

  return (
    <SectionPage>
      <SectionHeader
        icon={<TerminalIcon size={18} />}
        title="Tools"
        description="Your own tools, written by AI from a description. Each is a small MCP server shared by every workspace; switch it on where you need it."
        actions={newTool}
      />

      {!data ? (
        <PanelMessage isLoading={plugins.isLoading} error={plugins.error} onRetry={reload} />
      ) : list.length === 0 ? (
        <EmptyHero
          icon={<TerminalIcon size={20} />}
          title="No tools of your own yet"
          actions={
            <Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'new' })}>
              <SparkIcon size={12} /> Describe a tool
            </Button>
          }
        >
          Describe one, like &quot;look up today&apos;s exchange rate&quot;, and AI writes the code.
          Test it, save it, then turn it on.
        </EmptyHero>
      ) : (
        <>
          {!data.mcp.isTrusted && onCount > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line border-l-4 border-l-warn bg-warn-bg px-4 py-3 text-[13px] text-ink-2">
              <WarnIcon size={14} className="shrink-0 text-warn" />
              <span className="min-w-0 flex-1">
                This workspace&apos;s MCP choices changed outside the app. Approve them before these
                tools run.
              </span>
              {onOpenMcp && (
                <Button size="sm" onClick={onOpenMcp}>
                  Review in MCP servers
                </Button>
              )}
            </div>
          )}
          <GroupHeading count={list.length} hint={`${onCount} on in this workspace`}>
            Your tools
          </GroupHeading>
          <CardGrid label="Tool plugins">{list.map(card)}</CardGrid>
        </>
      )}

      <SectionNote>
        The agent sees a tool from your next message and asks before running it. To let a tool run
        without asking, turn on Always allow for it in{' '}
        {onOpenMcp ? (
          <button
            type="button"
            onClick={onOpenMcp}
            className="font-semibold text-accent-2 hover:underline"
          >
            MCP servers
          </button>
        ) : (
          'MCP servers'
        )}
        .
      </SectionNote>

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
    </SectionPage>
  );
}
