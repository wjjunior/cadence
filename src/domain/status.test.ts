import { describe, expect, it } from 'vitest';

import {
  INBOUND_STATUS,
  type InboundStatus,
  InvalidStatusTransitionError,
  OUTBOUND_STATUS,
  type OutboundStatus,
  transitionInbound,
  transitionOutbound,
} from './status.js';

const INBOUND_STATES: InboundStatus[] = [
  INBOUND_STATUS.received,
  INBOUND_STATUS.processing,
  INBOUND_STATUS.processed,
  INBOUND_STATUS.failed,
];

const OUTBOUND_STATES: OutboundStatus[] = [
  OUTBOUND_STATUS.queued,
  OUTBOUND_STATUS.sending,
  OUTBOUND_STATUS.sent,
  OUTBOUND_STATUS.failed,
];

const VALID_INBOUND_EDGES: ReadonlyArray<[InboundStatus, InboundStatus]> = [
  [INBOUND_STATUS.received, INBOUND_STATUS.processing],
  [INBOUND_STATUS.processing, INBOUND_STATUS.processed],
  [INBOUND_STATUS.processing, INBOUND_STATUS.failed],
];

const VALID_OUTBOUND_EDGES: ReadonlyArray<[OutboundStatus, OutboundStatus]> = [
  [OUTBOUND_STATUS.queued, OUTBOUND_STATUS.sending],
  [OUTBOUND_STATUS.sending, OUTBOUND_STATUS.sent],
  [OUTBOUND_STATUS.sending, OUTBOUND_STATUS.failed],
];

const isValid = <S>(edges: ReadonlyArray<[S, S]>, from: S, to: S): boolean =>
  edges.some(([f, t]) => f === from && t === to);

const allEdges = <S>(states: readonly S[]): Array<[S, S]> =>
  states.flatMap((from) => states.map((to): [S, S] => [from, to]));

describe('transitionInbound', () => {
  for (const [from, to] of VALID_INBOUND_EDGES) {
    it(`should return ${to} for the valid edge ${from} -> ${to}`, () => {
      expect(transitionInbound(from, to)).toBe(to);
    });
  }

  for (const [from, to] of allEdges(INBOUND_STATES)) {
    if (isValid(VALID_INBOUND_EDGES, from, to)) continue;
    it(`should throw on the invalid edge ${from} -> ${to}`, () => {
      expect(() => transitionInbound(from, to)).toThrow(InvalidStatusTransitionError);
    });
  }

  it('should expose from, to and direction on the thrown error', () => {
    try {
      transitionInbound(INBOUND_STATUS.processed, INBOUND_STATUS.processing);
      expect.unreachable('expected transitionInbound to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStatusTransitionError);
      const typed = error as InvalidStatusTransitionError;
      expect(typed.from).toBe(INBOUND_STATUS.processed);
      expect(typed.to).toBe(INBOUND_STATUS.processing);
      expect(typed.direction).toBe('inbound');
    }
  });
});

describe('transitionOutbound', () => {
  for (const [from, to] of VALID_OUTBOUND_EDGES) {
    it(`should return ${to} for the valid edge ${from} -> ${to}`, () => {
      expect(transitionOutbound(from, to)).toBe(to);
    });
  }

  for (const [from, to] of allEdges(OUTBOUND_STATES)) {
    if (isValid(VALID_OUTBOUND_EDGES, from, to)) continue;
    it(`should throw on the invalid edge ${from} -> ${to}`, () => {
      expect(() => transitionOutbound(from, to)).toThrow(InvalidStatusTransitionError);
    });
  }

  it('should expose from, to and direction on the thrown error', () => {
    try {
      transitionOutbound(OUTBOUND_STATUS.sent, OUTBOUND_STATUS.sending);
      expect.unreachable('expected transitionOutbound to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStatusTransitionError);
      const typed = error as InvalidStatusTransitionError;
      expect(typed.from).toBe(OUTBOUND_STATUS.sent);
      expect(typed.to).toBe(OUTBOUND_STATUS.sending);
      expect(typed.direction).toBe('outbound');
    }
  });
});
