import { describe, expect, it } from 'vitest';

import { isBenignContention } from './pg-worker-queue.js';

describe('isBenignContention', () => {
  it('should be true for a unique_violation on one_running_per_conversation', () => {
    expect(
      isBenignContention({ code: '23505', constraint_name: 'one_running_per_conversation' }),
    ).toBe(true);
  });

  it('should be false for a unique_violation on a different constraint', () => {
    expect(isBenignContention({ code: '23505', constraint_name: 'messages_outbound_key' })).toBe(
      false,
    );
  });

  it('should be false for a non-unique-violation error', () => {
    expect(isBenignContention({ code: '23514' })).toBe(false);
  });

  it('should be false for a non-postgres error', () => {
    expect(isBenignContention(new Error('boom'))).toBe(false);
  });
});
