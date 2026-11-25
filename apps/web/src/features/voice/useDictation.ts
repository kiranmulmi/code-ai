import { useCallback, useEffect, useRef } from 'react';
import { useToast } from '../../lib/toast';
import { transcribe } from './api';
import { readMicId } from './micPrefs';
import { useRecorder } from './useRecorder';

/**
 * The composer's dictation: records from the chosen mic and turns the speech into text with the
 * workspace's speech-to-text setting. `stop` puts the text in the box; `stopAndSend` sends it
 * straight away. Esc cancels while recording or transcribing.
 */
export function useDictation({
  workspaceId,
  onText,
  onSend,
}: {
  workspaceId: string;
  /** The text goes in the box, for the user to review. */
  onText: (text: string) => void;
  /** The text is sent as it is (the send arrow while recording). */
  onSend: (text: string) => void;
}) {
  const toast = useToast();
  const sendAfterRef = useRef(false);
  const recorder = useRecorder({
    micId: readMicId(),
    onRecorded: useCallback(
      async (audio: Blob, signal: AbortSignal) =>
        (await transcribe(audio, { workspaceId }, signal)).text,
      [workspaceId],
    ),
    onText: (text) => {
      const send = sendAfterRef.current;
      sendAfterRef.current = false;
      if (send) onSend(text);
      else onText(text);
    },
    onError: useCallback(
      (message: string) => {
        sendAfterRef.current = false;
        toast(message, 'error');
      },
      [toast],
    ),
  });
  const { state, cancel, stop } = recorder;

  useEffect(() => {
    if (state === 'idle') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        sendAfterRef.current = false;
        cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, cancel]);

  return {
    ...recorder,
    /** Stops recording; the text goes in the box. */
    stop: useCallback(() => {
      sendAfterRef.current = false;
      stop();
    }, [stop]),
    /** Stops recording and sends the text once it's transcribed. */
    stopAndSend: useCallback(() => {
      sendAfterRef.current = true;
      stop();
    }, [stop]),
    cancel: useCallback(() => {
      sendAfterRef.current = false;
      cancel();
    }, [cancel]),
    /** Whether the text will be sent as soon as it's transcribed. */
    isSending: () => sendAfterRef.current,
  };
}

export type Dictation = ReturnType<typeof useDictation>;
