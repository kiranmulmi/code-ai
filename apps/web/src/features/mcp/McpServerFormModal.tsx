import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { mcpServerInputSchema, type McpServerEntry } from '@app/shared';
import { Button } from '../../components/Button';
import { CodeText } from '../../components/CodeText';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
// Dense styles (this form opens in a popup); the JSON box keeps INPUT, which its
// highlighted copy is lined up with.
import {
  ERROR_SM as ERROR,
  HINT_SM as HINT,
  INPUT,
  INPUT_ERROR,
  INPUT_OK,
  INPUT_SM,
  LABEL_SM as LABEL,
  SECTION_SM as SECTION,
} from '../../components/form';
import { Modal } from '../../components/Modal';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { errorMessage, isNotFound } from '../../lib/api';
import { ServerIcon, TrashIcon } from '../../lib/icons';
import { useToast } from '../../lib/toast';
import { addMcpServer, deleteMcpServer, fetchMcpServer, replaceMcpServer } from './api';
import { parseServerJson, TEMPLATES, toJson } from './serverForm';

const JSON_PLACEHOLDER = `{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "…" }
}`;

/** Shared by the textarea and its coloured copy, so their text lines up exactly. */
const JSON_EDITOR =
  'whitespace-pre-wrap font-mono text-[13px] leading-relaxed [overflow-wrap:break-word] [scrollbar-gutter:stable] [tab-size:2]';

type McpServerFormProps = {
  /** the server to edit; leave out to add a new one */
  serverName?: string;
  onClose: () => void;
  /** after the server was added or saved */
  onSaved?: (entry: McpServerEntry, previousName?: string) => void;
  /** after the server was deleted */
  onDeleted?: (name: string) => void;
};

/**
 * Add or edit one of the app's MCP servers, in its own popup (a server's edit button in the
 * MCP tab). The MCP servers popup shows the same form in place, through useMcpServerForm.
 */
export function McpServerFormModal(props: McpServerFormProps) {
  const form = useMcpServerForm(props);
  return (
    <Modal
      title={form.title}
      icon={<ServerIcon size={15} />}
      description={form.description}
      onClose={props.onClose}
      size="lg"
      footer={form.footer}
    >
      {form.body}
    </Modal>
  );
}

/**
 * The add / edit form for one of the app's MCP servers, as the parts of a popup (title,
 * description, body, footer), so it can fill its own Modal or take over one already open.
 * Servers are shared by every workspace but only used where a workspace turns them on. The
 * server is edited as the JSON entry other MCP clients use. Deleting lives here too.
 * `open: false` keeps it idle (and clears it), for a popup that shows it only some of the time.
 */
export function useMcpServerForm({
  serverName,
  onClose,
  onSaved,
  onDeleted,
  open = true,
}: McpServerFormProps & { open?: boolean }) {
  const isEdit = serverName !== undefined;
  const toast = useToast();

  const [name, setName] = useState('');
  const [json, setJson] = useState('');
  const highlightRef = useRef<HTMLPreElement>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  /** which server's details have loaded, so a newly opened edit form shows the loader at once */
  const [loadedName, setLoadedName] = useState<string | null>(null);
  const isLoading = isEdit && loadedName !== serverName;
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // The latest close callback, so a new function from the parent doesn't reload the server.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // A fresh form each time it opens (or switches server), and a clean one when it closes.
    setName('');
    setJson('');
    setNameError(null);
    setJsonError(null);
    setLoadedName(null);
    setIsSaving(false);
    setIsDeleteOpen(false);
    setIsDeleting(false);
    if (!open || !serverName) return;
    let isCurrent = true;
    fetchMcpServer(serverName)
      .then((entry) => {
        if (!isCurrent) return;
        setName(entry.name);
        setJson(toJson(entry.server));
        setLoadedName(serverName);
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return;
        toast(
          isNotFound(cause)
            ? errorMessage(cause, 'That MCP server no longer exists.')
            : errorMessage(cause, "Couldn't load the MCP server."),
          isNotFound(cause) ? 'warning' : 'error',
        );
        onCloseRef.current();
      });
    return () => {
      isCurrent = false;
    };
  }, [open, serverName, toast]);

  /** A pasted README snippet becomes the server's own object, and brings its name along. */
  const tidy = (text: string) => {
    const parsed = parseServerJson(text);
    if ('error' in parsed) {
      if (text.trim()) setJsonError(parsed.error);
      return;
    }
    setJsonError(null);
    setJson(toJson(parsed.server));
    if (parsed.name && !name.trim()) {
      setName(parsed.name);
      setNameError(null);
    }
    if (parsed.skipped) {
      toast(`Kept the first server. Add the other ${parsed.skipped} one by one.`, 'warning');
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseServerJson(json);
    const finalName = name.trim() || ('server' in parsed ? (parsed.name ?? '') : '');
    const checked = mcpServerInputSchema.safeParse({
      name: finalName,
      server: 'server' in parsed ? parsed.server : {},
    });
    const badName = checked.success
      ? null
      : (checked.error.issues.find((issue) => issue.path[0] === 'name')?.message ?? null);
    setNameError(badName);
    setJsonError('error' in parsed ? parsed.error : null);
    if (!checked.success || 'error' in parsed) return;

    setIsSaving(true);
    try {
      const entry = serverName
        ? await replaceMcpServer(serverName, checked.data)
        : await addMcpServer(checked.data);
      toast(isEdit ? 'MCP server saved' : 'MCP server added');
      onSaved?.(entry, serverName);
      onClose();
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't save the MCP server."), 'error');
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!serverName) return;
    setIsDeleting(true);
    try {
      await deleteMcpServer(serverName);
      toast('MCP server deleted');
      onDeleted?.(serverName);
      onClose();
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete the MCP server."), 'error');
      setIsDeleting(false);
      setIsDeleteOpen(false);
    }
  };
  const cancelDelete = useCallback(() => setIsDeleteOpen(false), []);

  return {
    title: isEdit ? 'Edit MCP server' : 'Add MCP server',
    description: 'Shared by every workspace, but it only runs in the workspaces that turn it on.',
    isSaving,
    footer: isLoading ? undefined : (
      <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
        {isEdit && (
          <Button
            variant="danger-ghost"
            className="mr-auto"
            onClick={() => setIsDeleteOpen(true)}
            disabled={isSaving}
          >
            <TrashIcon /> Delete
          </Button>
        )}
        <Button onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" form="mcp-form" disabled={isSaving}>
          {isSaving && <Spinner size={13} />}
          {isSaving ? 'Saving…' : isEdit ? 'Save' : 'Add server'}
        </Button>
      </div>
    ),
    body: (
      <>
        <div className="px-5 pb-5 pt-2">
          {isLoading ? (
            <PageLoader />
          ) : (
            // Two columns: the name and the notes on the left, the JSON editor (the bulk of the
            // form) beside them, so the whole form fits without scrolling.
            <form
              id="mcp-form"
              noValidate
              onSubmit={(event) => void submit(event)}
              className="panel grid md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:divide-x md:divide-line-2"
            >
              <div className="flex flex-col divide-y divide-line-2">
                <div className={SECTION}>
                  <label htmlFor="mcp-name" className={LABEL}>
                    Name
                  </label>
                  <input
                    id="mcp-name"
                    value={name}
                    autoFocus={!isEdit}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={32}
                    placeholder="github"
                    aria-invalid={nameError ? true : undefined}
                    onChange={(event) => {
                      setName(event.target.value);
                      setNameError(null);
                    }}
                    className={`${INPUT_SM} ${nameError ? INPUT_ERROR : INPUT_OK} font-mono`}
                  />
                  {nameError && (
                    <p role="alert" className={ERROR}>
                      {nameError}
                    </p>
                  )}
                  <p className={HINT}>
                    Letters, digits, - and _. Its tools show up as{' '}
                    <span className="font-mono break-all">mcp__{name.trim() || 'name'}__tool</span>.
                  </p>
                </div>
                <div id="mcp-json-hint" className={`${SECTION} ${HINT} !mt-0 grid gap-1.5`}>
                  <p>
                    Paste a server&apos;s <span className="font-mono">mcpServers</span> snippet from
                    its README as it is: it&apos;s unwrapped to this server, with its name.
                  </p>
                  <p>
                    Local: <span className="font-mono">command</span>,{' '}
                    <span className="font-mono">args</span>, <span className="font-mono">env</span>.
                    Remote: <span className="font-mono">url</span>,{' '}
                    <span className="font-mono">headers</span> (and{' '}
                    <span className="font-mono">&quot;type&quot;: &quot;sse&quot;</span> for older
                    servers). Optional: <span className="font-mono">autoApprove</span> (tool names
                    that run without asking).
                  </p>
                </div>
                <div className={`${SECTION} flex-1 bg-subtle`}>
                  <p className="text-[11px] leading-snug text-ink-3">
                    A local server runs its command in the folder of each workspace that turns it
                    on, with only the variables in <span className="font-mono">env</span> plus
                    basics like PATH and HOME, never this app&apos;s own keys. Keys and tokens in it
                    are saved in ~/.code-ai/mcp-servers.json, readable only by you, not in your
                    project folders.
                  </p>
                </div>
              </div>

              <div className="flex flex-col divide-y divide-line-2">
                <div className={SECTION}>
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <label htmlFor="mcp-json" className={LABEL}>
                      Configuration <span className="font-normal text-ink-3">· JSON</span>
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {!isEdit &&
                        TEMPLATES.map((template) => (
                          <Button
                            key={template.label}
                            size="sm"
                            variant="plain"
                            onClick={() => {
                              setJson(toJson(template.server));
                              setJsonError(null);
                            }}
                          >
                            {template.label}
                          </Button>
                        ))}
                      <Button size="sm" onClick={() => tidy(json)} disabled={!json.trim()}>
                        Format
                      </Button>
                    </div>
                  </div>
                  <div className="relative">
                    {/* The coloured copy sits behind a see-through textarea and scrolls with it. */}
                    <pre
                      ref={highlightRef}
                      aria-hidden
                      className={`${JSON_EDITOR} pointer-events-none absolute inset-x-0 bottom-0 top-2 m-0 overflow-hidden rounded-lg border border-transparent bg-surface px-3 py-2 text-ink`}
                    >
                      <CodeText text={json} language="json" />
                      {'\n'}
                    </pre>
                    <textarea
                      id="mcp-json"
                      rows={16}
                      value={json}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      placeholder={JSON_PLACEHOLDER}
                      aria-invalid={jsonError ? true : undefined}
                      aria-describedby="mcp-json-hint"
                      onChange={(event) => {
                        setJson(event.target.value);
                        setJsonError(null);
                      }}
                      onPaste={(event) => {
                        // Pasting over everything (or into an empty box): take the snippet as a whole.
                        const box = event.currentTarget;
                        if (box.selectionStart !== 0 || box.selectionEnd !== box.value.length)
                          return;
                        event.preventDefault();
                        const text = event.clipboardData.getData('text');
                        setJson(text);
                        tidy(text);
                      }}
                      onBlur={() => tidy(json)}
                      onScroll={(event) => {
                        const highlight = highlightRef.current;
                        if (!highlight) return;
                        highlight.scrollTop = event.currentTarget.scrollTop;
                        highlight.scrollLeft = event.currentTarget.scrollLeft;
                      }}
                      className={`${INPUT} ${jsonError ? INPUT_ERROR : INPUT_OK} ${JSON_EDITOR} relative min-h-[240px] resize-y caret-ink !bg-transparent !text-[13px] ${
                        json ? '[-webkit-text-fill-color:transparent]' : ''
                      }`}
                    />
                  </div>
                  {jsonError && (
                    <p role="alert" className={ERROR}>
                      {jsonError}
                    </p>
                  )}
                </div>
              </div>
            </form>
          )}
        </div>

        {isEdit && (
          <ConfirmDeleteDialog
            open={isDeleteOpen}
            title="Delete this MCP server?"
            message={
              <>
                <strong className="font-mono text-ink">{serverName}</strong> is removed from every
                workspace and stopped. The agent loses its tools from your next message.
              </>
            }
            busy={isDeleting}
            onCancel={cancelDelete}
            onConfirm={() => void confirmDelete()}
          />
        )}
      </>
    ),
  };
}
