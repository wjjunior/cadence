import { describe, expect, it } from 'vitest';

// Smoke test: proves the Vitest harness runs green on the skeleton.
// Real domain unit tests and the Postgres integration suite land in later waves.
describe('bootstrap', () => {
  it('runs the test harness', () => {
    expect(1 + 1).toBe(2);
  });
});
