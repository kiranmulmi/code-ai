import { z } from 'zod';

/** Speech to text: the audio the mic button and the settings test may send. */
export const VOICE_LIMITS = {
  /** OpenAI's cap for one transcription upload */
  maxBytes: 25 * 1024 * 1024,
  /** a recording stops on its own after this long */
  maxSeconds: 5 * 60,
  /** the settings test stops on its own after this long */
  testSeconds: 15,
  /** the transcription model name, at most */
  modelName: 200,
  /** a voice name, at most */
  voiceName: 100,
  /** text sent for speech in one request (OpenAI's cap is 4096 characters) */
  speechChars: 4096,
} as const;

/**
 * The tag a voice-mode reply wraps what is to be said aloud in: `<spoken>…</spoken>`. Voice mode
 * reads only these; the chat shows their text without the tags.
 */
export const SPOKEN_TAG = 'spoken';

/**
 * A reply as shown on screen: `<spoken>` tags removed (their text stays, as its own paragraph),
 * and a tag still being streamed (`<spo`) hidden until it is complete.
 */
export function withoutSpokenTags(text: string): string {
  if (!text.includes('<')) return text;
  return text
    .replace(/[ \t]*<spoken>[ \t]*\n?/gi, '')
    .replace(/[ \t]*<\/spoken>[ \t]*/gi, '\n\n')
    .replace(/<\/?(s(p(o(k(e(n)?)?)?)?)?)?$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The speech model and voice a workspace starts with: OpenAI's natural-sounding TTS. */
export const DEFAULT_SPEECH_MODEL = 'gpt-4o-mini-tts';
export const DEFAULT_SPEECH_VOICE = 'alloy';

const speechModel = z
  .string()
  .trim()
  .min(1, 'Enter the speech model name, like gpt-4o-mini-tts.')
  .max(VOICE_LIMITS.modelName, `Keep the model name under ${VOICE_LIMITS.modelName} characters.`);
const speechVoice = z
  .string()
  .trim()
  .min(1, 'Enter a voice, like alloy.')
  .max(VOICE_LIMITS.voiceName, `Keep the voice under ${VOICE_LIMITS.voiceName} characters.`);

/**
 * How a workspace turns speech into text and text into speech, both on a saved model's server
 * with its API key (`modelId`, Settings → Models): the transcription model to ask for there
 * (`whisper-1`, `gpt-4o-mini-transcribe`, `auto`, ...; the server needs `/audio/transcriptions`),
 * and for voice mode's spoken replies the speech model and voice (`gpt-4o-mini-tts` with
 * `alloy`, ...; the server needs `/audio/speech`). `language` is an ISO-639-1 code (`en`), empty
 * to let the server detect it. Nothing is done by the browser's own speech engine.
 */
export const workspaceVoiceSchema = z.object({
  modelId: z.string().uuid('Pick a model for speech to text.'),
  transcriptionModel: z
    .string()
    .trim()
    .min(1, 'Enter the transcription model name, like whisper-1.')
    .max(VOICE_LIMITS.modelName, `Keep the model name under ${VOICE_LIMITS.modelName} characters.`),
  language: z
    .string()
    .trim()
    .regex(/^([a-z]{2,3})?$/i, 'Use a two-letter language code, like en, or leave it empty.')
    .transform((value) => value.toLowerCase())
    .default(''),
  // Settings saved before spoken replies existed get the defaults.
  speechModel: speechModel.default(DEFAULT_SPEECH_MODEL),
  speechVoice: speechVoice.default(DEFAULT_SPEECH_VOICE),
});

export type WorkspaceVoice = z.infer<typeof workspaceVoiceSchema>;
export type WorkspaceVoiceInput = z.input<typeof workspaceVoiceSchema>;

/**
 * `POST /v1/voice/transcriptions` query: the workspace whose saved voice setting to use, or
 * (the settings test, before saving) the setting itself.
 */
export const transcriptionQuerySchema = z
  .object({
    workspaceId: z.string().uuid().optional(),
    modelId: z.string().uuid().optional(),
    transcriptionModel: z.string().trim().min(1).max(VOICE_LIMITS.modelName).optional(),
    language: z
      .string()
      .trim()
      .regex(/^([a-z]{2,3})?$/i)
      .optional(),
  })
  .refine((query) => query.workspaceId || (query.modelId && query.transcriptionModel), {
    message: 'Give a workspace, or a model and a transcription model name.',
  });

export type TranscriptionQuery = z.infer<typeof transcriptionQuerySchema>;

export interface TranscriptionResult {
  text: string;
}

/** The file extension a transcription server expects for a recording's content type. */
export function audioExtension(mimeType: string): string {
  const type = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type.includes('webm')) return 'webm';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('wav')) return 'wav';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'mp4';
  if (type.includes('flac')) return 'flac';
  return 'webm';
}

/**
 * `POST /v1/voice/speech` body: text to read aloud with the workspace's saved voice setting, or
 * (the settings test, before saving) with the setting itself. Answers with the audio (mp3).
 */
export const speechRequestSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, 'Give some text to read aloud.')
      .max(
        VOICE_LIMITS.speechChars,
        `Send at most ${VOICE_LIMITS.speechChars} characters at once.`,
      ),
    workspaceId: z.string().uuid().optional(),
    modelId: z.string().uuid().optional(),
    speechModel: speechModel.optional(),
    speechVoice: speechVoice.optional(),
  })
  .refine((body) => body.workspaceId || (body.modelId && body.speechModel && body.speechVoice), {
    message: 'Give a workspace, or a model, a speech model and a voice.',
  });

export type SpeechRequest = z.infer<typeof speechRequestSchema>;

/** The content type of the audio `POST /v1/voice/speech` answers with. */
export const SPEECH_AUDIO_TYPE = 'audio/mpeg';
