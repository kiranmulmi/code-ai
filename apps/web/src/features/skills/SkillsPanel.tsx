import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { SKILL_LIMITS, SKILL_MAIN_FILE, formatBytes, type Skill } from '@app/shared';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { Spinner } from '../../components/Spinner';
import { ApiError, errorMessage } from '../../lib/api';
import { plural } from '../../lib/format';
import { EditIcon, FolderIcon, PlusIcon, SkillIcon, TrashIcon } from '../../lib/icons';
import { useToast } from '../../lib/toast';
import type { AsyncResource } from '../../lib/useAsync';
import { PanelMessage } from '../panel/PanelMessage';
import {
  CardAction,
  CardGrid,
  EmptyHero,
  ItemCard,
  SearchBox,
  SectionHeader,
  SectionNote,
  SectionPage,
  matches,
} from '../customize/SectionLayout';
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
 * The Skills page (Customize tab): the workspace's skills, each a name and when to use it. The agent picks
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
  const [query, setQuery] = useState('');
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

  const shown = list.filter((skill) => matches(query, skill.name, skill.description));
  const uploadButton = (
    <Button
      onClick={() => folderInput.current?.click()}
      disabled={isUploading}
      title={`Upload a skill folder: ${SKILL_MAIN_FILE} plus the files it uses`}
    >
      {isUploading ? <Spinner size={12} /> : <FolderIcon size={13} />} Upload folder
    </Button>
  );

  return (
    <SectionPage>
      <SectionHeader
        icon={<SkillIcon size={18} />}
        title="Skills"
        description="Reusable know-how for tasks you repeat. The agent sees each skill's name and description and loads the ones a task needs; you can also add one to a message from the composer."
        actions={
          <>
            {uploadButton}
            <Button variant="primary" onClick={() => openSkill(null)}>
              <PlusIcon size={12} /> New skill
            </Button>
          </>
        }
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={picked}
      />

      {!skills.data ? (
        <PanelMessage isLoading={skills.isLoading} error={skills.error} onRetry={skills.reload} />
      ) : list.length === 0 ? (
        <EmptyHero
          icon={<SkillIcon size={20} />}
          title="No skills yet"
          actions={
            <>
              <Button size="sm" variant="primary" onClick={() => openSkill(null)}>
                <PlusIcon size={11} /> Write a skill
              </Button>
              <Button size="sm" onClick={() => folderInput.current?.click()} disabled={isUploading}>
                <FolderIcon size={11} /> Upload a folder
              </Button>
            </>
          }
        >
          Write one for a task you repeat, like a ticket workflow or a review checklist, or upload a
          skill folder ({SKILL_MAIN_FILE} plus the references or templates it uses).
        </EmptyHero>
      ) : (
        <>
          {list.length > 6 && (
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="Search skills"
              count={shown.length}
            />
          )}
          <CardGrid label="Skills">
            {shown.map((skill) => (
              <ItemCard
                key={skill.name}
                icon={<SkillIcon size={15} />}
                name={skill.name}
                openTitle="Edit this skill"
                onOpen={() => openSkill(skill.name)}
                badges={
                  !skill.description && (
                    <Badge tone="yellow" className="h-4 px-1.5 text-[10.5px]">
                      needs a description
                    </Badge>
                  )
                }
                description={
                  skill.description || 'No description: the agent won’t know when to use it.'
                }
                meta={
                  skill.files && skill.files.length > 0 ? (
                    <span title={skill.files.map((f) => f.path).join('\n')}>
                      {SKILL_MAIN_FILE} + {plural(skill.files.length, 'file')}
                    </span>
                  ) : (
                    SKILL_MAIN_FILE
                  )
                }
                corner={
                  <>
                    <CardAction
                      label={`Edit the skill ${skill.name}`}
                      onClick={() => openSkill(skill.name)}
                    >
                      <EditIcon size={13} />
                    </CardAction>
                    <CardAction
                      tone="danger"
                      label={`Delete the skill ${skill.name}`}
                      onClick={() => setPending(skill)}
                    >
                      <TrashIcon size={13} />
                    </CardAction>
                  </>
                }
              />
            ))}
          </CardGrid>
        </>
      )}

      <SectionNote>
        Skills belong to this workspace. Upload a skill folder to give the agent its extra files
        too; uploading one with a name that&apos;s taken asks before replacing it.
      </SectionNote>

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
    </SectionPage>
  );
}
