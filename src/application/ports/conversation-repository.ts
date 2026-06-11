import type { Conversation, ConversationKey } from '../../domain/conversation.js';
import type { Tx } from './tx.js';

export interface ConversationRepository {
  upsert(tx: Tx, key: ConversationKey): Promise<Conversation>;
  // cursor is the keyset (lastMessageAt, id) of the last row; the use case builds nextCursor.
  list(params: { cursor: string | null; limit: number }): Promise<Conversation[]>;
  getById(id: string): Promise<Conversation | null>;
}
