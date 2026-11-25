import { useEffect, useState, type FormEvent } from 'react';
import { LIMITS, workspaceUpdateSchema, type Workspace } from '@app/shared';
import { Button } from '../../../components/Button';
import { ERROR, HINT } from '../../../components/form';
import { Spinner } from '../../../components/Spinner';
import { errorMessage } from '../../../lib/api';
import { useToast } from '../../../lib/toast';
import { updateWorkspace } from '../../workspaces/api';
import { InstructionsEditor } from '../../workspaces/InstructionsEditor';
import { announceWorkspaceSaved } from '../../workspaces/workspaceEvents';
import { PanelMessage } from '../PanelMessage';

/**
 * The Instructions tab: the workspace's instructions for the agent, with the AI writer. The
 * draft lives in ChatScreen (`draft`, null while unchanged), so it survives switching tabs.
 */
export function InstructionsPanel({
  workspaceId,
  workspace,
  isLoading,
  error,
  onRetry,
  draft,
  onDraftChange,
}: {
  workspaceId: string;
  workspace: Workspace | null;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  draft: string | null;
  onDraftChange: (draft: string | null) => void;
}) {
  const toast = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const saved = workspace?.instructions ?? '';
  const value = draft ?? saved;
  const isDirty = draft !== null && draft !== saved;

  // Closing the window or reloading with unsaved changes: the browser asks first.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  if (!workspace) {
    return (
      <div className="p-4">
        <PanelMessage isLoading={isLoading} error={error} onRetry={onRetry} />
      </div>
    );
  }

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (isSaving || !isDirty) return;
    const parsed = workspaceUpdateSchema.safeParse({ instructions: value });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Check the instructions.');
      return;
    }
    setIsSaving(true);
    try {
      await updateWorkspace(workspaceId, { instructions: parsed.data.instructions });
      onDraftChange(null);
      toast('Instructions saved');
      announceWorkspaceSaved();
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't save the instructions."), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void save(event)}
      className="mx-auto max-w-4xl p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <label htmlFor="workspace-instructions" className="text-[14px] font-medium text-ink">
            Instructions <span className="font-normal text-ink-3">· optional</span>
          </label>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
            Added to the agent&apos;s prompt in every chat of this workspace, from the next message.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isDirty && (
            <Button
              size="sm"
              onClick={() => {
                onDraftChange(null);
                setFieldError(null);
              }}
              disabled={isSaving}
            >
              Discard
            </Button>
          )}
          <Button size="sm" variant="primary" type="submit" disabled={isSaving || !isDirty}>
            {isSaving && <Spinner size={12} />}
            {isSaving ? 'Saving…' : isDirty ? 'Save' : 'Saved'}
          </Button>
        </div>
      </div>

      <InstructionsEditor
        id="workspace-instructions"
        value={value}
        onChange={(next) => {
          onDraftChange(next);
          setFieldError(null);
        }}
        hasError={fieldError !== null}
        describedBy="workspace-instructions-hint"
        workspaceName={workspace.name}
        folderPath={workspace.path}
      />
      {fieldError && (
        <p role="alert" className={ERROR}>
          {fieldError}
        </p>
      )}
      <p
        id="workspace-instructions-hint"
        className={`${HINT} flex flex-wrap justify-between gap-x-4`}
      >
        <span>Memories are kept separately for each workspace.</span>
        <span className="tabular-nums">
          {value.length.toLocaleString('en')} / {LIMITS.instructions.toLocaleString('en')}
        </span>
      </p>
    </form>
  );
}
