import type { Job, NewJob } from '../../domain/job.js';
import type { Tx } from './tx.js';

export interface JobEnqueuer {
  enqueueInTx(tx: Tx, job: NewJob): Promise<void>;
}

export interface WorkerQueue {
  claim(workerId: string): Promise<Job | null>;
  reapExpiredLeases(): Promise<number>;
  // workerId guards against a worker whose lease expired mid-processing clobbering a job
  // another worker has since re-claimed: the write only lands while we still hold the lock.
  complete(tx: Tx, jobId: string, workerId: string): Promise<void>;
  // claim already incremented attempts (§5.1); a Date retryAt reschedules to pending, null is terminal.
  fail(tx: Tx, jobId: string, workerId: string, error: string, retryAt: Date | null): Promise<void>;
}
