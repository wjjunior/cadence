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
  // Nullable: an outbound row may be created before the provider returns the SID
  // (matches the entity). The exact pre/post-send ordering is a CAD-23 choreography call.
  providerMessageSid: string | null;
}

export interface MessageRepository {
  insertInbound(tx: Tx, input: NewInboundMessage): Promise<Message>; // tx1, status = received
  insertOutbound(tx: Tx, input: NewOutboundMessage): Promise<Message>; // tx2
  // Callers validate the edge with domain transitionInbound/transitionOutbound first;
  // this only persists the already-validated status (it does not re-check the direction).
  markStatus(tx: Tx, id: string, status: MessageStatus, errorDetail?: string | null): Promise<void>; // tx1/tx2
  listByConversation(conversationId: string): Promise<Message[]>; // read
}
