import { pino } from 'pino';
import { env } from './config/env.js';

/** One-line JSON for every log entry, dev and prod alike: easy to grep, pipe to
 *  aggregators, and read in the terminal. (Pretty-printed object dumps made the
 *  request logs span a dozen lines per entry.) */
export const logger = pino({ level: env.LOG_LEVEL });
