import { pino } from 'pino';
import { supportsColor } from '@app/agent';
import { env } from './config/env.js';
import { prettyStream } from './log-stream.js';

/**
 * Readable one-line entries in the terminal (and the desktop app's server log), in the same
 * layout as the agent's run logs. `LOG_FORMAT=json` keeps pino's JSON lines for log tools.
 */
export const logger =
  env.LOG_FORMAT === 'json'
    ? pino({ level: env.LOG_LEVEL })
    : pino({ level: env.LOG_LEVEL }, prettyStream(process.stdout, supportsColor(process.stdout)));
