import { useCallback, useState } from 'react';
import type { AgentFileProblem, SpecialistInfo, SpecialistList } from '@app/shared';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { errorMessage } from '../../lib/api';
import { plural } from '../../lib/format';
import { CopyIcon, CrossIcon, PlusIcon, WarnIcon, WrenchIcon } from '../../lib/icons';
import { useToast } from '../../lib/toast';
import type { AsyncResource } from '../../lib/useAsync';
import { specialistTitle } from '../chat/tools';
import { PanelMessage } from '../panel/PanelMessage';
import { AgentDialog, type AgentDialogTarget } from './AgentDialog';
import { describeAccess, draftFrom, fixTarget } from './agentDraft';
import { deleteAgent } from './api';

/** What the delete confirmation is for: a specialist, or a broken file. */
type PendingDelete = { kind: 'specialist'; name: string } | { kind: 'file'; file: string };

/**
 * The Agents tab: the specialists the agent can hand work to (with sub-agents on in Settings →
 * Agent). The workspace's own come first and can be edited; the built-ins can be copied to
 * start one. Files in the agents folder that couldn't be used show with why, to fix or delete.
 */
export function AgentsPanel({
  workspaceId,
  agents,
}: {
  workspaceId: string;
  agents: AsyncResource<SpecialistList>;
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState<AgentDialogTarget | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const closeDialog = useCallback(() => setDialog(null), []);
  const cancelDelete = useCallback(() => setPending(null), []);
  const { reload } = agents;

  const confirmDelete = async () => {
    if (!pending) return;
    setIsDeleting(true);
    try {
      await deleteAgent(workspaceId, pending.kind === 'file' ? pending.file : pending.name);
      toast(pending.kind === 'file' ? 'File deleted' : 'Specialist deleted');
      reload();
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete it."), 'error');
    } finally {
      setIsDeleting(false);
      setPending(null);
    }
  };

  const own = agents.data?.specialists.filter((s) => !s.isBuiltIn) ?? [];
  const builtIns = agents.data?.specialists.filter((s) => s.isBuiltIn) ?? [];
  const problems = agents.data?.problems ?? [];

  return (
    <>
      <div className="mb-2 flex min-h-7 items-center justify-between gap-2">
        <span className="eyebrow">
          {own.length ? plural(own.length, 'specialist') : 'Specialists'}
        </span>
        <Button size="sm" onClick={() => setDialog({ kind: 'new' })}>
          <PlusIcon size={11} /> New specialist
        </Button>
      </div>

      {!agents.data ? (
        <PanelMessage isLoading={agents.isLoading} error={agents.error} onRetry={reload} />
      ) : (
        <div className="flex flex-col gap-4">
          {problems.length > 0 && (
            <ProblemList
              problems={problems}
              onFix={(problem) =>
                setDialog({ kind: 'fix', ...fixTarget(problem.file), problem: problem.problem })
              }
              onDelete={(problem) => setPending({ kind: 'file', file: problem.file })}
            />
          )}

          <ul className={own.length ? 'panel divide-y divide-line-2' : ''}>
            {own.length === 0 && (
              <li className="border border-dashed border-line px-4 py-5 text-center text-[13px] text-ink-3">
                None of your own yet. Make one for work you hand off often, like a security review,
                or copy a built-in below and change it.
              </li>
            )}
            {own.map((specialist) => (
              <SpecialistRow
                key={specialist.name}
                specialist={specialist}
                onOpen={() => setDialog({ kind: 'edit', name: specialist.name })}
                onDelete={() => setPending({ kind: 'specialist', name: specialist.name })}
              />
            ))}
          </ul>

          <section aria-labelledby="built-in-agents">
            <h3 id="built-in-agents" className="eyebrow mb-2">
              Built in
            </h3>
            <ul className="panel divide-y divide-line-2">
              {builtIns.map((specialist) => (
                <SpecialistRow
                  key={specialist.name}
                  specialist={specialist}
                  onOpen={() =>
                    setDialog({
                      kind: 'new',
                      start: { ...draftFrom(specialist), name: `my-${specialist.name}` },
                    })
                  }
                />
              ))}
            </ul>
          </section>
        </div>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
        With sub-agents on (Settings → Agent), the agent hands parts of a task to these specialists.
        Each one works with only its tools and reports back. Yours are kept in{' '}
        <span className="font-mono">.code-ai/{'<workspace>'}/agents/</span> and used from your next
        message.
      </p>

      {dialog && (
        <AgentDialog
          key={JSON.stringify(dialog)}
          workspaceId={workspaceId}
          target={dialog}
          onClose={closeDialog}
          onChanged={reload}
        />
      )}

      <ConfirmDeleteDialog
        open={pending !== null}
        title={pending?.kind === 'file' ? 'Delete this file?' : 'Delete this specialist?'}
        message={
          pending?.kind === 'file' ? (
            <>
              <strong className="font-mono text-ink">{pending.file}</strong> is deleted from the
              workspace&apos;s agents folder.
            </>
          ) : (
            <>
              <strong className="font-mono text-ink">{pending?.name}</strong> is deleted from this
              workspace. The agent can&apos;t pick it from your next message.
            </>
          )
        }
        busy={isDeleting}
        onCancel={cancelDelete}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}

/** One specialist: its name, what it's for and what it may do. Built-ins open as a copy. */
function SpecialistRow({
  specialist,
  onOpen,
  onDelete,
}: {
  specialist: SpecialistInfo;
  onOpen: () => void;
  onDelete?: () => void;
}) {
  const { isBuiltIn } = specialist;
  return (
    <li className="group relative flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-subtle">
      <WrenchIcon
        size={14}
        className={`mt-0.5 shrink-0 ${isBuiltIn ? 'text-ink-3' : 'text-accent'}`}
      />
      <button
        type="button"
        onClick={onOpen}
        title={isBuiltIn ? 'Make your own copy of this specialist' : 'Edit this specialist'}
        className="min-w-0 flex-1 text-left outline-none after:absolute after:inset-0 focus-visible:after:rounded-md focus-visible:after:ring-1 focus-visible:after:ring-accent"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate font-mono text-[12.5px] font-semibold text-ink">
            {specialist.name}
          </span>
          {specialist.replacesBuiltIn && (
            <Badge tone="coral" className="h-4 px-1.5 text-[10.5px]">
              replaces built-in
            </Badge>
          )}
        </span>
        <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-3">
          {specialist.description}
        </span>
        <span className="mt-1 block text-[11.5px] text-ink-3">{describeAccess(specialist)}</span>
      </button>
      {isBuiltIn ? (
        <span
          aria-hidden="true"
          className="relative z-10 grid h-6 w-6 shrink-0 place-items-center text-ink-3 opacity-0 transition group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <CopyIcon size={12} />
        </span>
      ) : (
        <button
          type="button"
          title="Delete this specialist"
          aria-label={`Delete the specialist ${specialistTitle(specialist.name)}`}
          onClick={onDelete}
          className="relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-3 opacity-0 transition hover:bg-danger-bg hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <CrossIcon size={12} />
        </button>
      )}
    </li>
  );
}

/** Files in the agents folder the agent can't use, each with why and a way out. */
function ProblemList({
  problems,
  onFix,
  onDelete,
}: {
  problems: readonly AgentFileProblem[];
  onFix: (problem: AgentFileProblem) => void;
  onDelete: (problem: AgentFileProblem) => void;
}) {
  return (
    <section
      aria-labelledby="agent-file-problems"
      className="rounded-xl border border-l-4 border-line border-l-warn bg-surface"
    >
      <h3
        id="agent-file-problems"
        className="flex items-center gap-1.5 px-3 pt-2.5 text-[12.5px] font-semibold text-ink"
      >
        <WarnIcon size={13} className="text-warn" />
        {problems.length === 1 ? 'A file isn’t used' : `${problems.length} files aren’t used`}
      </h3>
      <ul className="divide-y divide-line-2">
        {problems.map((problem) => (
          <li key={problem.file} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                {problem.file}
              </span>
              <Button
                size="sm"
                onClick={() => onFix(problem)}
                title="Rewrite this file with the form"
              >
                Fix
              </Button>
              <button
                type="button"
                title="Delete this file"
                aria-label={`Delete ${problem.file}`}
                onClick={() => onDelete(problem)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-3 transition hover:bg-danger-bg hover:text-danger"
              >
                <CrossIcon size={12} />
              </button>
            </div>
            <p className="mt-0.5 text-[12px] leading-snug text-ink-2">{problem.problem}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
