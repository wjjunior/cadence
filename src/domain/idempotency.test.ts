import { describe, expect, it } from 'vitest';
import { replyIdempotencyKey } from './idempotency.js';

describe('replyIdempotencyKey', () => {
  it('should derive the deterministic reply:{id} key', () => {
    expect(replyIdempotencyKey('abc-123')).toBe('reply:abc-123');
  });

  it('should return the same key for the same inbound message id', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(replyIdempotencyKey(id)).toBe(replyIdempotencyKey(id));
  });

  it('should map distinct inbound ids to distinct keys', () => {
    expect(replyIdempotencyKey('a')).not.toBe(replyIdempotencyKey('b'));
  });
});
