const REPLY_KEY_PREFIX = 'reply:';

// Backs the outbound UNIQUE constraint so a retried job never sends a second reply.
export function replyIdempotencyKey(inboundMessageId: string): string {
  return `${REPLY_KEY_PREFIX}${inboundMessageId}`;
}
