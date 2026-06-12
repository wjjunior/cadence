import type { Conversation, ConversationKey } from '../../domain/conversation.js';
import type { Tx } from './tx.js';

export interface ConversationRepository {
  upsert(tx: Tx, key: ConversationKey): Promise<Conversation>;
  touch(tx: Tx, conversationId: string): Promise<void>;
  list(params: { cursor: string | null; limit: number }): Promise<Conversation[]>;
  getById(id: string): Promise<Conversation | null>;
}
