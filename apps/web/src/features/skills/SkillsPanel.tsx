import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { SKILL_LIMITS, SKILL_MAIN_FILE, formatBytes, type Skill } from '@app/shared';
import { Button } from '../../components/Button';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { Spinner } from '../../components/Spinner';
import { ApiError, errorMessage } from '../../lib/api';
import { plural } from '../../lib/format';
import { CrossIcon, FolderIcon, PlusIcon, SkillIcon } from '../../lib/icons';
import { useToast } from '../../lib/toast';
import type { AsyncResource } from '../../lib/useAsync';
import { PanelMessage } from '../panel/PanelMessage';
import { deleteSkill, uploadSkill, type PickedSkillFile } from './api';
import { useSkillDialog } from './SkillDialogProvider';

/** Hidden files and folders (.DS_Store, .git) never belong to a skill: left out before sending. */
const isHiddenPath = (path: string) => path.split('/').some((part) => part.startsWith('.'));

/** The picked folder's files, each with its path inside the folder; or what's wrong with them. */
function pickedFiles(list: FileList): PickedSkillFile[] | string {
  const files = Array.from(list)
    .map((file) => ({ path: file.webkitRelativePath || file.name, file }))
    .filter(({ path }) => !isHiddenPath(path));
  if (!files.length) return 'That folder is empty.';
  const hasMain = files.some(({ path }) => {
    const parts = path.split('/');
    return parts[parts.length - 1] === SKILL_MAIN_FILE && parts.length <= 2;
  });
  if (!hasMain) {
    return `Pick a skill folder: one with a ${SKILL_MAIN_FILE} at its top.`;
  }
  if (files.length > SKILL_LIMITS.fileCount) {
    return `A skill can have at most ${SKILL_LIMITS.fileCount} files; that folder has ${files.length}.`;
  }
  const total = files.reduce((sum, { file }) => sum + file.size, 0);
  if (total > SKILL_LIMITS.totalBytes) {
    return `That folder is ${formatBytes(total)}; a skill can be at most ${formatBytes(SKILL_LIMITS.totalBytes)}.`;
  }
  return files;
}

/**
 * The Skills tab: the workspace's skills, each a name and when to use it. The agent picks
 * the ones a task needs; the composer's Skills button adds them to a message by hand.
 * Created and edited in a popup (SkillDialog).
 */
export function SkillsPanel({
  workspaceId,
  skills,
}: {
  workspaceId: string;
  skills: AsyncResource<Skill[]>;
}) {
  const toast = useToast();
  const { openSkill } = useSkillDialog();
  const [pending, setPending] = useState<Skill | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const list = skills.data ?? [];

  const confirm = async () => {
    if (!pending) return;
    setIsDeleting(true);
    try {
      await deleteSkill(workspaceId, pending.name);
      skills.setData((current) => current?.filter((skill) => skill.name !== pending.name) ?? null);
      toast('Skill deleted');
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete the skill."), 'error');
    } finally {
      setIsDeleting(false);
      setPending(null);
    }
  };
  const cancel = useCallback(() => setPending(null), []);

  // Upload a skill folder. `clash`: the files waiting for "Replace?" when the name is taken.
  const folderInput = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [clash, setClash] = useState<{ files: PickedSkillFile[]; message: string } | null>(null);
  useEffect(() => {
    // Not in React's attribute types: lets the file picker choose a folder.
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  const upload = async (files: PickedSkillFile[], replace: boolean) => {
    setIsUploading(true);
    try {
      const skill = await uploadSkill(workspaceId, files, { replace });
      skills.setData((current) =>
        [...(current ?? []).filter((s) => s.name !== skill.name), skill].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setClash(null);
      toast(replace ? `Skill "${skill.name}" replaced` : `Skill "${skill.name}" uploaded`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && !replace) {
        setClash({ files, message: cause.message });
      } else {
        setClash(null);
        toast(errorMessage(cause, "Couldn't upload the skill."), 'error');
      }
    } finally {
      setIsUploading(false);
    }
  };

  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const checked = input.files ? pickedFiles(input.files) : 'Pick a skill folder.';
    input.value = ''; // so picking the same folder again still fires
    if (typeof checked === 'string') toast(checked, 'warning');
    else void upload(checked, false);
  };
  const cancelClash = useCallback(() => setClash(null), []);

  return (
    <>
      <div className="mb-2 flex min-h-7 items-center justify-between gap-2">
        <span className="eyebrow">{list.length ? plural(list.length, 'skill') : 'Skills'}</span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            onClick={() => folderInput.current?.click()}
            disabled={isUploading}
            title={`Upload a skill folder: ${SKILL_MAIN_FILE} plus the files it uses`}
          >
            {isUploading ? <Spinner size={11} /> : <FolderIcon size={11} />} Upload
          </Button>
          <Button size="sm" onClick={() => openSkill(null)}>
            <PlusIcon size={11} /> New skill
          </Button>
        </div>
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={picked}
        />
      </div>

      {!skills.data ? (
        <PanelMessage isLoading={skills.isLoading} error={skills.error} onRetry={skills.reload} />
      ) : (
        <ul className={list.length ? 'panel divide-y divide-line-2' : ''}>
          {list.length === 0 && (
            <li className="border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-3">
              No skills yet. Write one for a task you repeat, like a ticket workflow or a review
              checklist.
            </li>
          )}
          {list.map((skill) => (
            <li
              key={skill.name}
              className="group relative flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-subtle"
            >
              <SkillIcon size={14} className="mt-0.5 shrink-0 text-accent" />
              <button
                type="button"
                onClick={() => openSkill(skill.name)}
                title="Edit this skill"
                className="min-w-0 flex-1 text-left outline-none after:absolute after:inset-0 focus-visible:after:rounded-md focus-visible:after:ring-1 focus-visible:after:ring-accent"
              >
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate font-mono text-[12.5px] font-semibold text-ink">
                    {skill.name}
                  </span>
                  {skill.files && skill.files.length > 0 && (
                    <span
                      className="shrink-0 text-[11px] text-ink-3"
                      title={skill.files.map((f) => f.path).join('\n')}
                    >
                      +{plural(skill.files.length, 'file')}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-3">
                  {skill.description || 'No description: the agent won’t know when to use it.'}
                </span>
              </button>
              <button
                type="button"
                title="Delete this skill"
                aria-label={`Delete the skill ${skill.name}`}
                onClick={() => setPending(skill)}
                className="relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-3 opacity-0 transition hover:bg-danger-bg hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <CrossIcon size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
        The agent sees each skill&apos;s name and description and loads the ones a task needs. To
        use one for a message yourself, pick it with the Skills button in the message box. Upload a
        skill folder ({SKILL_MAIN_FILE} plus files it uses, like references or templates) to give
        the agent those files too.
      </p>

      <ConfirmDeleteDialog
        open={clash !== null}
        title="Replace this skill?"
        message={
          <>
            {clash?.message.replace(/ Pick another name\.$/, '')} Replacing it deletes its
            instructions and files and keeps the uploaded ones.
          </>
        }
        confirmLabel="Replace"
        busyLabel="Replacing…"
        busy={isUploading}
        onCancel={cancelClash}
        onConfirm={() => clash && void upload(clash.files, true)}
      />

      <ConfirmDeleteDialog
        open={pending !== null}
        title="Delete this skill?"
        message={
          <>
            <strong className="font-mono text-ink">{pending?.name}</strong> is deleted from this
            workspace. The agent won&apos;t see it from your next message.
          </>
        }
        busy={isDeleting}
        onCancel={cancel}
        onConfirm={() => void confirm()}
      />
    </>
  );
}
