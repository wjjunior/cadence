import { z } from 'zod';

import type {
  ConversationChangedEvent,
  EventBus,
  Unsubscribe,
} from '../../application/ports/event-bus.js';
import type { DbClient } from '../db/client.js';
import { notifyChannels } from '../db/notify-channels.js';

type Listener = (event: ConversationChangedEvent) => void;

const conversationIdPayload = z.uuid();

export class PgEventBus implements EventBus {
  private readonly subscribers = new Set<Listener>();
  private listener: { unlisten: () => Promise<void> } | null = null;
  private starting: Promise<void> | null = null;

  constructor(private readonly sql: DbClient['sql']) {}

  // postgres.js auto-reconnects this dedicated connection, so no reconnect path is needed (the
  // reconnect-window gap is covered by the admin poll). The pending guard shares one LISTEN
  // across concurrent start() calls instead of leaking a second connection.
  async start(): Promise<void> {
    if (this.listener) return;
    if (this.starting) return this.starting;
    this.starting = this.sql
      .listen(notifyChannels.conversationChanged, (payload) => this.fanOut(payload))
      .then((listener) => {
        this.listener = listener;
      });
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  subscribe(listener: Listener): Unsubscribe {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  async close(): Promise<void> {
    const pending = this.starting;
    if (pending) {
      try {
        await pending;
      } catch {
        // start failed; there is no listener to unlisten
      }
    }
    const current = this.listener;
    this.listener = null;
    this.subscribers.clear();
    if (current) await current.unlisten();
  }

  private fanOut(payload: string): void {
    const parsed = conversationIdPayload.safeParse(payload.trim());
    if (!parsed.success) return;
    const event: ConversationChangedEvent = { conversationId: parsed.data };
    for (const listener of this.subscribers) {
      try {
        listener(event);
      } catch {
        // dead client mid-fan-out; its close handler unsubscribes — don't starve the rest
      }
    }
  }
}
