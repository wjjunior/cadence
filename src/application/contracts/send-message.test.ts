import { describe, expect, it } from 'vitest';

import { SendMessage } from './send-message.js';

describe('SendMessage', () => {
  it('should accept a recipient and body', () => {
    const result = SendMessage.safeParse({ to: '+15551230001', body: 'hello' });
    expect(result.success).toBe(true);
  });

  it('should accept an optional idempotencyKey', () => {
    const result = SendMessage.safeParse({ to: '+15551230001', body: 'hi', idempotencyKey: 'k-1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.idempotencyKey).toBe('k-1');
  });

  it('should reject an empty recipient', () => {
    expect(SendMessage.safeParse({ to: '', body: 'hi' }).success).toBe(false);
  });

  it('should reject an empty body', () => {
    expect(SendMessage.safeParse({ to: '+15551230001', body: '' }).success).toBe(false);
  });

  it('should reject a missing recipient', () => {
    expect(SendMessage.safeParse({ body: 'hi' }).success).toBe(false);
  });
});
