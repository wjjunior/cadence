import { describe, expect, it } from 'vitest';
import { backoffDelay } from './backoff.js';

const BASE = 1000;
const CAP = 60_000;

describe('backoffDelay', () => {
  it('should grow exponentially from the base with no jitter', () => {
    expect(backoffDelay(0, BASE, CAP, 0)).toBe(1000);
    expect(backoffDelay(1, BASE, CAP, 0)).toBe(2000);
    expect(backoffDelay(2, BASE, CAP, 0)).toBe(4000);
    expect(backoffDelay(3, BASE, CAP, 0)).toBe(8000);
  });

  it('should never exceed capMs for any attempt or jitter', () => {
    for (let attempt = 0; attempt <= 40; attempt++) {
      for (const rand of [0, 0.25, 0.5, 0.999999]) {
        expect(backoffDelay(attempt, BASE, CAP, rand)).toBeLessThanOrEqual(CAP);
      }
    }
  });

  it('should be monotonic non-decreasing in attempt for a fixed jitter', () => {
    const rand = 0.3;
    let previous = -1;
    for (let attempt = 0; attempt <= 20; attempt++) {
      const delay = backoffDelay(attempt, BASE, CAP, rand);
      expect(delay).toBeGreaterThanOrEqual(previous);
      previous = delay;
    }
  });

  it('should settle at the cap once the exponential passes it', () => {
    // 1000 * 2^6 = 64000 > 60000, so attempt 6+ is capped (rand = 0 → full cap).
    expect(backoffDelay(6, BASE, CAP, 0)).toBe(CAP);
    expect(backoffDelay(50, BASE, CAP, 0)).toBe(CAP);
  });

  it('should reduce the delay toward the floor as jitter grows', () => {
    const maxDelay = backoffDelay(2, BASE, CAP, 0); // 4000
    const jittered = backoffDelay(2, BASE, CAP, 0.999999);
    expect(jittered).toBeLessThan(maxDelay);
    expect(jittered).toBeGreaterThanOrEqual(maxDelay / 2);
  });

  it('should be deterministic for the same inputs', () => {
    expect(backoffDelay(3, BASE, CAP, 0.42)).toBe(backoffDelay(3, BASE, CAP, 0.42));
  });

  it('should reject a negative or non-integer attempt', () => {
    expect(() => backoffDelay(-1, BASE, CAP, 0)).toThrow(RangeError);
    expect(() => backoffDelay(1.5, BASE, CAP, 0)).toThrow(RangeError);
  });

  it('should reject a rand outside [0, 1) or NaN', () => {
    expect(() => backoffDelay(0, BASE, CAP, -0.1)).toThrow(RangeError);
    expect(() => backoffDelay(0, BASE, CAP, 1)).toThrow(RangeError);
    expect(() => backoffDelay(0, BASE, CAP, Number.NaN)).toThrow(RangeError);
  });

  it('should reject a non-finite or negative baseMs or capMs', () => {
    expect(() => backoffDelay(0, -1, CAP, 0)).toThrow(RangeError);
    expect(() => backoffDelay(0, BASE, -1, 0)).toThrow(RangeError);
    expect(() => backoffDelay(0, Number.NaN, CAP, 0)).toThrow(RangeError);
    expect(() => backoffDelay(0, BASE, Number.POSITIVE_INFINITY, 0)).toThrow(RangeError);
  });
});
