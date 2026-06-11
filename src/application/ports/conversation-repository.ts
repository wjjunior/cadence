import type { Conversation, ConversationKey } from '../../domain/conversation.js';
import type { Tx } from './tx.js';

export interface ConversationRepository {
  upsert(tx: Tx, key: ConversationKey): Promise<Conversation>; // tx1
  list(params: { cursor: string | null; limit: number }): Promise<Conversation[]>; // read
  getById(id: string): Promise<Conversation | null>; // read (detail header)
}
