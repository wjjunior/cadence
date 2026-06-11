import { describe, expect, it, vi } from 'vitest';

import { MAX_BUFFERED_EVENTS, SseStream, type SseWritable } from './sse-stream.js';

class FakeWritable implements SseWritable {
  chunks: string[] = [];
  destroyed = false;
  writeReturn = true;
  throwOnWrite = false;
  private drainCb: (() => void) | null = null;

  write(chunk: string): boolean {
    if (this.throwOnWrite) throw new Error('socket gone');
    this.chunks.push(chunk);
    return this.writeReturn;
  }

  once(_event: 'drain', cb: () => void): void {
    this.drainCb = cb;
  }

  destroy(): void {
    this.destroyed = true;
  }

  emitDrain(): void {
    const cb = this.drainCb;
    this.drainCb = null;
    cb?.();
  }
}

describe('SseStream', () => {
  it('should frame an event as a data line terminated by a blank line', () => {
    const raw = new FakeWritable();
    const stream = new SseStream(raw, { onClose: vi.fn() });

    stream.event('{"type":"conversation.changed","conversationId":"c1"}');

    expect(raw.chunks).toEqual(['data: {"type":"conversation.changed","conversationId":"c1"}\n\n']);
  });

  it('should frame a heartbeat as an SSE comment', () => {
    const raw = new FakeWritable();
    const stream = new SseStream(raw, { onClose: vi.fn() });

    stream.comment();

    expect(raw.chunks).toEqual([':keep-alive\n\n']);
  });

  it('should clear backpressure on drain so a recovering slow client is not dropped', () => {
    const raw = new FakeWritable();
    const stream = new SseStream(raw, { onClose: vi.fn() });
    raw.writeReturn = false;

    for (let i = 0; i < MAX_BUFFERED_EVENTS; i++) stream.comment();
    raw.emitDrain();
    for (let i = 0; i < MAX_BUFFERED_EVENTS; i++) stream.comment();

    expect(raw.destroyed).toBe(false);
  });

  it('should drop itself once sustained backed-up writes exceed the buffer limit', () => {
    const raw = new FakeWritable();
    const onClose = vi.fn();
    const stream = new SseStream(raw, { onClose });
    raw.writeReturn = false;

    for (let i = 0; i <= MAX_BUFFERED_EVENTS; i++) stream.comment();

    expect(raw.destroyed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should drop itself when the underlying write throws', () => {
    const raw = new FakeWritable();
    const onClose = vi.fn();
    const stream = new SseStream(raw, { onClose });
    raw.throwOnWrite = true;

    expect(() => stream.event('{"a":1}')).not.toThrow();
    expect(raw.destroyed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should no-op writes after close and call onClose once', () => {
    const raw = new FakeWritable();
    const onClose = vi.fn();
    const stream = new SseStream(raw, { onClose });

    stream.close();
    stream.event('{"a":1}');
    stream.comment();
    stream.close();

    expect(raw.chunks).toEqual([]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
