import { readPref, writePref } from '../../lib/storage';

/**
 * The microphone picked in Workspace settings → Voice, by device id ('' for the system
 * default). Device ids belong to this browser, so it's a UI preference, not a saved setting.
 */
const MIC_KEY = 'agent.voiceMicId';

export const readMicId = (): string => readPref(MIC_KEY) ?? '';
export const writeMicId = (id: string): void => writePref(MIC_KEY, id);

/** Whether this browser can record audio at all. */
export function canRecord(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined'
  );
}

/** A recording format the browser supports and transcription servers read (webm, else mp4). */
export function recordingType(): string | undefined {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return types.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * The browser's own clean-up: echo cancellation (the speakers' sound is taken out of the mic),
 * noise suppression and level control. Speech servers and the speech detector both do better.
 */
const CLEAN_AUDIO: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** Opens `micId` ('' or one that's gone: the default), asking for permission when needed. */
export async function openMic(micId: string): Promise<MediaStream> {
  if (micId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { ...CLEAN_AUDIO, deviceId: { exact: micId } },
      });
    } catch (error) {
      // Unplugged since it was picked: fall back to the default one.
      if (!(error instanceof DOMException) || error.name !== 'OverconstrainedError') throw error;
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: CLEAN_AUDIO });
}

/** A microphone error in words the user can act on. */
export function micErrorText(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access is blocked. Allow it for this site (the icon in the address bar), or in System Settings → Privacy & Security → Microphone.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Is one connected?';
    case 'NotReadableError':
      return 'The microphone is busy or unavailable (another app may be using it).';
    default:
      return "The microphone couldn't start. Try again.";
  }
}
