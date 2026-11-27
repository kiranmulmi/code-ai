import { useCallback, useState } from 'react';
import type { AgentFileProblem, SpecialistInfo, SpecialistList } from '@app/shared';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { errorMessage } from '../../lib/api';
import {
  CopyIcon,
  CrossIcon,
  EditIcon,
  PlusIcon,
  TrashIcon,
  WarnIcon,
  WrenchIcon,
} from '../../lib/icons';
import { useToast } from '../../lib/toast';
import type { AsyncResource } from '../../lib/useAsync';
import { specialistTitle } from '../chat/tools';
import { PanelMessage } from '../panel/PanelMessage';
import {
  CardAction,
  CardGrid,
  EmptyHero,
  GroupHeading,
  ItemCard,
  SearchBox,
  SectionHeader,
  SectionNote,
  SectionPage,
  matches,
} from '../customize/SectionLayout';
import { AgentDialog, type AgentDialogTarget } from './AgentDialog';
import { describeAccess, draftFrom, fixTarget } from './agentDraft';
import { deleteAgent } from './api';

/** What the delete confirmation is for: a specialist, or a broken file. */
type PendingDelete = { kind: 'specialist'; name: string } | { kind: 'file'; file: string };

/**
 * The Agents page (Customize tab): the specialists the agent can hand work to (with sub-agents on in Settings →
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
  const [query, setQuery] = useState('');
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
  const shownOwn = own.filter((s) => matches(query, s.name, s.description));
  const shownBuiltIns = builtIns.filter((s) => matches(query, s.name, s.description));
  const copyBuiltIn = (specialist: SpecialistInfo) =>
    setDialog({ kind: 'new', start: { ...draftFrom(specialist), name: `my-${specialist.name}` } });

  return (
    <SectionPage>
      <SectionHeader
        icon={<WrenchIcon size={18} />}
        title="Agents"
        description={
          <>
            Specialists the agent hands parts of a task to (with sub-agents on in Settings → Agent).
            Each works with only its own tools and reports back.
          </>
        }
        actions={
          <Button variant="primary" onClick={() => setDialog({ kind: 'new' })}>
            <PlusIcon size={12} /> New specialist
          </Button>
        }
      />

      {!agents.data ? (
        <PanelMessage isLoading={agents.isLoading} error={agents.error} onRetry={reload} />
      ) : (
        <div className="flex flex-col gap-8">
          {problems.length > 0 && (
            <ProblemList
              problems={problems}
              onFix={(problem) =>
                setDialog({ kind: 'fix', ...fixTarget(problem.file), problem: problem.problem })
              }
              onDelete={(problem) => setPending({ kind: 'file', file: problem.file })}
            />
          )}

          {own.length + builtIns.length > 6 && (
            <div className="-mb-4">
              <SearchBox
                value={query}
                onChange={setQuery}
                placeholder="Search specialists"
                count={shownOwn.length + shownBuiltIns.length}
              />
            </div>
          )}

          <section aria-labelledby="own-agents">
            <GroupHeading id="own-agents" count={own.length || undefined}>
              Yours
            </GroupHeading>
            {own.length === 0 ? (
              <EmptyHero
                icon={<WrenchIcon size={20} />}
                title="No specialists of your own yet"
                actions={
                  <Button size="sm" onClick={() => setDialog({ kind: 'new' })}>
                    <PlusIcon size={11} /> Create one
                  </Button>
                }
              >
                Make one for work you hand off often, like a security review, or start from a copy
                of a built-in below.
              </EmptyHero>
            ) : (
              <CardGrid label="Your specialists">
                {shownOwn.map((specialist) => (
                  <ItemCard
                    key={specialist.name}
                    icon={<WrenchIcon size={15} />}
                    name={specialist.name}
                    openTitle="Edit this specialist"
                    onOpen={() => setDialog({ kind: 'edit', name: specialist.name })}
                    badges={
                      specialist.replacesBuiltIn && (
                        <Badge tone="coral" className="h-4 px-1.5 text-[10.5px]">
                          replaces built-in
                        </Badge>
                      )
                    }
                    description={specialist.description}
                    meta={describeAccess(specialist)}
                    corner={
                      <>
                        <CardAction
                          label={`Edit ${specialistTitle(specialist.name)}`}
                          onClick={() => setDialog({ kind: 'edit', name: specialist.name })}
                        >
                          <EditIcon size={13} />
                        </CardAction>
                        <CardAction
                          tone="danger"
                          label={`Delete the specialist ${specialistTitle(specialist.name)}`}
                          onClick={() => setPending({ kind: 'specialist', name: specialist.name })}
                        >
                          <TrashIcon size={13} />
                        </CardAction>
                      </>
                    }
                  />
                ))}
              </CardGrid>
            )}
          </section>

          {builtIns.length > 0 && (
            <section aria-labelledby="built-in-agents">
              <GroupHeading
                id="built-in-agents"
                count={builtIns.length}
                hint="Use one as a starting point for your own"
              >
                Built in
              </GroupHeading>
              <CardGrid label="Built-in specialists">
                {shownBuiltIns.map((specialist) => (
                  <ItemCard
                    key={specialist.name}
                    isMuted
                    icon={<WrenchIcon size={15} />}
                    name={specialist.name}
                    openTitle="Make your own copy of this specialist"
                    onOpen={() => copyBuiltIn(specialist)}
                    description={specialist.description}
                    meta={describeAccess(specialist)}
                    footerEnd={
                      <span className="flex items-center gap-1 text-[11.5px] font-semibold text-accent-2 opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                        <CopyIcon size={11} /> Copy
                      </span>
                    }
                  />
                ))}
              </CardGrid>
            </section>
          )}
        </div>
      )}

      <SectionNote>
        Yours are kept in <span className="font-mono">.code-ai/{'<workspace>'}/agents/</span> and
        used from your next message. One named like a built-in replaces it.
      </SectionNote>

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
    </SectionPage>
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
