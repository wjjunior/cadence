export const jobStatus = {
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
} as const;

export type JobStatus = (typeof jobStatus)[keyof typeof jobStatus];

export interface Job {
  id: string;
  inboundMessageId: string;
  conversationId: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  nextRunAt: Date;
  lockedBy: string | null;
  leaseExpiresAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

export interface NewJob {
  inboundMessageId: string;
  conversationId: string;
}

// running -> pending serves both the backoff reschedule and the reaper returning an
// abandoned (lease-expired) job to the claimable pool.
const jobTransitions: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  [jobStatus.pending]: [jobStatus.running],
  [jobStatus.running]: [jobStatus.completed, jobStatus.failed, jobStatus.pending],
  [jobStatus.completed]: [],
  [jobStatus.failed]: [],
};

export class InvalidJobTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(`Invalid job status transition: ${from} -> ${to}`);
    this.name = 'InvalidJobTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function transitionJob(from: JobStatus, to: JobStatus): JobStatus {
  if (!jobTransitions[from].includes(to)) {
    throw new InvalidJobTransitionError(from, to);
  }
  return to;
}
