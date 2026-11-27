import { useCallback, useState } from 'react';
import type { Memory } from '@app/shared';
import { Button } from '../../../components/Button';
import { ConfirmDeleteDialog } from '../../../components/ConfirmDeleteDialog';
import { errorMessage } from '../../../lib/api';
import { plural, shorten } from '../../../lib/format';
import { useToast } from '../../../lib/toast';
import type { AsyncResource } from '../../../lib/useAsync';
import { PanelMessage } from '../PanelMessage';
import { BrainIcon, TrashIcon } from '../../../lib/icons';
import {
  EmptyHero,
  GroupHeading,
  SearchBox,
  SectionHeader,
  SectionPage,
  matches,
} from '../../customize/SectionLayout';
import { clearMemories, deleteMemory } from './api';
import { MemoryItem } from './MemoryItem';

type PendingDelete = { kind: 'one'; memory: Memory } | { kind: 'all' };

const newestFirst = (a: Memory, b: Memory) =>
  (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? '');

/** The Memory page (Customize tab): what the agent remembers in this workspace. */
export function MemoryPanel({
  workspaceId,
  memories,
}: {
  workspaceId: string;
  memories: AsyncResource<Memory[]>;
}) {
  const toast = useToast();
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [query, setQuery] = useState('');
  const { data, setData } = memories;
  const list = data ? [...data].sort(newestFirst) : [];

  const confirm = async () => {
    if (!pending) return;
    setIsDeleting(true);
    try {
      const result =
        pending.kind === 'all'
          ? await clearMemories(workspaceId)
          : await deleteMemory(workspaceId, pending.memory.id);
      setData(() => result.memories);
      toast(
        pending.kind === 'all'
          ? `Cleared ${plural(result.removed, 'memory', 'memories')}`
          : 'Memory deleted',
      );
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete the memory."), 'error');
    } finally {
      setIsDeleting(false);
      setPending(null);
    }
  };

  const cancel = useCallback(() => setPending(null), []);

  const shown = list.filter((memory) => matches(query, memory.fact));

  return (
    <SectionPage>
      <SectionHeader
        icon={<BrainIcon size={18} />}
        title="Memory"
        description="Facts and preferences the agent saved in this workspace. It reads them at the start of every chat and follows them. Ask it in a chat to change or forget one, or delete it here."
        actions={
          list.length > 0 && (
            <Button variant="danger-outline" onClick={() => setPending({ kind: 'all' })}>
              <TrashIcon size={12} /> Clear all
            </Button>
          )
        }
      />

      {!data ? (
        <PanelMessage
          isLoading={memories.isLoading}
          error={memories.error}
          onRetry={memories.reload}
        />
      ) : list.length === 0 ? (
        <EmptyHero icon={<BrainIcon size={20} />} title="Nothing remembered yet">
          Tell the agent something to remember in a chat, like &quot;remember that I prefer short
          answers&quot;, and it shows up here.
        </EmptyHero>
      ) : (
        <>
          {list.length > 5 && (
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="Search memories"
              count={shown.length}
            />
          )}
          <GroupHeading count={list.length} hint="Newest first">
            Saved
          </GroupHeading>
          <ul className="panel divide-y divide-line-2 overflow-hidden">
            {shown.map((memory) => (
              <MemoryItem
                key={memory.id}
                memory={memory}
                onDelete={() => setPending({ kind: 'one', memory })}
              />
            ))}
          </ul>
        </>
      )}

      <ConfirmDeleteDialog
        open={pending !== null}
        title={pending?.kind === 'all' ? 'Clear all memories?' : 'Forget this memory?'}
        message={
          pending?.kind === 'one'
            ? `“${shorten(pending.memory.fact, 160)}” is deleted. The agent won't see it in new messages.`
            : `All ${plural(list.length, 'memory', 'memories')} in this workspace are deleted. The agent starts without them from your next message.`
        }
        confirmLabel={pending?.kind === 'all' ? 'Clear all' : 'Delete'}
        busy={isDeleting}
        onCancel={cancel}
        onConfirm={() => void confirm()}
      />
    </SectionPage>
  );
}
