import type { Conversation } from '../../domain/conversation.js';
import type { Job } from '../../domain/job.js';
import type { Message } from '../../domain/message.js';
import { conversations, jobs, messages } from './schema.js';

// Explicit field mapping (not spread) so a changed schema column fails to compile here — the drift guard.

export function toConversation(row: typeof conversations.$inferSelect): Conversation {
  return {
    id: row.id,
    userPhone: row.userPhone,
    systemPhone: row.systemPhone,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
  };
}

export function toMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    direction: row.direction,
    body: row.body,
    status: row.status,
    providerMessageSid: row.providerMessageSid,
    idempotencyKey: row.idempotencyKey,
    inReplyTo: row.inReplyTo,
    errorDetail: row.errorDetail,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toJob(row: typeof jobs.$inferSelect): Job {
  return {
    id: row.id,
    inboundMessageId: row.inboundMessageId,
    conversationId: row.conversationId,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    nextRunAt: row.nextRunAt,
    lockedBy: row.lockedBy,
    leaseExpiresAt: row.leaseExpiresAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}
