import pino, { type Logger as PinoLogger } from 'pino';

import type { LogLevel } from '../config.js';

export interface CreateLoggerOptions {
  level: LogLevel;
  service: string;
}

interface Destination {
  write(chunk: string): void;
}

export function createLogger(opts: CreateLoggerOptions, destination?: Destination): PinoLogger {
  const options = { level: opts.level, base: { service: opts.service } };
  return destination ? pino(options, destination) : pino(options);
}
