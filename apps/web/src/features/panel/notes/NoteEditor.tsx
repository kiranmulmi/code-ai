import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { NOTE_LIMITS, noteInputSchema, type Note } from '@app/shared';
import { Button } from '../../../components/Button';
import { ConfirmDeleteDialog } from '../../../components/ConfirmDeleteDialog';
import { IconButton } from '../../../components/IconButton';
import { Spinner } from '../../../components/Spinner';
import { errorMessage, isNotFound } from '../../../lib/api';
import { ArrowLeftIcon, TrashIcon } from '../../../lib/icons';
import { useToast } from '../../../lib/toast';
import { createNote, deleteNote, updateNote } from './api';
import { noteLabel } from './noteList';

/**
 * One note, written or edited inside the Notes tab (`note` null: a new one). Save with the
 * button or Ctrl/⌘+Enter; leaving with unsaved changes asks first.
 */
export function NoteEditor({
  workspaceId,
  note,
  onClose,
  onSaved,
  onDeleted,
}: {
  workspaceId: string;
  note: Note | null;
  onClose: () => void;
  onSaved: (note: Note) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isDirty = title !== (note?.title ?? '') || body !== (note?.body ?? '');

  // Closing the tab or reloading with unsaved changes: the browser asks first.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const back = () => {
    if (isDirty) setIsLeaving(true);
    else onClose();
  };

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (isSaving) return;
    const checked = noteInputSchema.safeParse({ title, body });
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? 'Check the note.');
      return;
    }
    setIsSaving(true);
    setIsLeaving(false);
    try {
      const saved = note
        ? await updateNote(workspaceId, note.id, checked.data)
        : await createNote(workspaceId, checked.data);
      toast(note ? 'Note saved' : 'Note created');
      onSaved(saved);
    } catch (cause) {
      if (note && isNotFound(cause)) {
        toast('That note no longer exists.', 'warning');
        onDeleted(note.id);
        return;
      }
      toast(errorMessage(cause, "Couldn't save the note."), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const cancelDelete = useCallback(() => setIsDeleteOpen(false), []);
  const confirmDelete = async () => {
    if (!note) return;
    setIsDeleting(true);
    try {
      await deleteNote(workspaceId, note.id);
      toast('Note deleted');
      onDeleted(note.id);
    } catch (cause) {
      if (isNotFound(cause)) onDeleted(note.id);
      else toast(errorMessage(cause, "Couldn't delete the note."), 'error');
    } finally {
      setIsDeleting(false);
      setIsDeleteOpen(false);
    }
  };

  return (
    <form onSubmit={(event) => void save(event)} className="flex h-full min-h-full flex-col">
      <div className="sticky top-0 z-[1] flex items-center gap-1.5 border-b border-line-2 bg-surface py-1.5 pl-2 pr-2">
        <IconButton onClick={back} aria-label="Back to notes" title="Back to notes">
          <ArrowLeftIcon />
        </IconButton>
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">
          {note ? (isDirty ? 'Unsaved changes' : 'Saved') : 'New note'}
        </span>
        {note && (
          <IconButton
            onClick={() => setIsDeleteOpen(true)}
            aria-label="Delete note"
            title="Delete note"
            className="hover:!bg-danger-bg hover:!text-danger"
          >
            <TrashIcon />
          </IconButton>
        )}
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={isSaving || (note !== null && !isDirty)}
        >
          {isSaving && <Spinner size={12} />}
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      {isLeaving && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-line-2 bg-warn-bg px-4 py-2 text-[12.5px] text-ink"
        >
          <span className="min-w-0 flex-1">You have unsaved changes.</span>
          <Button size="sm" onClick={() => setIsLeaving(false)}>
            Keep editing
          </Button>
          <Button size="sm" variant="danger" onClick={onClose}>
            Discard
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(null);
          }}
          maxLength={NOTE_LIMITS.titleChars}
          placeholder="Title"
          aria-label="Title"
          autoFocus={note === null}
          className="w-full bg-transparent text-[15px] font-bold text-ink outline-none placeholder:text-ink-3"
        />
        <textarea
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void save();
            }
          }}
          maxLength={NOTE_LIMITS.bodyChars}
          placeholder="Write your note…"
          aria-label="Note"
          aria-invalid={error !== null}
          className="min-h-[200px] w-full flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-line-strong focus:border-accent focus:ring-1 focus:ring-accent"
        />
        {error && <p className="text-[12.5px] text-danger">{error}</p>}
        {note && (
          <p className="text-[11.5px] text-ink-3">
            Created {new Date(note.createdAt).toLocaleString()} · edited{' '}
            {new Date(note.updatedAt).toLocaleString()}
          </p>
        )}
      </div>

      <ConfirmDeleteDialog
        open={isDeleteOpen}
        title="Delete this note?"
        message={
          <>
            <strong>{note ? noteLabel(note) : ''}</strong> will be deleted for good.
          </>
        }
        busy={isDeleting}
        onCancel={cancelDelete}
        onConfirm={() => void confirmDelete()}
      />
    </form>
  );
}
