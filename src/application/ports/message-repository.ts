import type { Message } from '../../domain/message.js';
import type { MessageStatus } from '../../domain/status.js';
import type { Tx } from './tx.js';

export interface NewInboundMessage {
  conversationId: string;
  body: string;
  providerMessageSid: string;
}

export interface NewOutboundMessage {
  conversationId: string;
  body: string;
  idempotencyKey: string;
  inReplyTo: string;
  providerMessageSid: string | null;
}

export interface MessageRepository {
  insertInbound(tx: Tx, input: NewInboundMessage): Promise<Message>;
  insertOutbound(tx: Tx, input: NewOutboundMessage): Promise<Message>;
  markStatus(tx: Tx, id: string, status: MessageStatus, errorDetail?: string | null): Promise<void>;
  listByConversation(conversationId: string): Promise<Message[]>;
}
