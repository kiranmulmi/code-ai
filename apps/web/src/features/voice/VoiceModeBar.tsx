import { useEffect, useState } from 'react';
import {
  HangUpIcon,
  MicIcon,
  MicOffIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  StopIcon,
} from '../../lib/icons';
import { formatSeconds } from './useRecorder';
import type { VoiceMode, VoicePhase } from './useVoiceMode';
import { Waveform } from './Waveform';

const ROUND =
  'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2 transition-colors hover:bg-line hover:text-ink disabled:cursor-not-allowed disabled:opacity-50';

function phaseText(phase: VoicePhase, isMuted: boolean, isHearing: boolean): string {
  switch (phase) {
    case 'listening':
      return isMuted ? 'Muted' : isHearing ? 'Hearing you…' : 'Listening…';
    case 'transcribing':
      return 'Transcribing…';
    case 'waiting':
      return 'Working…';
    case 'speaking':
      return 'Speaking…';
    default:
      return 'Starting…';
  }
}

/** Time since the voice chat started, ticking each second. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <>{formatSeconds(Math.max(0, Math.floor((now - since) / 1000)))}</>;
}

/**
 * The voice chat in progress, above the message box: how long it has run, what it's doing, a
 * live waveform (the mic while listening, the voice while speaking), and mute, read-aloud,
 * stop-speaking and end buttons.
 */
export function VoiceModeBar({ voice }: { voice: VoiceMode }) {
  const { phase, isMuted, speaksReplies } = voice;
  const isSpeaking = phase === 'speaking';

  return (
    <div className="shrink-0 px-4 pt-2 sm:px-6">
      <div
        role="status"
        aria-live="polite"
        className="mx-auto w-full max-w-[1000px] animate-fade-in rounded-2xl border border-line bg-surface px-4 pb-3 pt-2.5 shadow-card"
      >
        <div className="flex items-baseline gap-2 text-[13px]">
          <span className="font-medium text-ink">Voice chat</span>
          {voice.startedAt !== null && (
            <span className="tabular-nums text-ink-3">
              <Elapsed since={voice.startedAt} />
            </span>
          )}
          <span className="ml-auto text-[12px] text-ink-3">
            {phaseText(phase, isMuted, voice.isHearing)}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Waveform
            levelRef={voice.levelRef}
            isLive={voice.isOn}
            className={`h-7 flex-1 ${isSpeaking ? 'text-accent-2' : 'text-ink-2'}`}
          />
          {isSpeaking && (
            <button
              type="button"
              onClick={voice.skip}
              aria-label="Stop speaking and listen"
              title="Stop speaking and listen"
              className={ROUND}
            >
              <StopIcon size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={() => voice.setMuted(!isMuted)}
            aria-pressed={isMuted}
            aria-label={isMuted ? 'Unmute the microphone' : 'Mute the microphone'}
            title={isMuted ? 'Unmute' : 'Mute'}
            className={`${ROUND} ${isMuted ? '!bg-danger-bg !text-danger' : ''}`}
          >
            {isMuted ? <MicOffIcon size={16} /> : <MicIcon size={16} />}
          </button>
          <button
            type="button"
            onClick={() => voice.setSpeaksReplies(!speaksReplies)}
            aria-pressed={speaksReplies}
            aria-label={speaksReplies ? "Don't read replies aloud" : 'Read replies aloud'}
            title={speaksReplies ? 'Replies are read aloud' : 'Replies are not read aloud'}
            className={ROUND}
          >
            {speaksReplies ? <SpeakerIcon size={16} /> : <SpeakerOffIcon size={16} />}
          </button>
          <button
            type="button"
            onClick={voice.end}
            aria-label="End voice chat"
            title="End voice chat (Esc)"
            className={`${ROUND} !bg-danger-bg !text-danger hover:!opacity-80`}
          >
            <HangUpIcon size={17} />
          </button>
        </div>
        {voice.showsDebug && (
          <div
            ref={(element) => {
              voice.debugRef.current = element;
            }}
            className="mt-1.5 font-mono text-[11px] tabular-nums text-ink-3"
          />
        )}
      </div>
    </div>
  );
}
