import type { Conversation } from '../../domain/conversation.js';
import type { Message } from '../../domain/message.js';
import type { ConversationSummary, MessageDto } from '../contracts/admin-dto.js';

export function toConversationSummary(c: Conversation): ConversationSummary {
  return {
    id: c.id,
    userPhone: c.userPhone,
    systemPhone: c.systemPhone,
    lastMessageAt: c.lastMessageAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
  };
}

export function toMessageDto(m: Message): MessageDto {
  return {
    id: m.id,
    direction: m.direction,
    body: m.body,
    status: m.status,
    errorDetail: m.errorDetail,
    createdAt: m.createdAt.toISOString(),
  };
}
