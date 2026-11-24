import { pino } from 'pino';
import { env } from './config/env.js';

/** Human-readable, colorized logs while developing; plain JSON in production
 *  (easier to pipe to log aggregators and to write to files). */
const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino(
  isDev
    ? {
        level: env.LOG_LEVEL,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            levelFirst: true,
          },
        },
      }
    : { level: env.LOG_LEVEL },
);
