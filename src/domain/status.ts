export const INBOUND_STATUS = {
  received: 'received',
  processing: 'processing',
  processed: 'processed',
  failed: 'failed',
} as const;

export const OUTBOUND_STATUS = {
  queued: 'queued',
  sending: 'sending',
  sent: 'sent',
  failed: 'failed',
} as const;

export type InboundStatus = (typeof INBOUND_STATUS)[keyof typeof INBOUND_STATUS];
export type OutboundStatus = (typeof OUTBOUND_STATUS)[keyof typeof OUTBOUND_STATUS];

export const MESSAGE_DIRECTION = {
  inbound: 'inbound',
  outbound: 'outbound',
} as const;

export type MessageDirection = (typeof MESSAGE_DIRECTION)[keyof typeof MESSAGE_DIRECTION];

const INBOUND_TRANSITIONS: Readonly<Record<InboundStatus, readonly InboundStatus[]>> = {
  [INBOUND_STATUS.received]: [INBOUND_STATUS.processing],
  [INBOUND_STATUS.processing]: [INBOUND_STATUS.processed, INBOUND_STATUS.failed],
  [INBOUND_STATUS.processed]: [],
  [INBOUND_STATUS.failed]: [],
};

const OUTBOUND_TRANSITIONS: Readonly<Record<OutboundStatus, readonly OutboundStatus[]>> = {
  [OUTBOUND_STATUS.queued]: [OUTBOUND_STATUS.sending],
  [OUTBOUND_STATUS.sending]: [OUTBOUND_STATUS.sent, OUTBOUND_STATUS.failed],
  [OUTBOUND_STATUS.sent]: [],
  [OUTBOUND_STATUS.failed]: [],
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
  if (!INBOUND_TRANSITIONS[from].includes(to)) {
    throw new InvalidStatusTransitionError(MESSAGE_DIRECTION.inbound, from, to);
  }
  return to;
}

export function transitionOutbound(from: OutboundStatus, to: OutboundStatus): OutboundStatus {
  if (!OUTBOUND_TRANSITIONS[from].includes(to)) {
    throw new InvalidStatusTransitionError(MESSAGE_DIRECTION.outbound, from, to);
  }
  return to;
}
