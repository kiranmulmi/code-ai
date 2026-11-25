import { useLocation, useNavigate } from 'react-router-dom';
import { Spinner } from '../../components/Spinner';
import { MicIcon } from '../../lib/icons';
import { canRecord } from './micPrefs';
import type { Dictation } from './useDictation';

/**
 * The composer's mic: click to start talking. While recording, the composer shows the
 * RecordingBar instead. Without a speech-to-text setting, the click opens Workspace settings →
 * Voice.
 */
export function DictationButton({
  workspaceId,
  dictation,
  isVoiceOn,
  disabled,
}: {
  workspaceId: string;
  dictation: Dictation;
  /** whether the workspace has speech to text set up */
  isVoiceOn: boolean;
  disabled: boolean;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (!canRecord()) return null;
  const isStarting = dictation.state === 'starting';

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        if (!isVoiceOn) {
          navigate(`/workspaces/${workspaceId}/settings`, {
            state: { from: pathname, tab: 'voice' },
          });
          return;
        }
        if (dictation.state === 'idle') void dictation.start();
      }}
      disabled={disabled || isStarting}
      aria-label="Dictate"
      title={
        isVoiceOn
          ? 'Talk instead of typing'
          : 'Speech to text: set it up in Workspace settings → Voice'
      }
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        isVoiceOn
          ? 'text-ink-3 hover:bg-accent-soft hover:text-accent-2'
          : 'text-ink-4 hover:bg-surface-2 hover:text-ink-3'
      }`}
    >
      {isStarting ? <Spinner size={13} label="Opening microphone" /> : <MicIcon size={16} />}
    </button>
  );
}
