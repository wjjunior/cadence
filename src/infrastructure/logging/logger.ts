import pino, { type Logger as PinoLogger } from 'pino';

export interface CreateLoggerOptions {
  level: string;
  service: string;
}

interface Destination {
  write(chunk: string): void;
}

export function createLogger(opts: CreateLoggerOptions, destination?: Destination): PinoLogger {
  const options = { level: opts.level, base: { service: opts.service } };
  return destination ? pino(options, destination) : pino(options);
}
