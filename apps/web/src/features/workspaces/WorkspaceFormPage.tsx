import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  WEB_APP,
  DEFAULT_DISABLED_TOOLS,
  LIMITS,
  workspaceInputSchema,
  workspaceSlug,
  workspaceUpdateSchema,
  type McpServerEntry,
  type ToolGroup,
  type Workspace,
  type WorkspacePlanning,
} from '@app/shared';
import { Button } from '../../components/Button';
import { ERROR, HINT, INPUT, INPUT_ERROR, INPUT_OK, LABEL } from '../../components/form';

/** One section of a tab: flat on the popup (no card), split by thin lines. */
const SECTION = 'py-5 first:pt-1';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { FormActions, usePageHeader } from '../../layout/pageHeader';
import { errorMessage, isNotFound } from '../../lib/api';
import { FolderIcon, TrashIcon } from '../../lib/icons';
import { fromPath, tabFromState } from '../../lib/routerState';
import { useToast } from '../../lib/toast';
import {
  checkWorkspaceFolder,
  createWorkspace,
  deleteWorkspace,
  fetchWorkspace,
  pickFolderWithSystemDialog,
  updateWorkspace,
} from './api';
import { FolderPicker } from './FolderPicker';
import { announceWorkspaceSaved } from './workspaceEvents';
import {
  McpServerSwitches,
  PlanningChoice,
  PanelTabSwitches,
  ToolGroupSwitches,
} from './AgentChoices';
import { fetchMcpEnabled, fetchMcpServers, saveMcpEnabled } from '../mcp/api';
import { APP_NAME } from '../../lib/brand';
import { EMPTY_VOICE_DRAFT, VoiceSettings, type VoiceDraft } from '../voice/VoiceSettings';
import { ModelOptions } from '../models/ModelOptions';
import { useModels } from '../models/useModels';

type FieldErrors = {
  name?: string;
  path?: string;
  modelId?: string;
  transcriptionModel?: string;
  language?: string;
  speechModel?: string;
  speechVoice?: string;
};
const VOICE_FIELDS = [
  'modelId',
  'transcriptionModel',
  'language',
  'speechModel',
  'speechVoice',
] as const;

/** Wait for a pause in typing before asking whether the folder is free. */
const FOLDER_CHECK_DELAY_MS = WEB_APP.folderCheckDelayMs;

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'agent', label: 'Planning & tools' },
  { id: 'mcp', label: 'MCP servers' },
  { id: 'voice', label: 'Voice' },
] as const;
type FormTab = (typeof TABS)[number]['id'];

/** The tab holding the first field with an error, so a failed save shows it. */
function tabWithError(errors: FieldErrors): FormTab | null {
  if (errors.name || errors.path) return 'general';
  if (VOICE_FIELDS.some((field) => errors[field])) return 'voice';
  return null;
}

function toFieldErrors(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>) {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if ((field === 'name' || field === 'path') && !errors[field]) {
      errors[field] = issue.message;
    }
    // voice.modelId, voice.transcriptionModel, voice.language, voice.speechModel, …
    const voiceField = issue.path[1];
    if (
      field === 'voice' &&
      VOICE_FIELDS.some((name) => name === voiceField) &&
      !errors[voiceField as (typeof VOICE_FIELDS)[number]]
    ) {
      errors[voiceField as (typeof VOICE_FIELDS)[number]] = issue.message;
    }
  }
  return errors;
}

/** One setting: its label and a short hint, with the control under them at full width. */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: ReactNode;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={SECTION}>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{hint}</p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Shared create and edit form for a workspace: `/workspaces/new` and
 * `/workspaces/:workspaceId/settings`. Deleting lives here too, behind a confirm modal.
 */
export function WorkspaceFormPage() {
  const { workspaceId } = useParams();
  const isEdit = workspaceId !== undefined;
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const [name, setName] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [planning, setPlanning] = useState<WorkspacePlanning>('default');
  // A new workspace starts with the shared defaults; editing replaces them with the saved choice.
  const [disabledTools, setDisabledTools] = useState<ToolGroup[]>([...DEFAULT_DISABLED_TOOLS]);
  const [hasTerminalTab, setHasTerminalTab] = useState(true);
  const [hasGitTab, setHasGitTab] = useState(true);
  const [voice, setVoice] = useState<VoiceDraft>(EMPTY_VOICE_DRAFT);
  // '' : quick chat uses the default model.
  const [quickChatModelId, setQuickChatModelId] = useState('');
  const models = useModels();
  const changeVoice = (next: Partial<VoiceDraft>) => {
    setVoice((current) => ({ ...current, ...next }));
    setErrors((current) => ({
      ...current,
      modelId: undefined,
      transcriptionModel: undefined,
      language: undefined,
    }));
  };
  // MCP servers: the app's list, and which are on here (saved to mcp.json after the workspace).
  const [mcpServers, setMcpServers] = useState<McpServerEntry[] | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpEnabled, setMcpEnabled] = useState<string[]>([]);
  const [savedMcp, setSavedMcp] = useState<string[]>([]);
  const [isMcpTrusted, setIsMcpTrusted] = useState(true);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  // A link can open the form on a given tab (e.g. the MCP panel's "Choose servers").
  const [tab, setTab] = useState<FormTab>(() => {
    const wanted = tabFromState(location.state);
    return TABS.find((entry) => entry.id === wanted)?.id ?? 'general';
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loaded, setLoaded] = useState<Workspace | null>(null);
  const [isLoading, setIsLoading] = useState(isEdit);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const from = fromPath(location.state);
  // Editing: back to the chat it was opened from (in this workspace), else its newest chat.
  const backTo = isEdit
    ? from?.startsWith(`/workspaces/${workspaceId}`)
      ? from
      : `/workspaces/${workspaceId}`
    : (from ?? '/');

  usePageHeader({
    // The saved name, so the popup's header names the workspace being edited.
    title: isEdit
      ? loaded
        ? `Workspace settings · ${loaded.name}`
        : 'Workspace settings'
      : 'New workspace',
    subtitle: isEdit
      ? 'Changes apply to the next message in every chat of this workspace.'
      : 'A workspace keeps its own folder, chats, memories and instructions.',
    breadcrumbs: isEdit
      ? [
          { label: APP_NAME, to: '/' },
          { label: loaded?.name ?? 'Workspace', to: backTo },
          { label: 'Settings' },
        ]
      : [{ label: APP_NAME, to: '/' }, { label: 'New workspace' }],
  });

  useEffect(() => {
    if (!workspaceId) return;
    let isCurrent = true;
    setIsLoading(true);
    fetchWorkspace(workspaceId)
      .then((workspace) => {
        if (!isCurrent) return;
        setLoaded(workspace);
        setName(workspace.name);
        setFolderPath(workspace.path);
        setPlanning(workspace.planning);
        setDisabledTools(workspace.disabledTools);
        setHasTerminalTab(workspace.hasTerminalTab);
        setHasGitTab(workspace.hasGitTab);
        setVoice(workspace.voice ? { isOn: true, ...workspace.voice } : EMPTY_VOICE_DRAFT);
        setQuickChatModelId(workspace.quickChatModelId ?? '');
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return;
        if (isNotFound(cause)) {
          toast('That workspace no longer exists.', 'warning');
          navigate('/', { replace: true });
        } else {
          toast(errorMessage(cause, "Couldn't load the workspace."), 'error');
        }
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [workspaceId, navigate, toast]);

  useEffect(() => {
    let isCurrent = true;
    Promise.all([fetchMcpServers(), workspaceId ? fetchMcpEnabled(workspaceId) : null])
      .then(([servers, state]) => {
        if (!isCurrent) return;
        setMcpServers(servers);
        const known = new Set(servers.map((entry) => entry.name));
        // The servers this workspace uses; each one's on/off is switched in the MCP tab.
        const on = (state?.allowed ?? []).filter((name) => known.has(name));
        setMcpEnabled(on);
        setSavedMcp(on);
        setIsMcpTrusted(state?.isTrusted ?? true);
      })
      .catch((cause: unknown) => {
        if (isCurrent) setMcpError(errorMessage(cause, "Couldn't load the MCP servers."));
      });
    return () => {
      isCurrent = false;
    };
  }, [workspaceId]);

  // Checked as the folder or name is typed or picked (e.g. another workspace there has a too
  // similar name; several can share a folder), so it shows under the field before Save. A
  // failed check stays quiet: saving checks again.
  const [folderProblem, setFolderProblem] = useState<string | null>(null);
  const savedPath = loaded?.path;
  const savedName = loaded?.name;
  useEffect(() => {
    const wanted = folderPath.trim();
    const wantedName = name.trim();
    setFolderProblem(null);
    if (!wanted || !wantedName || (wanted === savedPath && wantedName === savedName)) return;
    let isCurrent = true;
    const timer = setTimeout(() => {
      checkWorkspaceFolder(wanted, workspaceId, wantedName)
        .then((problem) => {
          if (isCurrent) setFolderProblem(problem);
        })
        .catch(() => {});
    }, FOLDER_CHECK_DELAY_MS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [folderPath, name, savedPath, savedName, workspaceId]);
  const pathError = errors.path ?? folderProblem;

  const isMcpChanged =
    mcpServers !== null &&
    (mcpEnabled.length !== savedMcp.length || mcpEnabled.some((name) => !savedMcp.includes(name)));

  const save = async (write: () => Promise<Workspace>, message: string) => {
    setErrors({});
    setIsSaving(true);
    try {
      const workspace = await write();
      if (isMcpChanged) {
        try {
          await saveMcpEnabled(workspace.id, mcpEnabled);
        } catch (cause) {
          toast(
            `${message}, but its MCP servers didn't change: ${errorMessage(cause, 'try again.')}`,
            'warning',
          );
          announceWorkspaceSaved();
          navigate(isEdit ? backTo : `/workspaces/${workspace.id}`);
          return;
        }
      }
      toast(message);
      announceWorkspaceSaved();
      navigate(isEdit ? backTo : `/workspaces/${workspace.id}`);
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't save the workspace."), 'error');
      setIsSaving(false);
    }
  };

  const showErrors = (next: FieldErrors) => {
    setErrors(next);
    const errorTab = tabWithError(next);
    if (errorTab) setTab(errorTab);
  };

  /** Arrow keys move between the tabs (up/down in the side column, left/right on phones). */
  const moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const index = TABS.findIndex((item) => item.id === tab);
    const next = TABS[(index + step + TABS.length) % TABS.length];
    if (!next) return;
    setTab(next.id);
    document.getElementById(`workspace-tab-${next.id}`)?.focus();
  };
  const panelProps = (id: FormTab) => ({
    id: `workspace-panel-${id}`,
    role: 'tabpanel',
    'aria-labelledby': `workspace-tab-${id}`,
    hidden: tab !== id,
    // `hidden` alone loses to the `flex` class, so the class hides it too. Hidden tabs stay
    // mounted, so what's typed in them is kept.
    className: tab === id ? 'flex flex-col divide-y divide-line-2' : 'hidden',
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (folderProblem) return showErrors({ path: folderProblem });
    // Off saves null; on needs a server and a transcription model (checked by the schema).
    const voicePayload = voice.isOn
      ? {
          modelId: voice.modelId,
          transcriptionModel: voice.transcriptionModel,
          language: voice.language,
          speechModel: voice.speechModel,
          speechVoice: voice.speechVoice,
        }
      : null;
    if (voice.isOn && !voice.modelId) {
      return showErrors({ modelId: 'Pick the server that turns speech into text.' });
    }
    if (workspaceId) {
      const parsed = workspaceUpdateSchema.safeParse({
        name,
        path: folderPath,
        planning,
        disabledTools,
        hasTerminalTab,
        hasGitTab,
        voice: voicePayload,
        quickChatModelId: quickChatModelId || null,
      });
      if (!parsed.success) return showErrors(toFieldErrors(parsed.error.issues));
      void save(() => updateWorkspace(workspaceId, parsed.data), 'Workspace saved');
    } else {
      const parsed = workspaceInputSchema.safeParse({
        name,
        path: folderPath,
        planning,
        disabledTools,
        hasTerminalTab,
        hasGitTab,
        voice: voicePayload,
        quickChatModelId: quickChatModelId || null,
      });
      if (!parsed.success) return showErrors(toFieldErrors(parsed.error.issues));
      void save(() => createWorkspace(parsed.data), 'Workspace created');
    }
  };

  const confirmDelete = async () => {
    if (!workspaceId) return;
    setIsDeleting(true);
    try {
      const { filesKeptAt } = await deleteWorkspace(workspaceId);
      toast(`Workspace deleted. Its files are still in ${filesKeptAt}.`);
      navigate('/', { replace: true });
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete the workspace."), 'error');
      setIsDeleting(false);
      setIsDeleteOpen(false);
    }
  };

  const cancelDelete = useCallback(() => setIsDeleteOpen(false), []);
  const closePicker = useCallback(() => setIsPickerOpen(false), []);
  // Browse: the system's own folder window; the in-app browser only where there is none.
  const [isChoosing, setIsChoosing] = useState(false);
  const browse = () => {
    setIsChoosing(true);
    pickFolderWithSystemDialog(folderPath.trim() || undefined)
      .then(({ path: picked, isSupported }) => {
        if (!isSupported) setIsPickerOpen(true);
        else if (picked) pickFolder(picked);
      })
      .catch((cause: unknown) => {
        toast(errorMessage(cause, "Couldn't open the folder window."), 'error');
        setIsPickerOpen(true);
      })
      .finally(() => setIsChoosing(false));
  };
  const pickFolder = useCallback((picked: string) => {
    setFolderPath(picked);
    setErrors((current) => ({ ...current, path: undefined }));
    setIsPickerOpen(false);
  }, []);
  const isFolderChanged = loaded !== null && folderPath.trim() !== loaded.path;
  const defaultModel = models.data?.find((model) => model.isDefault) ?? null;
  const isQuickChatModelMissing =
    quickChatModelId !== '' &&
    models.data !== undefined &&
    models.data !== null &&
    !models.data.some((model) => model.id === quickChatModelId);

  return (
    <div className="w-full">
      {isLoading ? (
        <PageLoader />
      ) : (
        <form
          id="workspace-form"
          noValidate
          onSubmit={submit}
          className="flex flex-col gap-4 md:flex-row md:gap-6"
        >
          {/* Vertical tabs beside the form; a row above it on phones. */}
          <div
            role="tablist"
            aria-label="Workspace settings"
            aria-orientation="vertical"
            onKeyDown={moveTab}
            className="-mx-1 flex shrink-0 gap-1 overflow-x-auto border-b border-line pb-2 md:sticky md:top-0 md:mx-0 md:w-44 md:flex-col md:self-start md:overflow-visible md:border-b-0 md:border-r md:pb-0 md:pr-4"
          >
            {TABS.map((item) => {
              const isActive = tab === item.id;
              const hasError = tabWithError(errors) === item.id;
              const count = item.id === 'mcp' && mcpEnabled.length > 0 ? mcpEnabled.length : null;
              return (
                <button
                  key={item.id}
                  id={`workspace-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`workspace-panel-${item.id}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setTab(item.id)}
                  className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-left text-[13px] font-medium transition-colors ${
                    isActive
                      ? 'bg-accent-soft text-ink'
                      : 'text-ink-2 hover:bg-subtle hover:text-ink'
                  }`}
                >
                  {item.label}
                  {count !== null && (
                    <span className="rounded-full bg-accent-soft px-1.5 text-[11px] tabular-nums text-accent-2">
                      {count}
                    </span>
                  )}
                  {hasError && (
                    <span
                      aria-label="has an error"
                      className="h-1.5 w-1.5 rounded-full bg-danger"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="min-w-0 flex-1">
            <div {...panelProps('general')}>
              <Field id="workspace-name" label="Name" hint="Shown in the sidebar and the switcher.">
                <input
                  id="workspace-name"
                  value={name}
                  autoFocus
                  autoComplete="off"
                  maxLength={LIMITS.workspaceName}
                  placeholder="e.g. English tutor"
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby={errors.name ? 'workspace-name-error' : undefined}
                  onChange={(event) => setName(event.target.value)}
                  className={`${INPUT} ${errors.name ? INPUT_ERROR : INPUT_OK}`}
                />
                {errors.name && (
                  <p id="workspace-name-error" role="alert" className={ERROR}>
                    {errors.name}
                  </p>
                )}
              </Field>

              <Field id="workspace-path" label="Folder" hint="Where the agent's file tools work.">
                <div className="flex items-start gap-2">
                  <input
                    id="workspace-path"
                    value={folderPath}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={LIMITS.folderPath}
                    placeholder="/Users/you/projects/my-app"
                    aria-invalid={pathError ? true : undefined}
                    aria-describedby={
                      pathError ? 'workspace-path-error workspace-path-hint' : 'workspace-path-hint'
                    }
                    onChange={(event) => {
                      setFolderPath(event.target.value);
                      setErrors((current) => ({ ...current, path: undefined }));
                    }}
                    className={`${INPUT} min-w-0 flex-1 font-mono text-[13px] ${
                      pathError ? INPUT_ERROR : INPUT_OK
                    }`}
                  />
                  <Button
                    className="mt-2 h-[38px] shrink-0"
                    onClick={browse}
                    disabled={isChoosing}
                    title={isChoosing ? 'Choose a folder in the window that opened' : undefined}
                  >
                    {isChoosing ? <Spinner size={13} /> : <FolderIcon />}
                    {isChoosing ? 'Choosing…' : 'Browse…'}
                  </Button>
                </div>
                {pathError && (
                  <p id="workspace-path-error" role="alert" className={ERROR}>
                    {pathError}
                  </p>
                )}
                <p
                  id="workspace-path-hint"
                  className={isFolderChanged ? 'mt-1.5 text-[13px] text-warn' : HINT}
                >
                  {isFolderChanged ? (
                    'Chats, memories and instructions move to the new folder with it, and the agent works there from now on.'
                  ) : (
                    <>
                      An existing project, or a new folder created for you; other workspaces can use
                      it too. The agent can read and change anything inside it, asking before each
                      change. Its chats and memories are kept in{' '}
                      <span className="font-mono text-[12px]">
                        .code-ai/{workspaceSlug(name.trim() || 'workspace')}/
                      </span>{' '}
                      there, named after the workspace.
                    </>
                  )}
                </p>
              </Field>

              <Field
                id="workspace-quick-chat-model"
                label="Quick chat model"
                hint="The model the quick chat button (bottom right) talks to while this workspace is open."
              >
                <select
                  id="workspace-quick-chat-model"
                  value={quickChatModelId}
                  onChange={(event) => setQuickChatModelId(event.target.value)}
                  className={`${INPUT} ${INPUT_OK} pr-8`}
                >
                  <option value="">
                    {models.isLoading
                      ? 'Loading models…'
                      : `Default model${defaultModel ? ` (${defaultModel.name})` : ''}`}
                  </option>
                  <ModelOptions
                    models={models.data}
                    category="chat"
                    selectedId={quickChatModelId}
                  />
                  {isQuickChatModelMissing && (
                    <option value={quickChatModelId}>Deleted model (uses the default)</option>
                  )}
                </select>
              </Field>

              {isEdit && (
                <div
                  className={`${SECTION} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}
                >
                  <div>
                    <h2 className="text-[14px] font-medium text-ink">Delete this workspace</h2>
                    <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
                      Removes its chats, memories and instructions. The other files in its folder
                      stay where they are.
                    </p>
                  </div>
                  <Button
                    variant="danger-outline"
                    className="shrink-0 self-start sm:self-auto"
                    onClick={() => setIsDeleteOpen(true)}
                    disabled={!loaded || isSaving}
                  >
                    <TrashIcon /> Delete workspace
                  </Button>
                </div>
              )}
            </div>

            <div {...panelProps('agent')}>
              <Field
                id="workspace-planning"
                label="Planning"
                hint="Agent decides: the agent makes a plan itself when a task has several steps. Planning step: an extra model call before every message decides; steadier with smaller models, but slower."
              >
                <PlanningChoice
                  id="workspace-planning"
                  value={planning}
                  onChange={setPlanning}
                  isPlansOff={disabledTools.includes('plans')}
                />
              </Field>

              <Field
                id="workspace-tools"
                label="Tools"
                hint="Turn off what this workspace doesn't need: every message gets smaller. Asking you a question is always on; attachment, skill and MCP tools come when needed."
              >
                <div id="workspace-tools">
                  <ToolGroupSwitches disabled={disabledTools} onChange={setDisabledTools} />
                </div>
              </Field>

              <Field
                id="workspace-panel-tabs"
                label="Tabs beside the chat"
                hint="Extra tabs next to the chat. Chat and Notes always show."
              >
                <div id="workspace-panel-tabs">
                  <PanelTabSwitches
                    tabs={[
                      {
                        label: 'Terminal',
                        detail: 'A shell in the workspace folder',
                        isOn: hasTerminalTab,
                        onChange: setHasTerminalTab,
                      },
                      {
                        label: 'Git diff',
                        detail: 'What changed since the last commit',
                        isOn: hasGitTab,
                        onChange: setHasGitTab,
                      },
                    ]}
                  />
                </div>
              </Field>
            </div>

            <div {...panelProps('mcp')}>
              <Field
                id="workspace-mcp"
                label="MCP servers"
                hint="Which of the app's MCP servers this workspace uses. Their tools load only when a task needs them."
              >
                <div id="workspace-mcp">
                  {mcpError ? (
                    <p role="alert" className={ERROR}>
                      {mcpError}
                    </p>
                  ) : !mcpServers ? (
                    <div className="mt-2 flex items-center gap-2 text-[13px] text-ink-3">
                      <Spinner size={13} /> Loading MCP servers…
                    </div>
                  ) : mcpServers.length === 0 ? (
                    <p className="mt-2 rounded-xl border border-dashed border-line px-3.5 py-3 text-[13px] text-ink-3">
                      No MCP servers set up yet. Add them in Settings → MCP servers, then turn them
                      on here.
                    </p>
                  ) : (
                    <>
                      <McpServerSwitches
                        servers={mcpServers}
                        enabled={mcpEnabled}
                        onChange={setMcpEnabled}
                      />
                      <p className={HINT}>
                        {isMcpTrusted
                          ? 'Set up and edited once for the whole app in Settings → MCP servers.'
                          : "This workspace's mcp.json changed outside the app: approve it in the MCP tab before these start."}
                      </p>
                    </>
                  )}
                </div>
              </Field>
            </div>

            <div {...panelProps('voice')}>
              <div className={SECTION}>
                <VoiceSettings
                  value={voice}
                  onChange={changeVoice}
                  errors={{
                    modelId: errors.modelId,
                    transcriptionModel: errors.transcriptionModel,
                    language: errors.language,
                    speechModel: errors.speechModel,
                    speechVoice: errors.speechVoice,
                  }}
                />
              </div>
            </div>
          </div>
        </form>
      )}

      <FormActions>
        <Button onClick={() => navigate(backTo)}>Cancel</Button>
        <Button
          variant="primary"
          type="submit"
          form="workspace-form"
          disabled={isSaving || isLoading}
        >
          {isSaving && <Spinner size={13} />}
          {isSaving ? 'Saving…' : isEdit ? 'Save' : 'Create'}
        </Button>
      </FormActions>

      {isPickerOpen && (
        <FolderPicker startAt={folderPath.trim()} onPick={pickFolder} onClose={closePicker} />
      )}

      {isEdit && (
        <ConfirmDeleteDialog
          open={isDeleteOpen}
          title="Delete this workspace?"
          message={
            <>
              All chats, memories and instructions of{' '}
              <strong className="text-ink">{loaded?.name}</strong> are deleted (its{' '}
              <code className="font-mono text-[12px]">
                .code-ai/{workspaceSlug(loaded?.name ?? '')}
              </code>{' '}
              folder). Its other files, and other workspaces using the folder, stay in{' '}
              <code className="font-mono text-[12px]">{loaded?.path}</code>.
            </>
          }
          busy={isDeleting}
          onCancel={cancelDelete}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}
