import { useRef, useState, type FormEvent } from 'react';
import { LIMITS, workspaceUpdateSchema, type Workspace } from '@app/shared';
import { Button } from '../../../components/Button';
import { Spinner } from '../../../components/Spinner';
import { errorMessage } from '../../../lib/api';
import { useToast } from '../../../lib/toast';
import { updateWorkspace } from '../../workspaces/api';
import { writeInstructions } from '../../workspaces/api';
import { announceWorkspaceSaved } from '../../workspaces/workspaceEvents';
import { PanelMessage } from '../PanelMessage';
import { SectionHeader, SectionPage } from '../../customize/SectionLayout';
import { WandIcon, CheckIcon, InstructionsIcon, BrainIcon } from '../../../lib/icons';

const STARTERS = [
  { label: 'Coding assistant', desc: 'Expert on this project codebase', request: 'Coding assistant for this project' },
  { label: 'Code reviewer', desc: 'Find bugs and suggest clean fixes', request: 'Code reviewer: find bugs and suggest fixes' },
  { label: 'Writing tutor', desc: 'Correct English and improve tone', request: 'Writing tutor: correct my English' },
];

const REFINEMENTS = [
  { label: 'Tidy up', request: '' },
  { label: 'Make shorter', request: 'Make it shorter and keep only what matters most.' },
  { label: 'More detailed', request: 'Make it more detailed and specific to this project.' },
  { label: 'Add check steps', request: 'Add what to check before a task is done (build, tests, lint), from the project.' },
];

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
  const [isWriting, setIsWriting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [aiRequest, setAiRequest] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const saved = workspace?.instructions ?? '';
  const value = draft ?? saved;
  const isDirty = draft !== null && draft !== saved;

  if (!workspace) {
    return (
      <div className="p-6">
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
      setFieldError(null);
      toast('Instructions saved');
      announceWorkspaceSaved();
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't save the instructions."), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const runAi = async (req: string) => {
    if (isWriting) return;
    setIsWriting(true);
    setAiError(null);
    try {
      const updated = await writeInstructions({
        request: req.trim(),
        current: value,
        name: workspace.name.trim() || undefined,
        path: workspace.path.trim() || undefined,
      });
      setBefore(value);
      onDraftChange(updated);
      setAiRequest('');
      textareaRef.current?.focus();
    } catch (cause) {
      setAiError(errorMessage(cause, "Couldn't write the instructions."));
    } finally {
      setIsWriting(false);
    }
  };

  const undo = () => {
    if (before === null) return;
    onDraftChange(before);
    setBefore(null);
    textareaRef.current?.focus();
  };

  return (
    <SectionPage>
      <SectionHeader
        icon={<InstructionsIcon size={18} />}
        title="Instructions"
        description={
          <>
            How the agent behaves in every chat in{' '}
            <span className="font-semibold text-ink">{workspace.name}</span>: its role, the
            project&apos;s rules and what to check before a task is done.
          </>
        }
        actions={
          <>
            {isDirty && (
              <Button
                onClick={() => {
                  onDraftChange(null);
                  setFieldError(null);
                }}
                disabled={isSaving}
              >
                Discard
              </Button>
            )}
            <Button
              variant="primary"
              onClick={(e) => void save(e)}
              disabled={isSaving || !isDirty}
            >
              {isSaving ? <Spinner size={14} /> : <CheckIcon size={14} />}
              {isSaving ? 'Saving…' : isDirty ? 'Save changes' : 'Saved'}
            </Button>
          </>
        }
      />

      {/* Single Column Layout */}
      <div className="flex flex-col gap-6">
        {/* Editor Card */}
        <div className="panel flex flex-col overflow-hidden bg-surface shadow-card">
          <div className="flex items-center justify-between border-b border-line px-5 py-4 bg-subtle">
            <div className="flex items-center gap-2">
              <InstructionsIcon size={16} className="text-accent" />
              <span className="text-[13.5px] font-bold text-ink">Instructions Prompt</span>
            </div>
            <div className="flex items-center gap-3">
              {before !== null && !isWriting && (
                <button type="button" onClick={undo} className="text-[12.5px] font-semibold text-accent-2 hover:underline">
                  ↺ Undo AI change
                </button>
              )}
              <span className="text-[12.5px] font-medium tabular-nums text-ink-3">
                <span className={value.length > LIMITS.instructions ? 'text-danger font-bold' : 'text-ink'}>
                  {value.length.toLocaleString('en')}
                </span>{' '}
                / {LIMITS.instructions.toLocaleString('en')} chars
              </span>
            </div>
          </div>

          <div className="p-5">
            <textarea
              ref={textareaRef}
              value={value}
              readOnly={isWriting}
              maxLength={LIMITS.instructions}
              onChange={(e) => { onDraftChange(e.target.value); setFieldError(null); }}
              placeholder="How the agent should behave in every chat of this workspace. For example: You are my English tutor. Gently correct my mistakes in each message and show a better version."
              className={`block h-[340px] w-full resize-y rounded-xl border bg-surface p-4 text-[14px] leading-[1.7] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/20 ${fieldError ? 'border-danger-line' : 'border-line hover:border-line-strong'} ${isWriting ? 'animate-pulse opacity-60' : ''}`}
            />
            {fieldError && <p role="alert" className="mt-2 text-[13px] font-medium text-danger">{fieldError}</p>}
          </div>

          <div className="flex items-center justify-between border-t border-line bg-subtle px-5 py-3 text-[12.5px] text-ink-3">
            <span className="flex items-center gap-1.5">
              <BrainIcon size={13} className="text-accent" />
              Memories are kept separately for each workspace.
            </span>
            <span className="font-medium text-ink-2">
              {isDirty ? 'Unsaved changes' : 'All changes saved'}
            </span>
          </div>
        </div>

        {/* AI Prompt Assistant Card */}
        <div className="panel bg-surface p-6 shadow-card">
          <div className="flex items-center gap-2 text-accent-2 font-bold text-[14px]">
            <WandIcon size={16} />
            AI Prompt Assistant
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
            Describe what you want or let AI generate professional instructions tailored to <span className="font-semibold text-ink">{workspace.name}</span>.
          </p>

          <div className="mt-4 flex flex-col gap-4">
            <textarea
              value={aiRequest}
              onChange={(e) => setAiRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void runAi(aiRequest || (value ? 'Tidy it up and make it clearer' : 'Create standard coding assistant instructions'));
                }
              }}
              placeholder={value ? 'Ask AI to modify instructions (e.g. "always reply in bullet points")...' : 'Describe your project or preferred persona...'}
              rows={3}
              disabled={isWriting}
              className="w-full rounded-xl border border-line bg-subtle p-3.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/25 resize-none disabled:opacity-60"
            />

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <span className="text-[11.5px] text-ink-3">Cmd+Enter to run</span>
              <Button
                size="md"
                variant="primary"
                onClick={() => void runAi(aiRequest || (value ? 'Tidy it up and make it clearer' : 'Create standard coding assistant instructions for this repository'))}
                disabled={isWriting}
              >
                {isWriting ? <Spinner size={14} /> : <WandIcon size={14} />}
                {isWriting ? 'Generating instructions…' : value ? 'Rewrite with AI' : 'Generate Instructions'}
              </Button>
            </div>

            {aiError && (
              <p role="alert" className="text-[13px] text-danger font-medium">
                {aiError}
              </p>
            )}
          </div>

          {/* Quick Refinements / Starters */}
          <div className="mt-6 border-t border-line pt-5">
            <span className="block text-[11.5px] font-bold uppercase tracking-[0.1em] text-ink-3 mb-3">
              {value ? 'Quick Refinements' : 'Starter Personas'}
            </span>

            {value ? (
              <div className="flex flex-wrap gap-2">
                {REFINEMENTS.map((ref) => (
                  <button
                    key={ref.label}
                    type="button"
                    disabled={isWriting}
                    onClick={() => void runAi(ref.request)}
                    className="rounded-lg border border-line bg-subtle px-3.5 py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent-2 disabled:opacity-50"
                  >
                    {ref.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {STARTERS.map((st) => (
                  <button
                    key={st.label}
                    type="button"
                    disabled={isWriting}
                    onClick={() => void runAi(st.request)}
                    className="flex flex-col items-start rounded-xl border border-line bg-subtle p-3.5 text-left transition-all hover:border-accent hover:bg-accent-soft group disabled:opacity-50"
                  >
                    <span className="text-[13px] font-semibold text-ink group-hover:text-accent-2">
                      {st.label}
                    </span>
                    <span className="text-[12px] text-ink-3 mt-1 leading-snug">
                      {st.desc}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </SectionPage>
  );
}
