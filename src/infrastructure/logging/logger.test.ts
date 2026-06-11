import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.js';

function capture(): { lines: Array<Record<string, unknown>>; write: (chunk: string) => void } {
  const lines: Array<Record<string, unknown>> = [];
  return { lines, write: (chunk) => lines.push(JSON.parse(chunk)) };
}

describe('createLogger', () => {
  it('should emit valid JSON carrying the service and the event fields', () => {
    const sink = capture();
    const logger = createLogger({ level: 'info', service: 'worker' }, { write: sink.write });

    logger.info({ event: 'job_completed', jobId: 'j1', conversationId: 'c1' });

    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toMatchObject({
      service: 'worker',
      event: 'job_completed',
      jobId: 'j1',
      conversationId: 'c1',
    });
  });

  it('should include child bindings on every line', () => {
    const sink = capture();
    const logger = createLogger({ level: 'info', service: 'worker' }, { write: sink.write });

    logger.child({ jobId: 'j9' }).info({ event: 'job_processing' });

    expect(sink.lines[0]).toMatchObject({ service: 'worker', jobId: 'j9', event: 'job_processing' });
  });

  it('should suppress lines below the configured level', () => {
    const sink = capture();
    const logger = createLogger({ level: 'warn', service: 'api' }, { write: sink.write });

    logger.info({ event: 'ignored' });
    logger.warn({ event: 'kept' });

    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toMatchObject({ event: 'kept' });
  });
});
