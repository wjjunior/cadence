import { describe, expect, it } from 'vitest';

import { formatPhone, relativeTime } from './format';

describe('relativeTime', () => {
  const now = Date.parse('2026-06-11T12:00:00.000Z');

  it('should say "just now" under a minute', () => {
    expect(relativeTime('2026-06-11T11:59:30.000Z', now)).toBe('just now');
  });

  it('should render minutes, hours and days compactly', () => {
    expect(relativeTime('2026-06-11T11:45:00.000Z', now)).toBe('15m');
    expect(relativeTime('2026-06-11T09:00:00.000Z', now)).toBe('3h');
    expect(relativeTime('2026-06-09T12:00:00.000Z', now)).toBe('2d');
  });

  it('should fall back to an absolute date past a week', () => {
    expect(relativeTime('2026-05-01T12:00:00.000Z', now)).toMatch(/\d/);
    expect(relativeTime('2026-05-01T12:00:00.000Z', now)).not.toMatch(/just now|m$|h$|d$/);
  });
});

describe('formatPhone', () => {
  it('should group an E.164 number', () => {
    expect(formatPhone('+15550001234')).toBe('+1 555 000 1234');
  });

  it('should return non-E.164 input unchanged', () => {
    expect(formatPhone('sim:abc')).toBe('sim:abc');
  });
});
