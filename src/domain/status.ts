export const inboundStatus = {
  received: 'received',
  processing: 'processing',
  processed: 'processed',
  failed: 'failed',
} as const;

export const outboundStatus = {
  queued: 'queued',
  sending: 'sending',
  sent: 'sent',
  failed: 'failed',
} as const;

export type InboundStatus = (typeof inboundStatus)[keyof typeof inboundStatus];
export type OutboundStatus = (typeof outboundStatus)[keyof typeof outboundStatus];

// The full user-facing message-status vocabulary (§A.3), as a tuple so it can seed a
// `z.enum` at the HTTP boundary from a single source. The drift-guard test asserts it
// stays equal to the union of the per-direction objects above.
export const messageStatusValues = [
  'received',
  'processing',
  'processed',
  'queued',
  'sending',
  'sent',
  'failed',
] as const;

export type MessageStatus = (typeof messageStatusValues)[number];

export const messageDirection = {
  inbound: 'inbound',
  outbound: 'outbound',
} as const;

export type MessageDirection = (typeof messageDirection)[keyof typeof messageDirection];

const inboundTransitions: Readonly<Record<InboundStatus, readonly InboundStatus[]>> = {
  [inboundStatus.received]: [inboundStatus.processing],
  [inboundStatus.processing]: [inboundStatus.processed, inboundStatus.failed],
  [inboundStatus.processed]: [],
  [inboundStatus.failed]: [],
};

const outboundTransitions: Readonly<Record<OutboundStatus, readonly OutboundStatus[]>> = {
  [outboundStatus.queued]: [outboundStatus.sending],
  [outboundStatus.sending]: [outboundStatus.sent, outboundStatus.failed],
  [outboundStatus.sent]: [],
  [outboundStatus.failed]: [],
};

export class InvalidStatusTransitionError extends Error {
  readonly from: string;
  readonly to: string;
  readonly direction: MessageDirection;

  constructor(direction: MessageDirection, from: string, to: string) {
    super(`Invalid ${direction} status transition: ${from} -> ${to}`);
    this.name = 'InvalidStatusTransitionError';
    this.direction = direction;
    this.from = from;
    this.to = to;
  }
}

export function transitionInbound(from: InboundStatus, to: InboundStatus): InboundStatus {
  if (!inboundTransitions[from].includes(to)) {
    throw new InvalidStatusTransitionError(messageDirection.inbound, from, to);
  }
  return to;
}

export function transitionOutbound(from: OutboundStatus, to: OutboundStatus): OutboundStatus {
  if (!outboundTransitions[from].includes(to)) {
    throw new InvalidStatusTransitionError(messageDirection.outbound, from, to);
  }
  return to;
}
