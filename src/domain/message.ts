import type { MessageDirection, MessageStatus } from './status.js';

export interface Message {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  body: string;
  status: MessageStatus;
  providerMessageSid: string | null;
  idempotencyKey: string | null;
  inReplyTo: string | null;
  errorDetail: string | null;
  createdAt: Date;
  updatedAt: Date;
}
