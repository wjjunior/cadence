import { describe, expect, it } from 'vitest';

import type { Conversation } from '../../domain/conversation.js';
import type { Message } from '../../domain/message.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { MessageRepository } from '../ports/message-repository.js';
import { GetConversationDetail } from './get-conversation-detail.js';

const id = '11111111-1111-4111-8111-111111111111';
const iso = '2026-06-11T10:00:00.000Z';

const conversation: Conversation = {
  id,
  userPhone: '+15550001111',
  systemPhone: '+15550002222',
  lastMessageAt: new Date(iso),
  createdAt: new Date(iso),
};

const failed: Message = {
  id: 'm1',
  conversationId: id,
  direction: 'outbound',
  body: 'reply',
  status: 'failed',
  providerMessageSid: null,
  idempotencyKey: 'reply:x',
  inReplyTo: 'in1',
  errorDetail: 'provider down',
  createdAt: new Date(iso),
  updatedAt: new Date(iso),
};

const convRepo = (c: Conversation | null): ConversationRepository => ({
  getById: () => Promise.resolve(c),
  list: () => Promise.reject(new Error('unused')),
  upsert: () => Promise.reject(new Error('unused')),
  touch: () => Promise.reject(new Error('unused')),
});

const msgRepo = (m: Message[]): MessageRepository => ({
  listByConversation: () => Promise.resolve(m),
  insertInbound: () => Promise.reject(new Error('unused')),
  insertOutbound: () => Promise.reject(new Error('unused')),
  insertOutboundIfNew: () => Promise.reject(new Error('unused')),
  markStatus: () => Promise.reject(new Error('unused')),
});

describe('GetConversationDetail', () => {
  it('should return null for an unknown conversation', async () => {
    const result = await new GetConversationDetail(convRepo(null), msgRepo([])).execute(id);
    expect(result).toBeNull();
  });

  it('should map the full history, surfacing direction, status and errorDetail', async () => {
    const result = await new GetConversationDetail(convRepo(conversation), msgRepo([failed])).execute(
      id,
    );

    expect(result?.id).toBe(id);
    expect(result?.messages).toHaveLength(1);
    expect(result?.messages[0]).toMatchObject({
      direction: 'outbound',
      status: 'failed',
      errorDetail: 'provider down',
      createdAt: iso,
    });
  });
});
