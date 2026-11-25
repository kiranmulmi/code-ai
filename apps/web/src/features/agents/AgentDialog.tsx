import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AGENT_LIMITS,
  TOOL_GROUPS,
  TOOL_GROUP_LABELS,
  toAgentName,
  type SpecialistInfo,
  type SpecialistModel,
} from '@app/shared';
import { Button } from '../../components/Button';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { ERROR, HINT, INPUT, INPUT_ERROR, INPUT_OK, LABEL } from '../../components/form';
import { Modal } from '../../components/Modal';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { Switch } from '../../components/Switch';
import { ApiError, errorMessage, isNotFound } from '../../lib/api';
import { WarnIcon } from '../../lib/icons';
import { useToast } from '../../lib/toast';
import {
  EMPTY_DRAFT,
  checkDraft,
  draftFrom,
  draftWarning,
  isSameDraft,
  toggleGroup,
  type AgentDraft,
  type AgentErrors,
  type AgentField,
} from './agentDraft';
import { createAgent, deleteAgent, fetchAgent, updateAgent } from './api';

const SECTION = 'px-5 py-4';
const DESCRIPTION_PLACEHOLDER =
  'Checking code for security problems: injection, secrets, unsafe input.';
const ROLE_PLACEHOLDER = `You are the team's security auditor. Read the code you're pointed at and list each problem with file, line and a fix, most serious first. Post the serious ones as team notes.`;

const MODELS: ReadonlyArray<{ id: SpecialistModel; label: string; detail: string }> = [
  { id: 'subagent', label: 'Sub-agent model', detail: 'Settings → Agent → Sub-agent model' },
  { id: 'review', label: 'Reviewer model', detail: 'The model that checks answers, when set' },
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
  const fileName = `${toAgentName(draft.name) || 'name'}.md`;

  const footer = isClosing ? (
    <>
      <span role="alert" className="mr-auto text-[13px] text-ink-2">
        You have unsaved changes.
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
          variant="danger"
          onClick={() => setIsDeleteOpen(true)}
          disabled={isSaving || isLoading}
        >
          Delete
        </Button>
      )}
      <span className="mr-auto" />
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
        {isSaving && <Spinner size={12} />}
        {isSaving
          ? 'Saving…'
          : target.kind === 'edit'
            ? 'Save'
            : target.kind === 'fix'
              ? 'Save and fix'
              : 'Create specialist'}
      </Button>
    </>
  );

  const title =
    target.kind === 'edit'
      ? 'Edit specialist'
      : target.kind === 'fix'
        ? 'Fix specialist file'
        : 'New specialist';

  return (
    <>
      <Modal title={title} titleFont="sans" size="lg" onClose={requestClose} footer={footer}>
        {isLoading ? (
          <PageLoader />
        ) : (
          <form
            id="agent-form"
            noValidate
            onSubmit={(event) => void submit(event)}
            className="flex flex-col divide-y divide-line-2"
          >
            {target.kind === 'fix' && (
              <div
                className={`${SECTION} flex items-start gap-2 bg-warn-bg/40 text-[13px] text-ink-2`}
              >
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

            <div className={`${SECTION} grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]`}>
              <div className="min-w-0">
                <label htmlFor="agent-name" className={LABEL}>
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
                  onChange={(event) => change('name', event.target.value)}
                  onBlur={() =>
                    setDraft((current) => ({ ...current, name: toAgentName(current.name) }))
                  }
                  className={`${INPUT} ${errors.name ? INPUT_ERROR : INPUT_OK} font-mono text-[13px]`}
                />
                {errors.name && (
                  <p role="alert" className={ERROR}>
                    {errors.name}
                  </p>
                )}
                <p className={HINT}>
                  What the agent asks for. Saved as{' '}
                  <span className="break-all font-mono text-[12px]">
                    .code-ai/{'<workspace>'}/agents/{fileName}
                  </span>
                  . A built-in&apos;s name (coder, researcher…) replaces that built-in here.
                </p>
              </div>

              <div className="min-w-0">
                <label htmlFor="agent-description" className={LABEL}>
                  When to use it
                </label>
                <textarea
                  id="agent-description"
                  rows={2}
                  value={draft.description}
                  maxLength={AGENT_LIMITS.descriptionLength}
                  placeholder={DESCRIPTION_PLACEHOLDER}
                  aria-invalid={errors.description ? true : undefined}
                  onChange={(event) => change('description', event.target.value)}
                  className={`${INPUT} ${errors.description ? INPUT_ERROR : INPUT_OK} resize-y leading-relaxed`}
                />
                {errors.description && (
                  <p role="alert" className={ERROR}>
                    {errors.description}
                  </p>
                )}
                <p className={HINT}>
                  The agent sees this and picks the specialist when work fits it.
                </p>
              </div>
            </div>

            <div className={SECTION}>
              <span id="agent-tools-label" className={LABEL}>
                Tools
              </span>
              <ul aria-labelledby="agent-tools-label" className="panel mt-2 divide-y divide-line-2">
                {TOOL_GROUPS.map((group) => {
                  const isOn = draft.toolGroups.includes(group);
                  const { label, detail } = TOOL_GROUP_LABELS[group];
                  return (
                    <li key={group} className="flex items-center gap-3 px-3.5 py-2">
                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-[13.5px] font-medium ${isOn ? 'text-ink' : 'text-ink-3'}`}
                        >
                          {label}
                        </div>
                        <div className="text-[12.5px] leading-snug text-ink-3">{detail}</div>
                      </div>
                      <Switch
                        isOn={isOn}
                        label={`${label} tools`}
                        onChange={(next) =>
                          change('toolGroups', toggleGroup(draft.toolGroups, group, next))
                        }
                      />
                    </li>
                  );
                })}
                <li className="flex items-center gap-3 px-3.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-ink">Read-only</div>
                    <div className="text-[12.5px] leading-snug text-ink-3">
                      Only tools that change nothing: no writing files, commands or memory changes
                    </div>
                  </div>
                  <Switch
                    isOn={draft.readOnly}
                    label="Read-only"
                    onChange={(next) => change('readOnly', next)}
                  />
                </li>
              </ul>
              {errors.toolGroups && (
                <p role="alert" className={ERROR}>
                  {errors.toolGroups}
                </p>
              )}
              {warning && (
                <p className={`${HINT} flex items-start gap-1.5 text-warn`}>
                  <WarnIcon size={13} className="mt-0.5 shrink-0" /> {warning}
                </p>
              )}
              <p className={HINT}>
                Tool groups the workspace turned off stay off for every specialist.
              </p>
            </div>

            <fieldset className={SECTION}>
              <legend className={`${LABEL} mb-2`}>Model</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {MODELS.map((model) => (
                  <label
                    key={model.id}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${
                      draft.model === model.id
                        ? 'border-accent bg-accent-bg/40'
                        : 'border-line hover:border-line-strong'
                    }`}
                  >
                    <input
                      type="radio"
                      name="agent-model"
                      value={model.id}
                      checked={draft.model === model.id}
                      onChange={() => change('model', model.id)}
                      className="mt-1 accent-[var(--accent)]"
                    />
                    <span>
                      <span className="block text-[13.5px] font-medium text-ink">
                        {model.label}
                      </span>
                      <span className="block text-[12.5px] leading-snug text-ink-3">
                        {model.detail}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className={SECTION}>
              <label htmlFor="agent-instructions" className={LABEL}>
                Role <span className="font-normal text-ink-3">· Markdown, optional</span>
              </label>
              <textarea
                id="agent-instructions"
                rows={8}
                value={draft.instructions}
                maxLength={AGENT_LIMITS.instructionsChars}
                placeholder={ROLE_PLACEHOLDER}
                aria-invalid={errors.instructions ? true : undefined}
                onChange={(event) => change('instructions', event.target.value)}
                className={`${INPUT} ${errors.instructions ? INPUT_ERROR : INPUT_OK} resize-y font-mono text-[13px] leading-relaxed`}
              />
              {errors.instructions && (
                <p role="alert" className={ERROR}>
                  {errors.instructions}
                </p>
              )}
              <p className={`${HINT} flex flex-wrap justify-between gap-x-4`}>
                <span>
                  Added to the specialist&apos;s instructions: who it is, how it works, what it
                  reports back. It can&apos;t turn off approvals.
                </span>
                <span className="tabular-nums">
                  {draft.instructions.length.toLocaleString('en')} /{' '}
                  {AGENT_LIMITS.instructionsChars.toLocaleString('en')}
                </span>
              </p>
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
