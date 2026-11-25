import { useCallback, useEffect, useRef, useState } from 'react';
import { VOICE_LIMITS } from '@app/shared';
import { canRecord, micErrorText, openMic, recordingType } from './micPrefs';

export type RecorderState = 'idle' | 'starting' | 'recording' | 'transcribing';

/** Quieter than this (dBFS) shows as an empty meter. */
const FLOOR_DB = -60;

/**
 * Records from a microphone and hands the recording to `onRecorded`, which turns it into text
 * (the server call). `start` opens the mic (`micId`, '' for the default), `stop` finishes and
 * transcribes, `cancel` drops it. `meterRef`'s width follows the input level while recording,
 * set straight on the element so there's no re-render per frame; `levelRef` holds the raw level. The mic is released on stop,
 * cancel and unmount. A recording stops on its own after `maxSeconds`.
 */
export function useRecorder({
  micId,
  maxSeconds = VOICE_LIMITS.maxSeconds,
  onRecorded,
  onText,
  onError,
  onEmpty,
}: {
  micId: string;
  maxSeconds?: number;
  onRecorded: (audio: Blob, signal: AbortSignal) => Promise<string>;
  onText: (text: string) => void;
  onError: (message: string) => void;
  /** No words were heard; without it, that's reported through `onError`. */
  onEmpty?: () => void;
}) {
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const meterRef = useRef<HTMLElement | null>(null);
  /** The input level right now, 0 to 1 (0 when not recording), for a waveform to sample. */
  const levelRef = useRef(0);
  /** The recording's analyser (null when not recording), for a speech detector to read. */
  const analyserRef = useRef<AnalyserNode | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isCancelledRef = useRef(false);
  // The latest callbacks, so a recording in progress reports to the current ones.
  const callbacks = useRef({ onRecorded, onText, onError, onEmpty });
  callbacks.current = { onRecorded, onText, onError, onEmpty };
  /** The recording under way: `cancel` marks it, so its late `stop` event doesn't touch the next one. */
  const sessionRef = useRef<{ isCancelled: boolean } | null>(null);

  const release = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    recorderRef.current = null;
    analyserRef.current = null;
    levelRef.current = 0;
    if (meterRef.current) meterRef.current.style.width = '0%';
  }, []);

  const start = useCallback(async () => {
    if (!canRecord()) {
      callbacks.current.onError("This browser can't record audio.");
      return;
    }
    if (recorderRef.current || cleanupRef.current) return;
    isCancelledRef.current = false;
    const session = { isCancelled: false };
    sessionRef.current = session;
    setState('starting');
    setSeconds(0);
    let stream: MediaStream;
    try {
      stream = await openMic(micId);
    } catch (error) {
      setState('idle');
      callbacks.current.onError(micErrorText(error));
      return;
    }
    if (isCancelledRef.current || session.isCancelled) {
      stream.getTracks().forEach((track) => track.stop());
      if (sessionRef.current === session) setState('idle');
      return;
    }

    const mimeType = recordingType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) chunks.push(event.data);
    });

    // The level meter.
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);
    analyserRef.current = analyser;
    const samples = new Float32Array(analyser.fftSize);
    let level = 0;
    let frame = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : FLOOR_DB;
      const target = Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
      // Rise at once, fall gently, so it doesn't flicker.
      level = target > level ? target : level * 0.85 + target * 0.15;
      levelRef.current = target;
      if (meterRef.current) meterRef.current.style.width = `${(level * 100).toFixed(1)}%`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(elapsed);
      if (elapsed >= maxSeconds && recorder.state === 'recording') recorder.stop();
    }, 250);

    cleanupRef.current = () => {
      window.clearInterval(timer);
      cancelAnimationFrame(frame);
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
      if (recorder.state !== 'inactive') recorder.stop();
    };

    recorder.addEventListener('stop', () => {
      // Cancelled: `cancel` already released it, and a new recording may have started since.
      if (session.isCancelled) return;
      release();
      if (isCancelledRef.current) {
        setState('idle');
        return;
      }
      const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      if (!audio.size) {
        setState('idle');
        callbacks.current.onError('Nothing was recorded. Check the microphone.');
        return;
      }
      if (audio.size > VOICE_LIMITS.maxBytes) {
        setState('idle');
        callbacks.current.onError('The recording is too long. Keep it under a few minutes.');
        return;
      }
      setState('transcribing');
      const abort = new AbortController();
      abortRef.current = abort;
      callbacks.current
        .onRecorded(audio, abort.signal)
        .then((text) => {
          if (abort.signal.aborted) return;
          if (text.trim()) callbacks.current.onText(text.trim());
          else if (callbacks.current.onEmpty) callbacks.current.onEmpty();
          else callbacks.current.onError("Didn't catch any words. Try again a little closer.");
        })
        .catch((error: unknown) => {
          if (abort.signal.aborted) return;
          callbacks.current.onError(
            error instanceof Error ? error.message : "Couldn't turn the speech into text.",
          );
        })
        .finally(() => {
          if (abortRef.current === abort) abortRef.current = null;
          if (sessionRef.current === session) setState('idle');
        });
    });

    recorderRef.current = recorder;
    recorder.start(1000);
    setState('recording');
  }, [maxSeconds, micId, release]);

  /** Finishes the recording and turns it into text. */
  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') recorder.stop();
  }, []);

  /** Drops the recording (or the transcription under way); nothing is inserted. */
  const cancel = useCallback(() => {
    isCancelledRef.current = true;
    if (sessionRef.current) sessionRef.current.isCancelled = true;
    sessionRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    // Released now (it stops the recorder too), so `start` can follow straight away.
    release();
    setState('idle');
  }, [release]);

  useEffect(
    () => () => {
      isCancelledRef.current = true;
      abortRef.current?.abort();
      cleanupRef.current?.();
    },
    [],
  );

  return { state, seconds, start, stop, cancel, meterRef, levelRef, analyserRef };
}

/** m:ss */
export function formatSeconds(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
