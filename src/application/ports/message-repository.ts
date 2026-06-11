import type { Message, MessageStatus } from '../../domain/message.js';
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
  providerMessageSid: string;
}

export interface MessageRepository {
  insertInbound(tx: Tx, input: NewInboundMessage): Promise<Message>; // tx1, status = received
  insertOutbound(tx: Tx, input: NewOutboundMessage): Promise<Message>; // tx2
  markStatus(tx: Tx, id: string, status: MessageStatus, errorDetail?: string | null): Promise<void>; // tx1/tx2
  listByConversation(conversationId: string): Promise<Message[]>; // read
}
