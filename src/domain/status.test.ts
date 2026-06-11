import { describe, expect, it } from 'vitest';

import {
  inboundStatus,
  type InboundStatus,
  InvalidStatusTransitionError,
  messageStatusValues,
  outboundStatus,
  type OutboundStatus,
  transitionInbound,
  transitionOutbound,
} from './status.js';

const inboundStates: InboundStatus[] = [
  inboundStatus.received,
  inboundStatus.processing,
  inboundStatus.processed,
  inboundStatus.failed,
];

const outboundStates: OutboundStatus[] = [
  outboundStatus.queued,
  outboundStatus.sending,
  outboundStatus.sent,
  outboundStatus.failed,
];

const validInboundEdges: ReadonlyArray<[InboundStatus, InboundStatus]> = [
  [inboundStatus.received, inboundStatus.processing],
  [inboundStatus.processing, inboundStatus.processed],
  [inboundStatus.processing, inboundStatus.failed],
];

const validOutboundEdges: ReadonlyArray<[OutboundStatus, OutboundStatus]> = [
  [outboundStatus.queued, outboundStatus.sending],
  [outboundStatus.sending, outboundStatus.sent],
  [outboundStatus.sending, outboundStatus.failed],
];

const isValid = <S>(edges: ReadonlyArray<[S, S]>, from: S, to: S): boolean =>
  edges.some(([f, t]) => f === from && t === to);

const allEdges = <S>(states: readonly S[]): Array<[S, S]> =>
  states.flatMap((from) => states.map((to): [S, S] => [from, to]));

describe('messageStatusValues', () => {
  it('should contain exactly the union of inbound and outbound status values', () => {
    const expected = new Set<string>([
      ...Object.values(inboundStatus),
      ...Object.values(outboundStatus),
    ]);
    expect(new Set<string>(messageStatusValues)).toEqual(expected);
  });

  it('should not contain duplicates', () => {
    expect(messageStatusValues.length).toBe(new Set<string>(messageStatusValues).size);
  });
});

describe('transitionInbound', () => {
  for (const [from, to] of validInboundEdges) {
    it(`should return ${to} for the valid edge ${from} -> ${to}`, () => {
      expect(transitionInbound(from, to)).toBe(to);
    });
  }

  for (const [from, to] of allEdges(inboundStates)) {
    if (isValid(validInboundEdges, from, to)) continue;
    it(`should throw on the invalid edge ${from} -> ${to}`, () => {
      expect(() => transitionInbound(from, to)).toThrow(InvalidStatusTransitionError);
    });
  }

  it('should expose from, to and direction on the thrown error', () => {
    try {
      transitionInbound(inboundStatus.processed, inboundStatus.processing);
      expect.unreachable('expected transitionInbound to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStatusTransitionError);
      const typed = error as InvalidStatusTransitionError;
      expect(typed.from).toBe(inboundStatus.processed);
      expect(typed.to).toBe(inboundStatus.processing);
      expect(typed.direction).toBe('inbound');
    }
  });
});

describe('transitionOutbound', () => {
  for (const [from, to] of validOutboundEdges) {
    it(`should return ${to} for the valid edge ${from} -> ${to}`, () => {
      expect(transitionOutbound(from, to)).toBe(to);
    });
  }

  for (const [from, to] of allEdges(outboundStates)) {
    if (isValid(validOutboundEdges, from, to)) continue;
    it(`should throw on the invalid edge ${from} -> ${to}`, () => {
      expect(() => transitionOutbound(from, to)).toThrow(InvalidStatusTransitionError);
    });
  }

  it('should expose from, to and direction on the thrown error', () => {
    try {
      transitionOutbound(outboundStatus.sent, outboundStatus.sending);
      expect.unreachable('expected transitionOutbound to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStatusTransitionError);
      const typed = error as InvalidStatusTransitionError;
      expect(typed.from).toBe(outboundStatus.sent);
      expect(typed.to).toBe(outboundStatus.sending);
      expect(typed.direction).toBe('outbound');
    }
  });
});
