import type { NextFunction, Request, Response } from 'express';
import { ALLOWED_HOSTS } from '../config/env.js';
import { ForbiddenError, UnsupportedMediaTypeError } from '../lib/errors.js';

/** Only answer requests addressed to this machine, which blocks DNS-rebinding tricks. */
export function localHostOnly(req: Request, _res: Response, next: NextFunction): void {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  next(ALLOWED_HOSTS.has(host) ? undefined : new ForbiddenError('Forbidden host.'));
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Paths that take a raw audio recording instead of JSON (speech to text). An audio content
 * type isn't one a plain form can send, so a browser preflights it (CORS) like JSON.
 */
const AUDIO_PATHS = new Set(['/v1/voice/transcriptions']);

/** Requiring JSON on writes blocks plain HTML form posts from other websites. */
export function requireJson(req: Request, _res: Response, next: NextFunction): void {
  const type = req.headers['content-type'] ?? '';
  const isJson = type.startsWith('application/json');
  const isAudio = AUDIO_PATHS.has(req.path) && /^(audio\/|video\/(webm|mp4))/i.test(type);
  next(
    BODY_METHODS.has(req.method) && !isJson && !isAudio
      ? new UnsupportedMediaTypeError()
      : undefined,
  );
}
