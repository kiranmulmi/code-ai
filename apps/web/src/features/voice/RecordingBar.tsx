import { Spinner } from '../../components/Spinner';
import { CrossIcon, SendIcon, StopIcon } from '../../lib/icons';
import type { Dictation } from './useDictation';
import { formatSeconds } from './useRecorder';
import { Waveform } from './Waveform';

/**
 * Takes over the composer's bottom row while dictating: a live waveform, the time, cancel (×),
 * stop (text goes in the box) and send (text is sent as soon as it's transcribed).
 */
export function RecordingBar({
  dictation,
  canSend,
}: {
  dictation: Dictation;
  /** Whether a message could be sent now (a model is set up, uploads are done…). */
  canSend: boolean;
}) {
  const { state } = dictation;
  const isRecording = state === 'recording';
  const isTranscribing = state === 'transcribing';
  const isSending = isTranscribing && dictation.isSending();

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={(event) => event.stopPropagation()}
      className="flex min-w-0 flex-1 animate-fade-in items-center gap-1.5"
    >
      <Waveform
        levelRef={dictation.levelRef}
        isLive={isRecording}
        className={`mx-1 flex-1 ${isRecording ? 'text-ink-2' : 'text-ink-4'}`}
      />
      <span className="shrink-0 px-1 font-mono text-[12px] tabular-nums text-ink-3">
        {state === 'starting' ? (
          'Opening mic…'
        ) : isTranscribing ? (
          <span className="flex items-center gap-1.5">
            <Spinner size={11} label="Transcribing" />
            {isSending ? 'Sending…' : 'Transcribing…'}
          </span>
        ) : (
          formatSeconds(dictation.seconds)
        )}
      </span>
      <button
        type="button"
        onClick={dictation.cancel}
        aria-label="Cancel recording"
        title="Cancel (Esc)"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <CrossIcon size={14} />
      </button>
      <button
        type="button"
        onClick={dictation.stop}
        disabled={!isRecording}
        aria-label="Stop and put the text in the box"
        title="Stop: put the text in the box to review"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
      >
        <StopIcon size={14} />
      </button>
      <button
        type="button"
        onClick={dictation.stopAndSend}
        disabled={!isRecording || !canSend}
        aria-label="Stop and send"
        title={canSend ? 'Send: transcribe and send right away' : 'Add a model first'}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-on-accent shadow-accent transition-[background-color,transform] hover:bg-accent-hover enabled:hover:-translate-y-px disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-4 disabled:shadow-none"
      >
        <SendIcon size={15} />
      </button>
    </div>
  );
}
