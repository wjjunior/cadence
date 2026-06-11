import { describe, expect, it } from 'vitest';
import { conversationKey } from './conversation.js';

describe('conversationKey', () => {
  it('should normalize cosmetically different but equivalent numbers to the same key', () => {
    const canonical = conversationKey('+15550001234', '+15559876543');
    const formatted = conversationKey('+1 (555) 000-1234', '+1-555-987-6543');
    const padded = conversationKey('  +1 555 000 1234  ', '+1.555.987.6543');
    expect(formatted).toEqual(canonical);
    expect(padded).toEqual(canonical);
  });

  it('should treat a 00 international prefix as equivalent to +', () => {
    expect(conversationKey('0015550001234', '+15559876543')).toEqual(
      conversationKey('+15550001234', '+15559876543'),
    );
  });

  it('should normalize the user and system phones independently', () => {
    expect(conversationKey('+1 (555) 000-1234', '+44 20 7946 0958')).toEqual({
      userPhone: '+15550001234',
      systemPhone: '+442079460958',
    });
  });

  it('should reject numbers that cannot be normalized to E.164', () => {
    expect(() => conversationKey('', '+15559876543')).toThrow();
    expect(() => conversationKey('not-a-number', '+15559876543')).toThrow();
    expect(() => conversationKey('+0123', '+15559876543')).toThrow(); // country code can't start with 0
    expect(() => conversationKey(`+${'9'.repeat(16)}`, '+15559876543')).toThrow(); // > 15 digits
  });
});
