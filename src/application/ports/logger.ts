export type LogEvent = { event: string } & Record<string, unknown>;

export interface Logger {
  debug(obj: LogEvent, msg?: string): void;
  info(obj: LogEvent, msg?: string): void;
  warn(obj: LogEvent, msg?: string): void;
  error(obj: LogEvent, msg?: string): void;
  child(bindings: object): Logger;
}
