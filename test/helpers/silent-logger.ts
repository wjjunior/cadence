import type { Logger } from '../../src/application/ports/logger.js';

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLogger;
  },
};
