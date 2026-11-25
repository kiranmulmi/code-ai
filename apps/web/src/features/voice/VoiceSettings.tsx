import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  DEFAULT_SPEECH_MODEL,
  DEFAULT_SPEECH_VOICE,
  VOICE_LIMITS,
  type ModelProfile,
} from '@app/shared';
import { Button } from '../../components/Button';
import { Spinner } from '../../components/Spinner';
import { Switch } from '../../components/Switch';
import { ERROR, HINT, INPUT, INPUT_ERROR, INPUT_OK, LABEL } from '../../components/form';
import { MicIcon, RefreshIcon, SpeakerIcon, StopIcon } from '../../lib/icons';
import { useModels } from '../models/useModels';
import { synthesize, transcribe } from './api';
import { playAudio } from './speechPlayer';
import { canRecord, readMicId, writeMicId } from './micPrefs';
import { useMicrophones } from './useMicrophones';
import { formatSeconds, useRecorder } from './useRecorder';

/** The workspace form's draft of the voice setting. */
export interface VoiceDraft {
  isOn: boolean;
  modelId: string;
  transcriptionModel: string;
  language: string;
  speechModel: string;
  speechVoice: string;
}

export const EMPTY_VOICE_DRAFT: VoiceDraft = {
  isOn: false,
  modelId: '',
  transcriptionModel: 'whisper-1',
  language: '',
  speechModel: DEFAULT_SPEECH_MODEL,
  speechVoice: DEFAULT_SPEECH_VOICE,
};

/** Common text-to-speech model names, offered as suggestions (any name works). */
const SPEECH_MODEL_SUGGESTIONS = ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1', 'kokoro', 'piper'];

/** OpenAI's voices, offered as suggestions (other servers have their own names). */
const VOICE_SUGGESTIONS = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
];

const SAMPLE_TEXT = "Hi! This is how I'll sound when I read my replies to you in voice chat.";

/** Common transcription model names, offered as suggestions (any name works). */
const MODEL_SUGGESTIONS = [
  'whisper-1',
  'gpt-4o-mini-transcribe',
  'gpt-4o-transcribe',
  'whisper-large-v3',
  'whisper-large-v3-turbo',
  'auto',
];

function serverOf(model: ModelProfile): string {
  if (!model.baseUrl) return 'api.openai.com';
  try {
    return new URL(model.baseUrl).host;
  } catch {
    return model.baseUrl;
  }
}

/**
 * Workspace settings → Voice: which OpenAI-compatible server turns speech into text (a saved
 * model's URL and key, plus the transcription model to ask for), the microphone (this
 * browser's preference), and a test that records a few seconds and shows what came back.
 */
export function VoiceSettings({
  value,
  onChange,
  errors,
}: {
  value: VoiceDraft;
  onChange: (next: Partial<VoiceDraft>) => void;
  errors: {
    modelId?: string;
    transcriptionModel?: string;
    language?: string;
    speechModel?: string;
    speechVoice?: string;
  };
}) {
  const { pathname } = useLocation();
  const models = useModels();
  const microphones = useMicrophones();
  const [micId, setMicId] = useState(readMicId);
  const [testText, setTestText] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const isMicMissing =
    micId !== '' && microphones.hasLabels && !microphones.mics.some((mic) => mic.id === micId);
  const canTest = value.modelId !== '' && value.transcriptionModel.trim() !== '';

  const recorder = useRecorder({
    micId: isMicMissing ? '' : micId,
    maxSeconds: VOICE_LIMITS.testSeconds,
    onRecorded: useCallback(
      async (audio: Blob, signal: AbortSignal) =>
        (
          await transcribe(
            audio,
            {
              setting: {
                modelId: value.modelId,
                transcriptionModel: value.transcriptionModel.trim(),
                language: value.language.trim(),
              },
            },
            signal,
          )
        ).text,
      [value.modelId, value.transcriptionModel, value.language],
    ),
    onText: setTestText,
    onError: setTestError,
  });

  const startTest = () => {
    setTestText(null);
    setTestError(null);
    void recorder.start().then(() => {
      if (!microphones.hasLabels) void microphones.reload();
    });
  };

  // The spoken-voice test: synthesize a sample on the server and play it.
  const [sampleState, setSampleState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [sampleError, setSampleError] = useState<string | null>(null);
  const stopSampleRef = useRef<(() => void) | null>(null);
  const canPlaySample =
    value.modelId !== '' && value.speechModel.trim() !== '' && value.speechVoice.trim() !== '';
  const playSample = () => {
    if (sampleState !== 'idle') {
      stopSampleRef.current?.();
      return;
    }
    setSampleError(null);
    setSampleState('loading');
    const abort = new AbortController();
    let stopPlayback: (() => void) | null = null;
    stopSampleRef.current = () => {
      abort.abort();
      stopPlayback?.();
      setSampleState('idle');
    };
    synthesize(
      SAMPLE_TEXT,
      {
        setting: {
          modelId: value.modelId,
          speechModel: value.speechModel.trim(),
          speechVoice: value.speechVoice.trim(),
        },
      },
      abort.signal,
    )
      .then((audio) => {
        if (abort.signal.aborted) return;
        setSampleState('playing');
        const playback = playAudio(audio);
        stopPlayback = playback.stop;
        return playback.done;
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) {
          setSampleError(cause instanceof Error ? cause.message : "Couldn't play the sample.");
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setSampleState('idle');
      });
  };
  useEffect(() => () => stopSampleRef.current?.(), []);

  const pickMic = (id: string) => {
    setMicId(id);
    writeMicId(id);
  };

  const modelList = models.data ?? [];
  const isModelMissing =
    value.modelId !== '' && models.data && !modelList.some((m) => m.id === value.modelId);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={LABEL}>Speech to text</p>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
            The mic button in the message box records you and puts the text in the box; you review
            it and send. Voice chat (the waveform button) also reads replies aloud with the speech
            model below. Both run on the server below, not in the browser; nothing is kept.
          </p>
        </div>
        <Switch isOn={value.isOn} onChange={(isOn) => onChange({ isOn })} label="Speech to text" />
      </div>

      <div
        className={
          value.isOn ? 'flex flex-col gap-5' : 'pointer-events-none flex flex-col gap-5 opacity-50'
        }
        aria-disabled={!value.isOn}
      >
        <div>
          <label htmlFor="voice-model" className={LABEL}>
            Server
          </label>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
            An OpenAI-compatible API with{' '}
            <code className="font-mono text-[12px]">/audio/transcriptions</code> and, for spoken
            replies, <code className="font-mono text-[12px]">/audio/speech</code> (OpenAI, or a
            local whisper / Kokoro server, …). Uses the URL and API key of a model saved in{' '}
            <Link
              to="/settings/models"
              state={{ from: pathname }}
              className="text-accent-2 underline-offset-2 hover:underline"
            >
              Settings → Models
            </Link>
            .
          </p>
          <select
            id="voice-model"
            value={value.modelId}
            disabled={!value.isOn}
            aria-invalid={errors.modelId ? true : undefined}
            onChange={(event) => onChange({ modelId: event.target.value })}
            className={`${INPUT} ${errors.modelId ? INPUT_ERROR : INPUT_OK} pr-8`}
          >
            <option value="">{models.isLoading ? 'Loading models…' : 'Pick a saved model…'}</option>
            {modelList.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} — {serverOf(model)}
              </option>
            ))}
            {isModelMissing && <option value={value.modelId}>Deleted model (pick another)</option>}
          </select>
          {errors.modelId && (
            <p role="alert" className={ERROR}>
              {errors.modelId}
            </p>
          )}
          {models.data && modelList.length === 0 && (
            <p className={HINT}>
              No models yet.{' '}
              <Link
                to="/settings/models"
                state={{ from: pathname }}
                className="text-accent-2 hover:underline"
              >
                Add one
              </Link>{' '}
              with the server's URL and API key first.
            </p>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-[1fr_9rem]">
          <div>
            <label htmlFor="voice-transcription-model" className={LABEL}>
              Transcription model
            </label>
            <input
              id="voice-transcription-model"
              list="voice-model-suggestions"
              value={value.transcriptionModel}
              disabled={!value.isOn}
              placeholder="whisper-1"
              aria-invalid={errors.transcriptionModel ? true : undefined}
              onChange={(event) => onChange({ transcriptionModel: event.target.value })}
              className={`${INPUT} font-mono text-[13px] ${errors.transcriptionModel ? INPUT_ERROR : INPUT_OK}`}
            />
            <datalist id="voice-model-suggestions">
              {MODEL_SUGGESTIONS.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {errors.transcriptionModel ? (
              <p role="alert" className={ERROR}>
                {errors.transcriptionModel}
              </p>
            ) : (
              <p className={HINT}>
                As the server names it: whisper-1, gpt-4o-mini-transcribe, whisper-large-v3 (Groq),
                auto, …
              </p>
            )}
          </div>
          <div>
            <label htmlFor="voice-language" className={LABEL}>
              Language
            </label>
            <input
              id="voice-language"
              value={value.language}
              disabled={!value.isOn}
              placeholder="auto"
              maxLength={3}
              aria-invalid={errors.language ? true : undefined}
              onChange={(event) => onChange({ language: event.target.value })}
              className={`${INPUT} font-mono text-[13px] ${errors.language ? INPUT_ERROR : INPUT_OK}`}
            />
            {errors.language ? (
              <p role="alert" className={ERROR}>
                {errors.language}
              </p>
            ) : (
              <p className={HINT}>Code like en; empty detects it.</p>
            )}
          </div>
        </div>

        <div>
          <p className={LABEL}>Spoken replies (voice chat)</p>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
            The text-to-speech model and voice that read replies aloud, on the same server. On
            OpenAI, gpt-4o-mini-tts sounds the most natural.
          </p>
          <div className="mt-2 grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="voice-speech-model" className={LABEL}>
                Speech model
              </label>
              <input
                id="voice-speech-model"
                list="voice-speech-model-suggestions"
                value={value.speechModel}
                disabled={!value.isOn}
                placeholder={DEFAULT_SPEECH_MODEL}
                aria-invalid={errors.speechModel ? true : undefined}
                onChange={(event) => onChange({ speechModel: event.target.value })}
                className={`${INPUT} font-mono text-[13px] ${errors.speechModel ? INPUT_ERROR : INPUT_OK}`}
              />
              <datalist id="voice-speech-model-suggestions">
                {SPEECH_MODEL_SUGGESTIONS.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {errors.speechModel ? (
                <p role="alert" className={ERROR}>
                  {errors.speechModel}
                </p>
              ) : (
                <p className={HINT}>gpt-4o-mini-tts, tts-1-hd, tts-1, or a local server's name.</p>
              )}
            </div>
            <div>
              <label htmlFor="voice-speech-voice" className={LABEL}>
                Voice
              </label>
              <input
                id="voice-speech-voice"
                list="voice-speech-voice-suggestions"
                value={value.speechVoice}
                disabled={!value.isOn}
                placeholder={DEFAULT_SPEECH_VOICE}
                aria-invalid={errors.speechVoice ? true : undefined}
                onChange={(event) => onChange({ speechVoice: event.target.value })}
                className={`${INPUT} font-mono text-[13px] ${errors.speechVoice ? INPUT_ERROR : INPUT_OK}`}
              />
              <datalist id="voice-speech-voice-suggestions">
                {VOICE_SUGGESTIONS.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {errors.speechVoice ? (
                <p role="alert" className={ERROR}>
                  {errors.speechVoice}
                </p>
              ) : (
                <p className={HINT}>OpenAI: alloy, coral, nova, sage, … Others name their own.</p>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              variant="soft"
              onClick={playSample}
              disabled={!value.isOn || (!canPlaySample && sampleState === 'idle')}
              title={canPlaySample ? undefined : 'Pick a server, a speech model and a voice first'}
            >
              {sampleState === 'loading' ? (
                <Spinner size={13} />
              ) : sampleState === 'playing' ? (
                <StopIcon size={12} />
              ) : (
                <SpeakerIcon size={14} />
              )}
              {sampleState === 'loading'
                ? 'Generating…'
                : sampleState === 'playing'
                  ? 'Stop'
                  : 'Test: play a sample'}
            </Button>
          </div>
          {sampleError && (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-danger-line bg-danger-bg px-3 py-2 text-[13px] text-danger"
            >
              {sampleError}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="voice-mic" className={LABEL}>
            Microphone
          </label>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
            Remembered in this browser (each computer has its own).
          </p>
          {!canRecord() ? (
            <p className={ERROR}>This browser can't record audio.</p>
          ) : (
            <>
              <div className="flex items-start gap-2">
                <select
                  id="voice-mic"
                  value={isMicMissing ? '' : micId}
                  disabled={!value.isOn}
                  onChange={(event) => pickMic(event.target.value)}
                  className={`${INPUT} ${INPUT_OK} min-w-0 flex-1 pr-8`}
                >
                  <option value="">System default</option>
                  {microphones.mics.map((mic) => (
                    <option key={mic.id} value={mic.id}>
                      {mic.label}
                    </option>
                  ))}
                </select>
                <Button
                  className="mt-2 h-[38px] shrink-0"
                  disabled={!value.isOn}
                  onClick={() =>
                    void (microphones.hasLabels ? microphones.reload() : microphones.askAccess())
                  }
                  title={
                    microphones.hasLabels
                      ? 'List the microphones again'
                      : 'Allow the microphone to see their names'
                  }
                >
                  <RefreshIcon />
                  {microphones.hasLabels ? 'Refresh' : 'Show names'}
                </Button>
              </div>
              {isMicMissing && (
                <p className="mt-1.5 text-[13px] text-warn">
                  The microphone picked before isn't connected; the system default is used.
                </p>
              )}
              {microphones.error && (
                <p role="alert" className={ERROR}>
                  {microphones.error}
                </p>
              )}
            </>
          )}
        </div>

        <div className="rounded-xl border border-line bg-surface-2/50 p-4">
          <div className="flex flex-wrap items-center gap-3">
            {recorder.state === 'recording' ? (
              <Button variant="danger" onClick={recorder.stop}>
                <StopIcon size={12} /> Stop and transcribe
              </Button>
            ) : (
              <Button
                variant="soft"
                onClick={startTest}
                disabled={!value.isOn || !canTest || recorder.state !== 'idle' || !canRecord()}
                title={canTest ? undefined : 'Pick a server and a transcription model first'}
              >
                {recorder.state === 'idle' ? <MicIcon size={14} /> : <Spinner size={13} />}
                {recorder.state === 'transcribing'
                  ? 'Transcribing…'
                  : recorder.state === 'starting'
                    ? 'Opening the mic…'
                    : 'Test: record and transcribe'}
              </Button>
            )}
            {recorder.state === 'recording' && (
              <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-ink-2">
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-danger motion-reduce:animate-none" />
                <span className="font-mono tabular-nums">
                  {formatSeconds(recorder.seconds)} / {formatSeconds(VOICE_LIMITS.testSeconds)}
                </span>
                <span className="relative h-2 min-w-[6rem] flex-1 overflow-hidden rounded-full bg-line">
                  <span
                    ref={(node) => {
                      recorder.meterRef.current = node;
                    }}
                    className="absolute inset-y-0 left-0 w-0 rounded-full bg-accent"
                  />
                </span>
              </div>
            )}
            {recorder.state !== 'idle' && (
              <Button variant="plain" size="sm" onClick={recorder.cancel}>
                Cancel
              </Button>
            )}
          </div>
          <p className={HINT}>
            Say a sentence; the bar shows the microphone hears you. Tests the settings above before
            you save them.
          </p>
          {testText !== null && (
            <p
              className="mt-3 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-[13px] text-ink"
              role="status"
            >
              <span className="font-semibold text-accent-2">Heard: </span>
              {testText}
            </p>
          )}
          {testError && (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-danger-line bg-danger-bg px-3 py-2 text-[13px] text-danger"
            >
              {testError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
