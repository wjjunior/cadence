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
  // pendingDepth is total backlog; oldestPendingAgeMs is the lag of the oldest *claimable* job
  // (next_run_at <= now), so backed-off jobs don't inflate it. null when nothing is eligible.
  stats(): Promise<QueueStats>;
  // workerId guards against a worker whose lease expired mid-processing clobbering a job another
  // worker has since re-claimed; the returned boolean (did we still own the lock?) lets the caller
  // gate the rest of its transaction so a stale worker writes nothing at all.
  complete(tx: Tx, jobId: string, workerId: string): Promise<boolean>;
  // claim already incremented attempts (§5.1); a Date retryAt reschedules to pending, null is terminal.
  fail(tx: Tx, jobId: string, workerId: string, error: string, retryAt: Date | null): Promise<boolean>;
}
