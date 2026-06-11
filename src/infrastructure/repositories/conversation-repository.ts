import { desc, eq, sql } from 'drizzle-orm';
import type { ConversationRepository } from '../../application/ports/conversation-repository.js';
import type { Tx } from '../../application/ports/tx.js';
import { decodeConversationCursor } from '../../application/pagination/conversation-cursor.js';
import type { Conversation, ConversationKey } from '../../domain/conversation.js';
import type { Database } from '../db/client.js';
import { toConversation } from '../db/mappers.js';
import { conversations } from '../db/schema.js';
import { asDrizzle } from '../db/tx.js';

export class DrizzleConversationRepository implements ConversationRepository {
  constructor(private readonly db: Database) {}

  async upsert(tx: Tx, key: ConversationKey): Promise<Conversation> {
    const [row] = await asDrizzle(tx)
      .insert(conversations)
      .values({
        userPhone: key.userPhone,
        systemPhone: key.systemPhone,
        lastMessageAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [conversations.userPhone, conversations.systemPhone],
        set: { lastMessageAt: sql`now()` },
      })
      .returning();
    if (!row) throw new Error('conversation upsert returned no row');
    return toConversation(row);
  }

  async touch(tx: Tx, conversationId: string): Promise<void> {
    await asDrizzle(tx)
      .update(conversations)
      .set({ lastMessageAt: sql`now()` })
      .where(eq(conversations.id, conversationId));
  }

  async getById(id: string): Promise<Conversation | null> {
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);
    return row ? toConversation(row) : null;
  }

  async list(params: { cursor: string | null; limit: number }): Promise<Conversation[]> {
    const keyset = params.cursor ? decodeConversationCursor(params.cursor) : null;
    const rows = await this.db
      .select()
      .from(conversations)
      .where(
        keyset
          ? sql`(${conversations.lastMessageAt}, ${conversations.id}) < (${keyset.lastMessageAt}::timestamptz, ${keyset.id}::uuid)`
          : undefined,
      )
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
      .limit(params.limit);
    return rows.map(toConversation);
  }
}
