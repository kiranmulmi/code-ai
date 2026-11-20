import { useCallback, useState } from 'react';
import type { Note } from '@app/shared';
import { Button } from '../../../components/Button';
import { IconButton } from '../../../components/IconButton';
import { Spinner } from '../../../components/Spinner';
import { timeAgo } from '../../../lib/format';
import { NoteIcon, PlusIcon, RefreshIcon, SearchIcon } from '../../../lib/icons';
import type { AsyncResource } from '../../../lib/useAsync';
import { PanelMessage } from '../PanelMessage';
import { NoteEditor } from './NoteEditor';
import { filterNotes, noteLabel, notePreview, sortNotes, withNote } from './noteList';

/** Which note is open: none (the list), a new one, or one by id. */
type Open = null | { kind: 'new' } | { kind: 'edit'; note: Note };

/**
 * The Notes tab: the user's own notes for this workspace, kept in its data folder
 * (notes.json). The list, newest change first, with a search; click one to edit it.
 */
export function NotesPanel({
  workspaceId,
  notes,
}: {
  workspaceId: string;
  notes: AsyncResource<Note[]>;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [query, setQuery] = useState('');
  const { data, setData, reload, isLoading } = notes;

  const close = useCallback(() => setOpen(null), []);
  const onSaved = useCallback(
    (saved: Note) => {
      setData((current) => withNote(current, saved));
      setOpen({ kind: 'edit', note: saved });
    },
    [setData],
  );
  const onDeleted = useCallback(
    (id: string) => {
      setData((current) => (current ?? []).filter((note) => note.id !== id));
      setOpen(null);
    },
    [setData],
  );

  if (open) {
    return (
      <NoteEditor
        // A fresh editor per note, so its draft never carries over.
        key={open.kind === 'new' ? 'new' : open.note.id}
        workspaceId={workspaceId}
        note={open.kind === 'edit' ? open.note : null}
        onClose={close}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    );
  }

  const list = data ? filterNotes(sortNotes(data), query) : [];
  const total = data?.length ?? 0;

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-[1] flex items-center gap-2 border-b border-line-2 bg-surface py-1.5 pl-4 pr-2">
        <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-ink-3">
          <NoteIcon size={13} className="shrink-0 text-accent" />
          {data ? (total === 1 ? '1 note' : `${total} notes`) : ''}
        </span>
        <IconButton onClick={reload} disabled={isLoading} aria-label="Refresh" title="Refresh">
          {isLoading && data ? <Spinner size={12} /> : <RefreshIcon />}
        </IconButton>
        <Button size="sm" variant="soft" onClick={() => setOpen({ kind: 'new' })}>
          <PlusIcon size={12} />
          New note
        </Button>
      </div>

      <div className="p-4">
        {!data ? (
          <PanelMessage isLoading={isLoading} error={notes.error} onRetry={reload} />
        ) : total === 0 ? (
          <div className="border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-3">
            No notes yet. Use New note to jot something down for this workspace.
          </div>
        ) : (
          <>
            {total > 3 && (
              <label className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 focus-within:border-accent">
                <SearchIcon size={13} className="shrink-0 text-ink-3" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search notes"
                  aria-label="Search notes"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
                />
              </label>
            )}
            {list.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-ink-3">No notes match “{query}”.</p>
            ) : (
              <ul className="panel divide-y divide-line-2">
                {list.map((note) => {
                  const preview = notePreview(note);
                  return (
                    <li key={note.id}>
                      <button
                        type="button"
                        onClick={() => setOpen({ kind: 'edit', note })}
                        className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
                      >
                        <span className="flex w-full items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                            {noteLabel(note)}
                          </span>
                          <span
                            className="shrink-0 text-[11.5px] text-ink-3"
                            title={new Date(note.updatedAt).toLocaleString()}
                          >
                            {timeAgo(note.updatedAt)}
                          </span>
                        </span>
                        {preview && (
                          <span className="line-clamp-2 text-[12.5px] leading-snug text-ink-2">
                            {preview}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
