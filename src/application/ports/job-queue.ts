import type { Job, NewJob } from '../../domain/job.js';
import type { Tx } from './tx.js';

// Ingest side: enqueue participates in the ingest transaction (tx1).
export interface JobEnqueuer {
  enqueueInTx(tx: Tx, job: NewJob): Promise<void>;
}

// Worker side. claim and reapExpiredLeases are self-atomic single statements (no
// external tx). complete and fail participate in the worker outcome transaction (tx2).
export interface WorkerQueue {
  claim(workerId: string): Promise<Job | null>;
  reapExpiredLeases(): Promise<number>;
  complete(tx: Tx, jobId: string): Promise<void>;
  // `claim` already incremented `attempts` (design §5.1); fail only records the outcome.
  // retryAt: a Date reschedules (running -> pending, next_run_at = retryAt); null is terminal (running -> failed).
  fail(tx: Tx, jobId: string, error: string, retryAt: Date | null): Promise<void>;
}
