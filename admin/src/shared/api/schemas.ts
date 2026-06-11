import { z } from 'zod';

export const messageDirections = ['inbound', 'outbound'] as const;
export const messageStatuses = [
  'received',
  'processing',
  'processed',
  'queued',
  'sending',
  'sent',
  'failed',
] as const;

export const messageDtoSchema = z.object({
  id: z.string(),
  direction: z.enum(messageDirections),
  body: z.string(),
  status: z.enum(messageStatuses),
  errorDetail: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type MessageDto = z.infer<typeof messageDtoSchema>;
export type MessageStatus = MessageDto['status'];
export type MessageDirection = MessageDto['direction'];

export const conversationSummarySchema = z.object({
  id: z.string(),
  userPhone: z.string(),
  systemPhone: z.string(),
  lastMessageAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationDetailSchema = conversationSummarySchema.extend({
  messages: z.array(messageDtoSchema),
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

export const conversationListPageSchema = z.object({
  items: z.array(conversationSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ConversationListPage = z.infer<typeof conversationListPageSchema>;

export const conversationChangedSseEventSchema = z.object({
  type: z.literal('conversation.changed'),
  conversationId: z.uuid(),
});
export type ConversationChangedSseEvent = z.infer<typeof conversationChangedSseEventSchema>;

export const appConfigSchema = z.object({
  smsProvider: z.enum(['mock', 'twilio']),
});
export type AppConfig = z.infer<typeof appConfigSchema>;
