import { asc, eq, sql } from 'drizzle-orm';
import type {
  MessageRepository,
  NewInboundMessage,
  NewOutboundMessage,
} from '../../application/ports/message-repository.js';
import type { Tx } from '../../application/ports/tx.js';
import type { Message } from '../../domain/message.js';
import { inboundStatus, type MessageStatus, messageDirection, outboundStatus } from '../../domain/status.js';
import type { Database } from '../db/client.js';
import { toMessage } from '../db/mappers.js';
import { messages } from '../db/schema.js';
import { asDrizzle } from '../db/tx.js';

export class DrizzleMessageRepository implements MessageRepository {
  constructor(private readonly db: Database) {}

  async insertInbound(tx: Tx, input: NewInboundMessage): Promise<Message> {
    const [row] = await asDrizzle(tx)
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        direction: messageDirection.inbound,
        body: input.body,
        status: inboundStatus.received,
        providerMessageSid: input.providerMessageSid,
      })
      .returning();
    if (!row) throw new Error('insertInbound returned no row');
    return toMessage(row);
  }

  async insertOutbound(tx: Tx, input: NewOutboundMessage): Promise<Message> {
    const [row] = await asDrizzle(tx)
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        direction: messageDirection.outbound,
        body: input.body,
        status: outboundStatus.queued,
        idempotencyKey: input.idempotencyKey,
        inReplyTo: input.inReplyTo,
        providerMessageSid: input.providerMessageSid,
      })
      // no-op DO UPDATE (not DO NOTHING) so RETURNING yields the existing row on a dedup retry.
      .onConflictDoUpdate({
        target: messages.idempotencyKey,
        targetWhere: sql`${messages.direction} = ${messageDirection.outbound}`,
        set: { idempotencyKey: sql`excluded.idempotency_key` },
      })
      .returning();
    if (!row) throw new Error('insertOutbound returned no row');
    return toMessage(row);
  }

  async markStatus(
    tx: Tx,
    id: string,
    status: MessageStatus,
    errorDetail?: string | null,
  ): Promise<void> {
    await asDrizzle(tx)
      .update(messages)
      // error_detail is only written when the caller passes it, so a happy-path status
      // change does not wipe a previously recorded error.
      .set(
        errorDetail === undefined
          ? { status, updatedAt: sql`now()` }
          : { status, errorDetail, updatedAt: sql`now()` },
      )
      .where(eq(messages.id, id));
  }

  async listByConversation(conversationId: string): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));
    return rows.map(toMessage);
  }
}
