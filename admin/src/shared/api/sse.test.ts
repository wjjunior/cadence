import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeEventSource } from '@/test/fake-event-source';

import { type ConversationChangedSseEvent, type SseStatus, connectEvents } from './index';

beforeEach(() => {
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('connectEvents', () => {
  it('should parse a valid conversation.changed envelope', () => {
    const received: ConversationChangedSseEvent[] = [];
    connectEvents('/api/events', { onEvent: (e) => received.push(e), onStatus: () => {} });

    FakeEventSource.last().emitMessage(
      JSON.stringify({ type: 'conversation.changed', conversationId: 'c1' }),
    );

    expect(received).toEqual([{ type: 'conversation.changed', conversationId: 'c1' }]);
  });

  it('should ignore malformed json and wrong-shape payloads', () => {
    const received: ConversationChangedSseEvent[] = [];
    connectEvents('/api/events', { onEvent: (e) => received.push(e), onStatus: () => {} });

    FakeEventSource.last().emitMessage('not json');
    FakeEventSource.last().emitMessage(JSON.stringify({ type: 'other' }));

    expect(received).toEqual([]);
  });

  it('should surface connecting on a transient error and closed on a terminal one', () => {
    const statuses: SseStatus[] = [];
    connectEvents('/api/events', { onEvent: () => {}, onStatus: (s) => statuses.push(s) });
    const source = FakeEventSource.last();

    source.emitOpen();
    source.emitError(false);
    source.emitError(true);

    expect(statuses).toEqual(['connecting', 'open', 'connecting', 'closed']);
  });

  it('should close the underlying source on unsubscribe', () => {
    const close = connectEvents('/api/events', { onEvent: () => {}, onStatus: () => {} });
    const source = FakeEventSource.last();
    close();
    expect(source.closed).toBe(true);
  });
});
