import type {
  ConversationChangedEvent,
  EventBus,
  Unsubscribe,
} from '../../application/ports/event-bus.js';
import type { DbClient } from '../db/client.js';
import { notifyChannels } from '../db/notify-channels.js';

type Listener = (event: ConversationChangedEvent) => void;

export class PgEventBus implements EventBus {
  private readonly subscribers = new Set<Listener>();
  private listener: { unlisten: () => Promise<void> } | null = null;
  private starting: Promise<void> | null = null;

  constructor(private readonly sql: DbClient['sql']) {}

  // postgres.js owns this dedicated connection and auto-reconnects with backoff, re-issuing
  // LISTEN on reconnect; events lost during that window are covered by the admin poll, so no
  // onlisten catch-up is needed here (unlike the worker). The pending-promise guard makes
  // concurrent start() calls share one LISTEN rather than opening (and leaking) a second.
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
    const current = this.listener;
    this.listener = null;
    this.subscribers.clear();
    if (current) await current.unlisten();
  }

  private fanOut(payload: string): void {
    const conversationId = payload.trim();
    if (!conversationId) return;
    const event: ConversationChangedEvent = { conversationId };
    for (const listener of this.subscribers) {
      try {
        listener(event);
      } catch {
        // dead client mid-fan-out; its close handler unsubscribes — don't starve the rest
      }
    }
  }
}
