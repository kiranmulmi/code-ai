import express, { Router } from 'express';
import { SPEECH_AUDIO_TYPE, speechRequestSchema, transcriptionQuerySchema } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { UnsupportedMediaTypeError } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { VOICE_BODY_LIMIT, isAudioType, type VoiceService } from './voice.service.js';

/**
 * Speech on a server. Transcription is the one route with a body other than JSON (requireJson
 * lets audio through for it).
 * `POST /v1/voice/transcriptions?workspaceId=` with the recording as the raw body
 * (`Content-Type: audio/webm`, ...): `{ text }`. `?modelId=&transcriptionModel=&language=`
 * instead tests a setting before it's saved.
 */
export function voiceRouter(voice: VoiceService): Router {
  const router = Router();

  router.post(
    '/voice/transcriptions',
    express.raw({
      type: (req) => isAudioType(req.headers['content-type']),
      limit: VOICE_BODY_LIMIT,
    }),
    asyncHandler(async (req, res) => {
      const mimeType = req.headers['content-type'] ?? '';
      if (!isAudioType(mimeType) || !Buffer.isBuffer(req.body)) {
        throw new UnsupportedMediaTypeError(
          'Send the recording as audio (audio/webm, audio/mp4, …).',
        );
      }
      const query = parse(transcriptionQuerySchema, req.query);
      // The browser gave up (the user cancelled): stop asking the speech server.
      const stop = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) stop.abort();
      });
      const data = await voice.transcribe(query, { data: req.body, mimeType }, stop.signal);
      res.json({ data });
    }),
  );

  // `POST /v1/voice/speech` `{ text, workspaceId }` (or `modelId`, `speechModel`, `speechVoice`
  // to test a setting): the text read aloud by the speech server, as mp3.
  router.post(
    '/voice/speech',
    asyncHandler(async (req, res) => {
      const body = parse(speechRequestSchema, req.body);
      const stop = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) stop.abort();
      });
      const audio = await voice.speak(body, stop.signal);
      res.setHeader('Content-Type', audioTypeOf(audio));
      res.setHeader('Cache-Control', 'no-store');
      res.send(audio);
    }),
  );

  return router;
}

/**
 * The real type of the audio a speech server sent. Many local servers (Kokoro, Piper, proxies)
 * answer with WAV or another format even when asked for mp3, and a browser won't play audio
 * labelled with the wrong type, so this reads the file's first bytes instead of trusting the request.
 */
export function audioTypeOf(audio: Buffer): string {
  const ascii = (start: number, end: number) => audio.subarray(start, end).toString('latin1');
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(0, 4) === 'fLaC') return 'audio/flac';
  if (ascii(4, 8) === 'ftyp') return 'audio/mp4';
  if (audio[0] === 0x1a && audio[1] === 0x45 && audio[2] === 0xdf && audio[3] === 0xa3) return 'audio/webm';
  return SPEECH_AUDIO_TYPE;
}
