import type { ConversationDetail } from '../contracts/admin-dto.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { MessageRepository } from '../ports/message-repository.js';
import { toConversationSummary, toMessageDto } from './to-admin-dto.js';

export class GetConversationDetail {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
  ) {}

  async execute(id: string): Promise<ConversationDetail | null> {
    const conversation = await this.conversations.getById(id);
    if (!conversation) return null;
    const messages = await this.messages.listByConversation(id);
    return { ...toConversationSummary(conversation), messages: messages.map(toMessageDto) };
  }
}
