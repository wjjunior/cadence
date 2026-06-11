const REPLY_KEY_PREFIX = 'reply:';

// Deterministic outbound idempotency key: the same inbound message always
// derives the same key, which backs the UNIQUE constraint on outbound messages
// so a retried job never sends a second reply (§3.5).
export function replyIdempotencyKey(inboundMessageId: string): string {
  return `${REPLY_KEY_PREFIX}${inboundMessageId}`;
}
