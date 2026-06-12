import type { Job, NewJob } from '../../domain/job.js';
import type { Tx } from './tx.js';

export interface JobEnqueuer {
  enqueueInTx(tx: Tx, job: NewJob): Promise<void>;
}

export interface QueueStats {
  pendingDepth: number;
  oldestPendingAgeMs: number | null;
}

export interface WorkerQueue {
  claim(workerId: string): Promise<Job | null>;
  reapExpiredLeases(): Promise<number>;
  // oldestPendingAgeMs is the lag of the oldest *claimable* job, so backed-off jobs don't inflate it.
  stats(): Promise<QueueStats>;
  // The boolean is whether we still owned the lock, so a worker whose lease expired writes nothing.
  complete(tx: Tx, jobId: string, workerId: string): Promise<boolean>;
  // A Date retryAt reschedules to pending; null is terminal.
  fail(tx: Tx, jobId: string, workerId: string, error: string, retryAt: Date | null): Promise<boolean>;
}
