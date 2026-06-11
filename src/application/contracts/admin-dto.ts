import { z } from 'zod';
import { messageDirection, messageStatusValues } from '../../domain/status.js';

// Output contracts of the admin read use cases (CAD-25), serialized by http.
// Inferred types are the truth; no parallel hand-written interfaces (rule 13).

export const MessageDto = z.object({
  id: z.string(),
  direction: z.enum([messageDirection.inbound, messageDirection.outbound]),
  body: z.string(),
  status: z.enum(messageStatusValues),
  errorDetail: z.string().nullable(), // populated on failed
  createdAt: z.iso.datetime(),
});
export type MessageDto = z.infer<typeof MessageDto>;

export const ConversationSummary = z.object({
  id: z.string(),
  userPhone: z.string(),
  systemPhone: z.string(),
  lastMessageAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ConversationSummary = z.infer<typeof ConversationSummary>;

export const ConversationDetail = ConversationSummary.extend({
  messages: z.array(MessageDto),
});
export type ConversationDetail = z.infer<typeof ConversationDetail>;

export const ConversationListPage = z.object({
  items: z.array(ConversationSummary),
  nextCursor: z.string().nullable(),
});
export type ConversationListPage = z.infer<typeof ConversationListPage>;
