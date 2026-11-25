import type { TranscriptionResult, WorkspaceVoiceInput } from '@app/shared';
import { jsonBody, request, requestBlobWith } from '../../lib/api';

/**
 * Turns a recording into text on the server: with the workspace's saved voice setting, or
 * with `setting` (the settings test, before it's saved). Nothing is kept.
 */
export function transcribe(
  audio: Blob,
  target: { workspaceId: string } | { setting: WorkspaceVoiceInput },
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const query = new URLSearchParams(
    'workspaceId' in target
      ? { workspaceId: target.workspaceId }
      : {
          modelId: target.setting.modelId,
          transcriptionModel: target.setting.transcriptionModel,
          ...(target.setting.language ? { language: target.setting.language } : {}),
        },
  );
  return request<TranscriptionResult>(`/voice/transcriptions?${query.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': audio.type.split(';')[0] || 'audio/webm' },
    body: audio,
    signal,
  });
}

/**
 * Reads `text` aloud on the server (its text-to-speech model): with the workspace's saved voice
 * setting, or with `setting` (the settings test). Resolves to the audio (mp3).
 */
export function synthesize(
  text: string,
  target:
    | { workspaceId: string }
    | { setting: { modelId: string; speechModel: string; speechVoice: string } },
  signal?: AbortSignal,
): Promise<Blob> {
  const body =
    'workspaceId' in target
      ? { text, workspaceId: target.workspaceId }
      : { text, ...target.setting };
  return requestBlobWith('/voice/speech', { ...jsonBody('POST', body), signal });
}
