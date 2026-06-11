import { describe, expect, it, vi } from 'vitest';

import type { DbClient } from '../db/client.js';
import { PgEventBus } from './pg-event-bus.js';

type NotifyCb = (payload: string) => void;

function fakeSql(): { sql: DbClient['sql']; listen: ReturnType<typeof vi.fn>; emit: NotifyCb } {
  let captured: NotifyCb = () => {};
  const listen = vi.fn((_channel: string, onNotify: NotifyCb) => {
    captured = onNotify;
    return Promise.resolve({ unlisten: () => Promise.resolve() });
  });
  return {
    sql: { listen } as unknown as DbClient['sql'],
    listen,
    emit: (payload) => captured(payload),
  };
}

describe('PgEventBus', () => {
  it('should issue a single LISTEN when start is called concurrently', async () => {
    const { sql, listen } = fakeSql();
    const bus = new PgEventBus(sql);

    await Promise.all([bus.start(), bus.start()]);

    expect(listen).toHaveBeenCalledTimes(1);
  });

  it('should keep notifying other subscribers when one listener throws', async () => {
    const { sql, emit } = fakeSql();
    const bus = new PgEventBus(sql);
    await bus.start();
    const received: string[] = [];
    bus.subscribe(() => {
      throw new Error('dead client');
    });
    bus.subscribe((event) => received.push(event.conversationId));

    emit('c1');

    expect(received).toEqual(['c1']);
  });

  it('should ignore an empty notification payload', async () => {
    const { sql, emit } = fakeSql();
    const bus = new PgEventBus(sql);
    await bus.start();
    const received: string[] = [];
    bus.subscribe((event) => received.push(event.conversationId));

    emit('   ');

    expect(received).toEqual([]);
  });

  it('should stop delivering to an unsubscribed listener', async () => {
    const { sql, emit } = fakeSql();
    const bus = new PgEventBus(sql);
    await bus.start();
    const received: string[] = [];
    const unsubscribe = bus.subscribe((event) => received.push(event.conversationId));

    unsubscribe();
    emit('c1');

    expect(received).toEqual([]);
  });
});
