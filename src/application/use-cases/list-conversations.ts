import type { ConversationListPage } from '../contracts/admin-dto.js';
import { encodeConversationCursor } from '../pagination/conversation-cursor.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import { toConversationSummary } from './to-admin-dto.js';

export interface ListConversationsParams {
  cursor: string | null;
  limit: number;
}

export class ListConversations {
  constructor(private readonly conversations: ConversationRepository) {}

  async execute(params: ListConversationsParams): Promise<ConversationListPage> {
    // Fetch one extra row to tell a full final page apart from a page with more behind it.
    const rows = await this.conversations.list({ cursor: params.cursor, limit: params.limit + 1 });
    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;
    const last = page.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeConversationCursor({ lastMessageAt: last.lastMessageAt.toISOString(), id: last.id })
        : null;
    return { items: page.map(toConversationSummary), nextCursor };
  }
}
