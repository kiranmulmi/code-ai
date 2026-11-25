import { synthesizeSpeech, transcribeAudio } from '@app/agent';
import {
  VOICE_LIMITS,
  audioExtension,
  type SpeechRequest,
  type TranscriptionQuery,
  type TranscriptionResult,
} from '@app/shared';
import type { AppContext } from '../../context.js';
import { NotFoundError, UpstreamError, ValidationError } from '../../lib/errors.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';

/** The raw audio body's limit (express.raw), a little over VOICE_LIMITS.maxBytes. */
export const VOICE_BODY_LIMIT = `${Math.ceil(VOICE_LIMITS.maxBytes / (1024 * 1024)) + 1}mb`;

/** A recording's content type the route takes. */
export const isAudioType = (type: string | undefined): boolean =>
  /^(audio\/|video\/webm|video\/mp4)/i.test(type ?? '');

/**
 * A speaking style for the gpt-4o speech models: voice mode reads short replies, so a natural,
 * conversational delivery suits it.
 */
export const SPEECH_STYLE =
  'Speak naturally and warmly, like a helpful colleague talking, at a relaxed conversational pace.';

/**
 * Speech to text (the mic button, voice mode, the settings test) and text to speech (voice
 * mode's spoken replies), both on a server: the browser's own speech engine is never used.
 * Audio and text are passed on once and never saved. The server and key are a saved model's
 * (Settings → Models).
 */
export function createVoiceService(
  { store }: Pick<AppContext, 'store'>,
  workspaces: Pick<WorkspacesService, 'require'>,
  transcribe: typeof transcribeAudio = transcribeAudio,
  synthesize: typeof synthesizeSpeech = synthesizeSpeech,
) {
  /** The saved voice setting of a workspace (a clear 400 when it has none). */
  async function savedSetting(workspaceId: string | undefined) {
    if (!workspaceId) throw new ValidationError('Pick a workspace.');
    const workspace = await workspaces.require(workspaceId);
    if (!workspace.voice) {
      throw new ValidationError(
        'Speech is off in this workspace. Set it up in Workspace settings → Voice.',
      );
    }
    return workspace.voice;
  }

  /** The server and key of a saved model (a clear 404 when it was deleted). */
  async function serverOf(modelId: string) {
    const resolved = await store.models.settingsFor(modelId);
    if (!resolved) {
      throw new NotFoundError(
        'The model picked for speech no longer exists. Pick another in Workspace settings → Voice.',
      );
    }
    return resolved.settings;
  }

  /** The saved voice setting of the workspace, or the one given (the settings test). */
  async function settingFor(query: TranscriptionQuery) {
    if (query.modelId && query.transcriptionModel) {
      return {
        modelId: query.modelId,
        transcriptionModel: query.transcriptionModel,
        language: query.language ?? '',
      };
    }
    return savedSetting(query.workspaceId);
  }

  return {
    async transcribe(
      query: TranscriptionQuery,
      audio: { data: Buffer; mimeType: string },
      signal?: AbortSignal,
    ): Promise<TranscriptionResult> {
      if (!audio.data.length) throw new ValidationError('The recording is empty.');
      if (audio.data.length > VOICE_LIMITS.maxBytes) {
        throw new ValidationError(
          `Recordings can be at most ${VOICE_LIMITS.maxBytes / (1024 * 1024)} MB.`,
        );
      }
      const setting = await settingFor(query);
      const server = await serverOf(setting.modelId);
      try {
        const text = await transcribe(
          server,
          {
            data: audio.data,
            mimeType: audio.mimeType,
            filename: `recording.${audioExtension(audio.mimeType)}`,
          },
          setting.transcriptionModel,
          { language: setting.language || undefined, signal },
        );
        return { text };
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new UpstreamError(error instanceof Error ? error.message : 'Speech to text failed.');
      }
    },

    /** Reads `text` aloud with the workspace's speech model and voice (or the given ones): mp3. */
    async speak(request: SpeechRequest, signal?: AbortSignal): Promise<Buffer> {
      const setting =
        request.modelId && request.speechModel && request.speechVoice
          ? {
              modelId: request.modelId,
              speechModel: request.speechModel,
              speechVoice: request.speechVoice,
            }
          : await savedSetting(request.workspaceId);
      const server = await serverOf(setting.modelId);
      try {
        return await synthesize(server, request.text, setting.speechModel, setting.speechVoice, {
          instructions: SPEECH_STYLE,
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new UpstreamError(error instanceof Error ? error.message : 'Text to speech failed.');
      }
    },
  };
}

export type VoiceService = ReturnType<typeof createVoiceService>;
