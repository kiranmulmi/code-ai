import type { Memory } from '@app/shared';
import { isoDay } from '../../../lib/format';
import { BrainIcon, TrashIcon } from '../../../lib/icons';

/** One memory: the fact, when it was saved or last changed, and a Forget button. */
export function MemoryItem({ memory, onDelete }: { memory: Memory; onDelete: () => void }) {
  return (
    <li className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-subtle">
      <span
        aria-hidden
        className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-2"
      >
        <BrainIcon size={13} />
      </span>
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <p className="text-[13.5px] leading-relaxed text-ink">{memory.fact}</p>
        <span className="mt-0.5 block text-[11.5px] text-ink-3">
          {memory.updatedAt
            ? `Updated ${isoDay(memory.updatedAt)}`
            : `Saved ${isoDay(memory.createdAt)}`}
        </span>
      </div>
      <button
        type="button"
        title="Forget this"
        aria-label={`Forget: ${memory.fact}`}
        onClick={onDelete}
        className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-ink-3 opacity-0 transition hover:bg-danger-bg hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <TrashIcon size={12} /> Forget
      </button>
    </li>
  );
}
