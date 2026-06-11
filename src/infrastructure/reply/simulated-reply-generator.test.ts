import { describe, expect, it } from 'vitest';

import { SimulatedReplyGenerator } from './simulated-reply-generator.js';

const ctx = (inboundBody: string) => ({ conversationId: 'c1', inboundBody, history: [] });

function makeGen(opts: { minMs: number; maxMs: number }, random: () => number) {
  const slept: number[] = [];
  const gen = new SimulatedReplyGenerator(opts, {
    random,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  });
  return { gen, slept };
}

describe('SimulatedReplyGenerator', () => {
  it('should return the canned body echoing the inbound message text', async () => {
    const { gen } = makeGen({ minMs: 0, maxMs: 0 }, () => 0);
    const { body } = await gen.generate(ctx('hello there'));
    expect(body).toBe('Thanks for your message: "hello there". An agent will follow up shortly.');
  });

  it('should trim the inbound body in the reply', async () => {
    const { gen } = makeGen({ minMs: 0, maxMs: 0 }, () => 0);
    const { body } = await gen.generate(ctx('  spaced  '));
    expect(body).toBe('Thanks for your message: "spaced". An agent will follow up shortly.');
  });

  it('should sleep for minMs when random() returns 0', async () => {
    const { gen, slept } = makeGen({ minMs: 3000, maxMs: 15000 }, () => 0);
    await gen.generate(ctx('x'));
    expect(slept).toEqual([3000]);
  });

  it('should sleep for maxMs when random() returns 1', async () => {
    const { gen, slept } = makeGen({ minMs: 3000, maxMs: 15000 }, () => 1);
    await gen.generate(ctx('x'));
    expect(slept).toEqual([15000]);
  });

  it('should sleep for the fixed delay when minMs === maxMs', async () => {
    const { gen, slept } = makeGen({ minMs: 500, maxMs: 500 }, () => 0.42);
    await gen.generate(ctx('x'));
    expect(slept).toEqual([500]);
  });

  it('should map random uniformly across the inclusive integer range', async () => {
    // span 3 → equal-width buckets [0,1/3)→0, [1/3,2/3)→1, [2/3,1)→2; 1 clamps to 2.
    const cases: Array<[number, number]> = [
      [0, 0],
      [0.34, 1],
      [0.5, 1],
      [0.67, 2],
      [0.999, 2],
      [1, 2],
    ];
    for (const [r, expected] of cases) {
      const { gen, slept } = makeGen({ minMs: 0, maxMs: 2 }, () => r);
      await gen.generate(ctx('x'));
      expect(slept).toEqual([expected]);
    }
  });

  it('should keep the delay within [minMs, maxMs] across a sweep of random values', async () => {
    for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999, 1]) {
      const { gen, slept } = makeGen({ minMs: 3000, maxMs: 15000 }, () => r);
      await gen.generate(ctx('x'));
      expect(slept[0]).toBeGreaterThanOrEqual(3000);
      expect(slept[0]).toBeLessThanOrEqual(15000);
    }
  });

  it('should resolve without a real timer when sleep resolves immediately', async () => {
    const { gen } = makeGen({ minMs: 999999, maxMs: 999999 }, () => 0);
    await expect(gen.generate(ctx('x'))).resolves.toEqual({
      body: 'Thanks for your message: "x". An agent will follow up shortly.',
    });
  });
});
