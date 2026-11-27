import { useCallback, useEffect, useState } from 'react';
import type { McpServerEntry } from '@app/shared';
import { Button } from '../../components/Button';
import { ERROR } from '../../components/form';
import { Modal } from '../../components/Modal';
import { Spinner } from '../../components/Spinner';
import { errorMessage } from '../../lib/api';
import { ArrowLeftIcon, CrossIcon, PlusIcon, SearchIcon, ServerIcon } from '../../lib/icons';
import { useToast } from '../../lib/toast';
import { McpServerSwitches } from '../workspaces/AgentChoices';
import { announceWorkspaceSaved } from '../workspaces/workspaceEvents';
import { fetchMcpEnabled, fetchMcpServers, saveMcpEnabled } from './api';
import { useMcpServerForm } from './McpServerFormModal';

/** The server form open over this list: a new server, or one being edited. */
type FormState = { kind: 'add' } | { kind: 'edit'; name: string } | null;

/**
 * Which of the app's MCP servers this workspace uses, opened from the MCP tab's
 * "Choose servers". Servers are managed here too (Add server, edit): they're shared by every
 * workspace but only run where turned on. The choice is saved to the workspace's mcp.json;
 * their tools load only when needed.
 */
export function ChooseMcpServersModal({
  workspaceId,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  onClose: () => void;
  /** after the choice was saved */
  onSaved?: () => void;
}) {
  const toast = useToast();
  const [servers, setServers] = useState<McpServerEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [isTrusted, setIsTrusted] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormState>(null);
  const [query, setQuery] = useState('');
  const closeForm = useCallback(() => setForm(null), []);

  /** A new server is turned on here; an edited one keeps its switch, under its new name. */
  const onServerSaved = (entry: McpServerEntry, previousName?: string) => {
    setServers((list) => {
      const rest = (list ?? []).filter((item) => item.name !== (previousName ?? entry.name));
      if (previousName === undefined) return [...rest, entry];
      const index = (list ?? []).findIndex((item) => item.name === previousName);
      const next = [...rest];
      next.splice(index < 0 ? next.length : index, 0, entry);
      return next;
    });
    if (previousName === undefined) {
      setEnabled((on) => (on.includes(entry.name) ? on : [...on, entry.name]));
    } else if (previousName !== entry.name) {
      const rename = (on: string[]) =>
        on.map((name) => (name === previousName ? entry.name : name));
      setEnabled(rename);
      setSaved(rename);
    }
  };

  /** Deleting removes it from every workspace (this one's saved choice included). */
  const onServerDeleted = (name: string) => {
    setServers((list) => (list ?? []).filter((item) => item.name !== name));
    setEnabled((on) => on.filter((item) => item !== name));
    setSaved((on) => on.filter((item) => item !== name));
    announceWorkspaceSaved();
    onSaved?.();
  };

  useEffect(() => {
    let isCurrent = true;
    Promise.all([fetchMcpServers(), fetchMcpEnabled(workspaceId)])
      .then(([list, state]) => {
        if (!isCurrent) return;
        setServers(list);
        const known = new Set(list.map((entry) => entry.name));
        const on = state.allowed.filter((name) => known.has(name));
        setEnabled(on);
        setSaved(on);
        setIsTrusted(state.isTrusted);
      })
      .catch((cause: unknown) => {
        if (isCurrent) setLoadError(errorMessage(cause, "Couldn't load the MCP servers."));
      });
    return () => {
      isCurrent = false;
    };
  }, [workspaceId]);

  const isChanged =
    servers !== null &&
    (enabled.length !== saved.length || enabled.some((name) => !saved.includes(name)));

  const save = async () => {
    if (!isChanged) return onClose();
    setIsSaving(true);
    try {
      await saveMcpEnabled(workspaceId, enabled);
      toast('MCP servers saved');
      announceWorkspaceSaved();
      onSaved?.();
      onClose();
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't change the MCP servers."), 'error');
      setIsSaving(false);
    }
  };

  const count = enabled.length;

  // Add server / edit opens the form in this same popup; Back, Cancel or Esc return to the list.
  const serverForm = useMcpServerForm({
    open: form !== null,
    serverName: form?.kind === 'edit' ? form.name : undefined,
    onClose: closeForm,
    onSaved: onServerSaved,
    onDeleted: onServerDeleted,
  });

  if (form) {
    return (
      <Modal
        title={serverForm.title}
        icon={<ServerIcon size={15} />}
        description={serverForm.description}
        onClose={closeForm}
        size="lg"
        actions={
          <Button
            size="sm"
            onClick={closeForm}
            disabled={serverForm.isSaving}
            title="Back to the MCP servers"
          >
            <ArrowLeftIcon /> Back
          </Button>
        }
        footer={serverForm.footer}
      >
        {serverForm.body}
      </Modal>
    );
  }

  return (
    <Modal
      title="MCP servers"
      icon={<ServerIcon size={15} />}
      aside={
        count > 0 ? (
          <span className="rounded-full bg-accent-soft px-1.5 text-[11px] tabular-nums text-accent-2">
            {count}
          </span>
        ) : undefined
      }
      description="Which MCP servers this workspace uses. Servers are shared by every workspace but only run where they're turned on, and their tools load only when a task needs them."
      onClose={onClose}
      size="lg"
      actions={
        <Button
          size="sm"
          variant="primary"
          onClick={() => setForm({ kind: 'add' })}
          disabled={servers === null || isSaving}
          title="Set up a new MCP server, shared by every workspace"
        >
          <PlusIcon /> Add server
        </Button>
      }
      footer={
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={isSaving || servers === null}
          >
            {isSaving && <Spinner size={13} />}
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="px-5 pb-5 pt-2">
        {loadError ? (
          <p role="alert" className={ERROR}>
            {loadError}
          </p>
        ) : !servers ? (
          <div className="mt-3 flex items-center gap-2 text-[13px] text-ink-3">
            <Spinner size={13} /> Loading MCP servers…
          </div>
        ) : servers.length === 0 ? (
          <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-3.5 py-6 text-center text-[13px] text-ink-3">
            No MCP servers set up yet. Add one, like GitHub, Jira, a database or a browser; it runs
            only in the workspaces that turn it on.
            <Button size="sm" variant="primary" onClick={() => setForm({ kind: 'add' })}>
              <PlusIcon /> Add your first server
            </Button>
          </div>
        ) : (
          <>
            <label className="group/search relative mt-1 flex items-center">
              <span className="sr-only">Search MCP servers</span>
              <SearchIcon
                size={14}
                className="pointer-events-none absolute left-3 text-ink-3 transition-colors group-focus-within/search:text-accent"
              />
              <input
                type="search"
                value={query}
                placeholder="Search servers by name, type, command or URL"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && query) {
                    event.preventDefault();
                    event.stopPropagation();
                    setQuery('');
                  }
                }}
                className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-8 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                  className="absolute right-2 grid h-5 w-5 place-items-center rounded text-ink-3 hover:text-ink"
                >
                  <CrossIcon size={11} />
                </button>
              )}
            </label>
            <McpServerSwitches
              servers={servers}
              enabled={enabled}
              onChange={setEnabled}
              onEdit={(name) => setForm({ kind: 'edit', name })}
              query={query}
            />
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
              {isTrusted
                ? 'Changes to a server itself (its command, URL or keys) apply in every workspace that uses it.'
                : "This workspace's mcp.json changed outside the app: approve it in the MCP tab before these start."}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
