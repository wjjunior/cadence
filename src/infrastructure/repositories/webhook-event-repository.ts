import type { WebhookEventRepository } from '../../application/ports/webhook-event-repository.js';
import type { Tx } from '../../application/ports/tx.js';
import { webhookEvents } from '../db/schema.js';
import { asDrizzle } from '../db/tx.js';

export class DrizzleWebhookEventRepository implements WebhookEventRepository {
  async insertIgnoringDuplicate(
    tx: Tx,
    providerSid: string,
    payload: unknown,
  ): Promise<{ inserted: boolean }> {
    const rows = await asDrizzle(tx)
      .insert(webhookEvents)
      .values({ providerSid, payload })
      .onConflictDoNothing({ target: webhookEvents.providerSid })
      .returning({ id: webhookEvents.id });
    return { inserted: rows.length > 0 };
  }
}
