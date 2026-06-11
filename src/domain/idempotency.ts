const REPLY_KEY_PREFIX = 'reply:';

// Backs the UNIQUE constraint on outbound messages so a retried job never sends
// a second reply (§3.5).
export function replyIdempotencyKey(inboundMessageId: string): string {
  return `${REPLY_KEY_PREFIX}${inboundMessageId}`;
}
