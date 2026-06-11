import { z } from 'zod';

import type { ConversationChangedEvent } from '../../application/ports/event-bus.js';

export const conversationChangedSseEvent = z.object({
  type: z.literal('conversation.changed'),
  conversationId: z.uuid(),
});

export type ConversationChangedSseEvent = z.infer<typeof conversationChangedSseEvent>;

export function toSseEvent(event: ConversationChangedEvent): ConversationChangedSseEvent {
  return { type: 'conversation.changed', conversationId: event.conversationId };
}
