import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AGENT_LIMITS,
  TOOL_GROUPS,
  TOOL_GROUP_LABELS,
  toAgentName,
  type SpecialistInfo,
  type SpecialistModel,
} from '@app/shared';
import type { ToolGroup } from '@app/shared';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { ERROR, INPUT, INPUT_ERROR, INPUT_OK } from '../../components/form';
import { IconButton } from '../../components/IconButton';
import { Modal } from '../../components/Modal';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { ApiError, errorMessage, isNotFound } from '../../lib/api';
import {
  BoltIcon,
  BrainIcon,
  CheckIcon,
  CrossIcon,
  EyeIcon,
  FileIcon,
  FlagIcon,
  FolderIcon,
  GlobeIcon,
  ShieldIcon,
  TerminalIcon,
  TrashIcon,
  WarnIcon,
} from '../../lib/icons';
import { useToast } from '../../lib/toast';
import {
  EMPTY_DRAFT,
  checkDraft,
  describeAccess,
  draftFrom,
  draftWarning,
  isSameDraft,
  toggleGroup,
  type AgentDraft,
  type AgentErrors,
  type AgentField,
} from './agentDraft';
import { createAgent, deleteAgent, fetchAgent, updateAgent } from './api';

const DESCRIPTION_PLACEHOLDER =
  'Checking code for security problems: injection, secrets, unsafe input.';
const ROLE_PLACEHOLDER = `You are the team's security auditor. Read the code you're pointed at and list each problem with file, line and a fix, most serious first. Post the serious ones as team notes.`;

const MODELS: ReadonlyArray<{ id: SpecialistModel; label: string; detail: string }> = [
  { id: 'subagent', label: 'Sub-agent', detail: 'Settings → Agent → Sub-agent model' },
  { id: 'review', label: 'Reviewer', detail: 'The model that checks answers, when set' },
];

const GROUP_ICONS: Record<ToolGroup, typeof FolderIcon> = {
  files: FolderIcon,
  commands: TerminalIcon,
  web: GlobeIcon,
  memory: BrainIcon,
  plans: FlagIcon,
};

const ACCESS: ReadonlyArray<{ readOnly: boolean; label: string; detail: string }> = [
  { readOnly: false, label: 'Can make changes', detail: 'Write files, run commands, save memory' },
  { readOnly: true, label: 'Read-only', detail: 'Only tools that change nothing' },
];

/** Two file names that are the same file where names ignore case. */
const sameFileOnAnyDisk = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** What the popup opens on. */
export type AgentDialogTarget =
  /** a new specialist, maybe filled in (a copy of a built-in) */
  | { kind: 'new'; start?: AgentDraft }
  /** one of the workspace's own */
  | { kind: 'edit'; name: string }
  /** a broken file, rewritten under `name`; `replacesFile`: the old file, removed after */
  | { kind: 'fix'; name: string; replacesFile: string | null; problem: string };

/**
 * Write or edit one of the workspace's specialists in a popup. Saved as
 * `.code-ai/<workspace>/agents/<name>.md`. Closing with unsaved changes asks first.
 */
export function AgentDialog({
  workspaceId,
  target,
  onClose,
  onChanged,
}: {
  workspaceId: string;
  target: AgentDialogTarget;
  onClose: () => void;
  /** after a save or delete: reload the list */
  onChanged: () => void;
}) {
  const toast = useToast();
  const editName = target.kind === 'edit' ? target.name : null;
  const startDraft: AgentDraft =
    target.kind === 'new'
      ? (target.start ?? EMPTY_DRAFT)
      : target.kind === 'fix'
        ? { ...EMPTY_DRAFT, name: target.name }
        : EMPTY_DRAFT;
  const [draft, setDraft] = useState<AgentDraft>(startDraft);
  const [saved, setSaved] = useState<AgentDraft>(startDraft);
  const [errors, setErrors] = useState<AgentErrors>({});
  const [isLoading, setIsLoading] = useState(editName !== null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const isDirty = !isSameDraft(draft, saved);

  useEffect(() => {
    if (!editName) return;
    let isCurrent = true;
    fetchAgent(workspaceId, editName)
      .then((info: SpecialistInfo) => {
        if (!isCurrent) return;
        setDraft(draftFrom(info));
        setSaved(draftFrom(info));
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return;
        toast(
          isNotFound(cause)
            ? 'That specialist no longer exists, or its file is broken.'
            : errorMessage(cause, "Couldn't load the specialist."),
          isNotFound(cause) ? 'warning' : 'error',
        );
        onClose();
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [workspaceId, editName, onClose, toast]);

  const change = <K extends keyof AgentDraft>(field: K, value: AgentDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) =>
      current[field as AgentField] ? { ...current, [field]: undefined } : current,
    );
    setIsClosing(false);
  };

  const requestClose = useCallback(() => {
    if (isDeleteOpen || isSaving) return;
    if (isDirty) setIsClosing(true);
    else onClose();
  }, [isDeleteOpen, isSaving, isDirty, onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const checked = checkDraft(draft);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setDraft((current) => ({ ...current, name: checked.data.name }));
    setIsSaving(true);
    setIsClosing(false);
    try {
      if (target.kind === 'edit') {
        await updateAgent(workspaceId, target.name, checked.data);
      } else if (target.kind === 'fix' && target.replacesFile === null) {
        // The broken file already has this name: saving writes over it.
        await updateAgent(workspaceId, target.name, checked.data);
      } else if (
        target.kind === 'fix' &&
        target.replacesFile &&
        sameFileOnAnyDisk(target.replacesFile, `${checked.data.name}.md`)
      ) {
        // "Helper.md" → "helper.md": one file where names ignore case (macOS, Windows), so
        // the broken one goes first.
        await deleteAgent(workspaceId, target.replacesFile);
        await createAgent(workspaceId, checked.data);
      } else {
        await createAgent(workspaceId, checked.data);
        if (target.kind === 'fix' && target.replacesFile) {
          await deleteAgent(workspaceId, target.replacesFile);
        }
      }
      toast(
        target.kind === 'edit'
          ? 'Specialist saved'
          : target.kind === 'fix'
            ? 'File fixed'
            : 'Specialist created',
      );
      onChanged();
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setErrors({ name: cause.message });
      } else {
        toast(errorMessage(cause, "Couldn't save the specialist."), 'error');
      }
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!editName) return;
    setIsDeleting(true);
    try {
      await deleteAgent(workspaceId, editName);
      toast('Specialist deleted');
      onChanged();
      onClose();
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete the specialist."), 'error');
      setIsDeleting(false);
      setIsDeleteOpen(false);
    }
  };
  const cancelDelete = useCallback(() => setIsDeleteOpen(false), []);

  const warning = draftWarning(draft);
  const slug = toAgentName(draft.name);
  const fileName = `${slug || 'name'}.md`;
  const isAllTools = draft.toolGroups.length === TOOL_GROUPS.length;
  const steps = [
    { label: 'Identity', done: slug !== '' && draft.description.trim() !== '' },
    { label: 'Access', done: draft.toolGroups.length > 0 },
    { label: 'Role', done: draft.instructions.trim() !== '' },
  ];
  const title =
    target.kind === 'edit'
      ? 'Edit specialist'
      : target.kind === 'fix'
        ? 'Fix specialist file'
        : 'New specialist';

  const header = (
    <div className="flex shrink-0 items-center gap-4 border-b border-line bg-surface py-3 pl-5 pr-3">
      <span className="brand-mark h-10 w-10 rounded-xl">
        <BrainIcon size={18} />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-[16px] font-bold text-ink">{title}</h2>
          {isDirty && target.kind === 'edit' && <Badge tone="yellow">Unsaved</Badge>}
        </div>
        <p className="truncate text-[12.5px] text-ink-3">
          A teammate the agent can hand work to: who it is, what it may touch, how it works.
        </p>
      </div>
      <ol className="ml-auto hidden items-center gap-1 md:flex" aria-label="Progress">
        {steps.map((step, index) => (
          <li key={step.label} className="flex items-center gap-1">
            {index > 0 && (
              <span
                aria-hidden
                className={`h-px w-5 ${steps[index - 1]?.done ? 'bg-accent' : 'bg-line-strong'}`}
              />
            )}
            <span
              className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold transition-colors ${
                step.done ? 'bg-accent-soft text-accent-2' : 'text-ink-3'
              }`}
            >
              <span
                className={`grid h-4 w-4 place-items-center rounded-full text-[10px] tabular-nums ${
                  step.done ? 'bg-accent text-on-accent' : 'border border-line-strong'
                }`}
              >
                {step.done ? <CheckIcon size={9} /> : index + 1}
              </span>
              {step.label}
              <span className="sr-only">{step.done ? '(done)' : '(to do)'}</span>
            </span>
          </li>
        ))}
      </ol>
      <IconButton onClick={requestClose} aria-label="Close" className="ml-2 md:ml-3">
        <CrossIcon />
      </IconButton>
    </div>
  );

  const footer = isClosing ? (
    <>
      <span role="alert" className="mr-auto flex items-center gap-2 text-[13px] text-ink-2">
        <WarnIcon className="text-warn" /> You have unsaved changes.
      </span>
      <Button size="sm" onClick={() => setIsClosing(false)}>
        Keep editing
      </Button>
      <Button size="sm" variant="danger" onClick={onClose}>
        Discard and close
      </Button>
    </>
  ) : (
    <>
      {editName && (
        <Button
          size="sm"
          variant="danger-ghost"
          onClick={() => setIsDeleteOpen(true)}
          disabled={isSaving || isLoading}
        >
          <TrashIcon /> Delete
        </Button>
      )}
      <span className="mr-auto hidden items-center gap-1.5 truncate text-[12px] text-ink-3 sm:flex">
        <FileIcon size={13} />
        Saved as
        <code className="truncate font-mono text-ink-2">
          .code-ai/&lt;workspace&gt;/agents/{fileName}
        </code>
      </span>
      <Button size="sm" onClick={requestClose} disabled={isSaving}>
        Cancel
      </Button>
      <Button
        size="sm"
        variant="primary"
        type="submit"
        form="agent-form"
        disabled={isSaving || isLoading}
      >
        {isSaving ? <Spinner size={12} /> : <CheckIcon size={12} />}
        {isSaving
          ? 'Saving…'
          : target.kind === 'edit'
            ? 'Save changes'
            : target.kind === 'fix'
              ? 'Save and fix'
              : 'Create specialist'}
      </Button>
    </>
  );

  return (
    <>
      <Modal title={title} size="wide" onClose={requestClose} header={header} footer={footer}>
        {isLoading ? (
          <PageLoader />
        ) : (
          <form
            id="agent-form"
            noValidate
            onSubmit={(event) => void submit(event)}
            className="flex flex-col lg:grid lg:h-full lg:grid-cols-[340px_minmax(0,1fr)]"
          >
            {/* ---------- Left rail: who it is, and a preview ---------- */}
            <aside className="flex flex-col gap-6 border-b border-line bg-subtle p-5 lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
              {target.kind === 'fix' && (
                <div className="flex items-start gap-2 rounded-xl border border-line border-l-4 border-l-warn-line bg-surface p-3 text-[12.5px] leading-snug text-ink-2">
                  <WarnIcon size={14} className="mt-0.5 shrink-0 text-warn" />
                  <span>
                    The file wasn&apos;t used: {target.problem} Fill in the form and save to rewrite
                    it
                    {target.replacesFile ? (
                      <>
                        {' '}
                        as <span className="font-mono">{fileName}</span> (
                        <span className="font-mono">{target.replacesFile}</span> is removed)
                      </>
                    ) : null}
                    .
                  </span>
                </div>
              )}

              <section>
                <h3 className="eyebrow">Identity</h3>
                <label
                  htmlFor="agent-name"
                  className="mt-3 block text-[13px] font-semibold text-ink"
                >
                  Name
                </label>
                <input
                  id="agent-name"
                  value={draft.name}
                  autoFocus={target.kind !== 'edit'}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={AGENT_LIMITS.nameLength}
                  placeholder="security-auditor"
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby="agent-name-hint"
                  onChange={(event) => change('name', event.target.value)}
                  onBlur={() =>
                    setDraft((current) => ({ ...current, name: toAgentName(current.name) }))
                  }
                  className={`${INPUT} ${errors.name ? INPUT_ERROR : INPUT_OK} font-mono text-[13.5px]`}
                />
                {errors.name && (
                  <p role="alert" className={ERROR}>
                    {errors.name}
                  </p>
                )}
                <p id="agent-name-hint" className="mt-1.5 text-[12px] leading-snug text-ink-3">
                  What the agent asks for. Use a built-in&apos;s name (coder, researcher…) to
                  replace that built-in here.
                </p>

                <label
                  htmlFor="agent-description"
                  className="mt-5 flex items-baseline justify-between text-[13px] font-semibold text-ink"
                >
                  When to use it
                  <span className="text-[11px] font-normal tabular-nums text-ink-3">
                    {draft.description.length}/{AGENT_LIMITS.descriptionLength}
                  </span>
                </label>
                <textarea
                  id="agent-description"
                  rows={4}
                  value={draft.description}
                  maxLength={AGENT_LIMITS.descriptionLength}
                  placeholder={DESCRIPTION_PLACEHOLDER}
                  aria-invalid={errors.description ? true : undefined}
                  onChange={(event) => change('description', event.target.value)}
                  className={`${INPUT} ${errors.description ? INPUT_ERROR : INPUT_OK} resize-y text-[13.5px] leading-relaxed`}
                />
                {errors.description && (
                  <p role="alert" className={ERROR}>
                    {errors.description}
                  </p>
                )}
                <p className="mt-1.5 text-[12px] leading-snug text-ink-3">
                  The agent reads this to decide when to hand work over.
                </p>
              </section>

              <section className="mt-auto">
                <h3 className="eyebrow">How the agent sees it</h3>
                <div className="mt-3 rounded-xl border border-line bg-surface p-3.5 shadow-card">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-[12px] font-extrabold uppercase text-accent-2">
                      {initials(slug)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold text-ink">
                      {slug || 'name'}
                    </span>
                    {draft.readOnly && (
                      <Badge tone="blue" icon={<EyeIcon size={10} />}>
                        Read-only
                      </Badge>
                    )}
                  </div>
                  <p
                    className={`mt-2 line-clamp-3 text-[12px] leading-snug ${
                      draft.description.trim() ? 'text-ink-2' : 'italic text-ink-3'
                    }`}
                  >
                    {draft.description.trim() || 'No description yet.'}
                  </p>
                  <p className="mt-2.5 border-t border-line-2 pt-2 text-[11.5px] text-ink-3">
                    {describeAccess(draft)}
                  </p>
                </div>
              </section>
            </aside>

            {/* ---------- Main: access, model, role ---------- */}
            <div className="flex min-w-0 flex-col gap-5 p-5 lg:min-h-0 lg:overflow-y-auto">
              <section
                aria-labelledby="agent-tools-label"
                className="shrink-0 rounded-2xl border border-line bg-surface p-4 shadow-card"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id="agent-tools-label" className="text-[14px] font-semibold text-ink">
                    Tools it can use
                  </h3>
                  <Badge tone={draft.toolGroups.length ? 'blue' : 'red'}>
                    {draft.toolGroups.length} of {TOOL_GROUPS.length}
                  </Badge>
                  <span className="ml-auto" />
                  <button
                    type="button"
                    onClick={() => change('toolGroups', isAllTools ? [] : [...TOOL_GROUPS])}
                    className="rounded-md px-1.5 py-0.5 text-[12px] font-semibold text-accent-2 transition-colors hover:bg-accent-soft"
                  >
                    {isAllTools ? 'Clear all' : 'Select all'}
                  </button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {TOOL_GROUPS.map((group) => {
                    const isOn = draft.toolGroups.includes(group);
                    const { label, detail } = TOOL_GROUP_LABELS[group];
                    const Icon = GROUP_ICONS[group];
                    return (
                      <button
                        key={group}
                        type="button"
                        role="switch"
                        aria-checked={isOn}
                        aria-label={`${label} tools`}
                        onClick={() =>
                          change('toolGroups', toggleGroup(draft.toolGroups, group, !isOn))
                        }
                        className={`group flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                          isOn
                            ? 'border-accent bg-accent-soft'
                            : 'border-line bg-surface hover:border-line-strong hover:bg-subtle'
                        }`}
                      >
                        <span
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors ${
                            isOn ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-3'
                          }`}
                        >
                          <Icon size={15} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`flex items-center justify-between gap-2 text-[13px] font-semibold ${
                              isOn ? 'text-ink' : 'text-ink-2'
                            }`}
                          >
                            {label}
                            <span
                              aria-hidden
                              className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors ${
                                isOn
                                  ? 'border-accent bg-accent text-on-accent'
                                  : 'border-line-strong'
                              }`}
                            >
                              {isOn && <CheckIcon size={9} />}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">
                            {detail}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {errors.toolGroups && (
                  <p role="alert" className={ERROR}>
                    {errors.toolGroups}
                  </p>
                )}
                <p className="mt-2.5 text-[12px] text-ink-3">
                  Groups the workspace turned off stay off for every specialist.
                </p>
              </section>

              <div className="grid shrink-0 gap-5 xl:grid-cols-2">
                <fieldset className="rounded-2xl border border-line bg-surface p-4 shadow-card">
                  <legend className="sr-only">What it may change</legend>
                  <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
                    <ShieldIcon size={14} className="text-accent-2" /> What it may change
                  </h3>
                  <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
                    {ACCESS.map((option) => {
                      const isPicked = draft.readOnly === option.readOnly;
                      return (
                        <label
                          key={option.label}
                          className={`flex cursor-pointer flex-col rounded-lg px-3 py-2 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus ${
                            isPicked ? 'bg-surface shadow-card' : 'hover:bg-surface/60'
                          }`}
                        >
                          <input
                            type="radio"
                            name="agent-access"
                            checked={isPicked}
                            onChange={() => change('readOnly', option.readOnly)}
                            className="sr-only"
                          />
                          <span
                            className={`text-[13px] font-semibold ${isPicked ? 'text-ink' : 'text-ink-2'}`}
                          >
                            {option.label}
                          </span>
                          <span className="text-[11.5px] leading-snug text-ink-3">
                            {option.detail}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {warning && (
                    <p className="mt-2.5 flex items-start gap-1.5 text-[12px] leading-snug text-warn">
                      <WarnIcon size={13} className="mt-0.5 shrink-0" /> {warning}
                    </p>
                  )}
                </fieldset>

                <fieldset className="rounded-2xl border border-line bg-surface p-4 shadow-card">
                  <legend className="sr-only">Model</legend>
                  <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
                    <BoltIcon size={14} className="text-accent-2" /> Model it runs on
                  </h3>
                  <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
                    {MODELS.map((model) => {
                      const isPicked = draft.model === model.id;
                      return (
                        <label
                          key={model.id}
                          className={`flex cursor-pointer flex-col rounded-lg px-3 py-2 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus ${
                            isPicked ? 'bg-surface shadow-card' : 'hover:bg-surface/60'
                          }`}
                        >
                          <input
                            type="radio"
                            name="agent-model"
                            value={model.id}
                            checked={isPicked}
                            onChange={() => change('model', model.id)}
                            className="sr-only"
                          />
                          <span
                            className={`text-[13px] font-semibold ${isPicked ? 'text-ink' : 'text-ink-2'}`}
                          >
                            {model.label}
                          </span>
                          <span className="text-[11.5px] leading-snug text-ink-3">
                            {model.detail}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </div>

              <section className="flex min-h-[280px] flex-1 flex-col">
                <div
                  className={`flex flex-1 flex-col overflow-hidden rounded-2xl border bg-surface shadow-card transition-colors focus-within:border-accent ${
                    errors.instructions ? 'border-danger-line' : 'border-line'
                  }`}
                >
                  <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-subtle px-4">
                    <label
                      htmlFor="agent-instructions"
                      className="text-[13px] font-semibold text-ink"
                    >
                      Role
                    </label>
                    <span className="text-[12px] text-ink-3">· Markdown, optional</span>
                    <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-3">
                      {draft.instructions.length.toLocaleString('en')} /{' '}
                      {AGENT_LIMITS.instructionsChars.toLocaleString('en')}
                    </span>
                  </div>
                  <textarea
                    id="agent-instructions"
                    value={draft.instructions}
                    maxLength={AGENT_LIMITS.instructionsChars}
                    placeholder={ROLE_PLACEHOLDER}
                    aria-invalid={errors.instructions ? true : undefined}
                    aria-describedby="agent-instructions-hint"
                    onChange={(event) => change('instructions', event.target.value)}
                    className="min-h-[200px] flex-1 resize-none bg-transparent px-4 py-3.5 font-mono text-[13px] leading-[1.7] text-ink outline-none placeholder:text-ink-3"
                  />
                  <div className="h-1 shrink-0 bg-surface-2">
                    <div
                      className="h-full bg-accent transition-[width]"
                      style={{
                        width: `${Math.min(100, (draft.instructions.length / AGENT_LIMITS.instructionsChars) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
                {errors.instructions && (
                  <p role="alert" className={ERROR}>
                    {errors.instructions}
                  </p>
                )}
                <p id="agent-instructions-hint" className="mt-2 text-[12px] text-ink-3">
                  Added to its instructions: who it is, how it works, what it reports back. It
                  can&apos;t turn off approvals.
                </p>
              </section>
            </div>
          </form>
        )}
      </Modal>

      {editName && (
        <ConfirmDeleteDialog
          open={isDeleteOpen}
          title="Delete this specialist?"
          message={
            <>
              <strong className="font-mono text-ink">{editName}</strong> is deleted from this
              workspace. The agent can&apos;t pick it from your next message.
            </>
          }
          busy={isDeleting}
          onCancel={cancelDelete}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </>
  );
}

/** "security-auditor" → "SA": the preview card's tile. */
const initials = (name: string) =>
  name
    .split('-')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('') || '?';
