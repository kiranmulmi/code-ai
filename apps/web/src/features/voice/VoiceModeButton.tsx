import { useLocation, useNavigate } from 'react-router-dom';
import { WaveformIcon } from '../../lib/icons';
import { canRecord } from './micPrefs';
import type { VoiceMode } from './useVoiceMode';

/**
 * The composer's waveform: starts (or ends) voice mode, a hands-free voice chat with the agent.
 * Without a speech-to-text setting, the click opens Workspace settings → Voice.
 */
export function VoiceModeButton({
  workspaceId,
  voice,
  isVoiceOn,
  disabled,
}: {
  workspaceId: string;
  voice: VoiceMode;
  /** whether the workspace has speech to text set up */
  isVoiceOn: boolean;
  disabled: boolean;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (!canRecord()) return null;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        if (voice.isOn) {
          voice.end();
          return;
        }
        if (!isVoiceOn) {
          navigate(`/workspaces/${workspaceId}/settings`, {
            state: { from: pathname, tab: 'voice' },
          });
          return;
        }
        voice.start();
      }}
      disabled={disabled && !voice.isOn}
      aria-pressed={voice.isOn}
      aria-label={voice.isOn ? 'End voice chat' : 'Voice chat'}
      title={
        voice.isOn
          ? 'End voice chat'
          : isVoiceOn
            ? 'Voice chat: talk with the agent hands-free'
            : 'Voice chat needs speech to text: set it up in Workspace settings → Voice'
      }
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        voice.isOn
          ? 'bg-accent-soft text-accent-2'
          : isVoiceOn
            ? 'text-ink-3 hover:bg-accent-soft hover:text-accent-2'
            : 'text-ink-4 hover:bg-surface-2 hover:text-ink-3'
      }`}
    >
      <WaveformIcon size={16} />
    </button>
  );
}
