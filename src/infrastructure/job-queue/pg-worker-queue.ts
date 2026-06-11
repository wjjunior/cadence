import { and, eq } from 'drizzle-orm';

import type { WorkerQueue } from '../../application/ports/job-queue.js';
import type { Tx } from '../../application/ports/tx.js';
import { type Job, jobStatus } from '../../domain/job.js';
import type { DbClient } from '../db/client.js';
import { jobs } from '../db/schema.js';
import { asDrizzle } from '../db/tx.js';

const UNIQUE_VIOLATION = '23505';
const ONE_RUNNING_PER_CONVERSATION = 'one_running_per_conversation';
// Safety backstop only: benign 23505 contention converges in 0–1 retries once the
// winner commits and the FIFO predicate excludes our sibling.
const MAX_CLAIM_CONTENTION_RETRIES = 8;

export function isBenignContention(error: unknown): boolean {
  const e = error as { code?: string; constraint_name?: string };
  return e.code === UNIQUE_VIOLATION && e.constraint_name === ONE_RUNNING_PER_CONVERSATION;
}

interface JobRow {
  id: string;
  inbound_message_id: string;
  conversation_id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_run_at: string | Date;
  locked_by: string | null;
  lease_expires_at: string | Date | null;
  last_error: string | null;
  created_at: string | Date;
}

// postgres.js returns timestamptz as a Date for plain selects but as a string in
// this UPDATE … RETURNING path, so the boundary mapper normalizes to Date.
const toDate = (v: string | Date): Date => (v instanceof Date ? v : new Date(v));

// Maps a raw postgres.js claim row (snake_case) to a Job — distinct from
// db/mappers.ts toJob, which maps a Drizzle $inferSelect row. The status column
// is CHECK-constrained in the schema, so the value is a valid JobStatus.
function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    inboundMessageId: row.inbound_message_id,
    conversationId: row.conversation_id,
    status: row.status as Job['status'],
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextRunAt: toDate(row.next_run_at),
    lockedBy: row.locked_by,
    leaseExpiresAt: row.lease_expires_at === null ? null : toDate(row.lease_expires_at),
    lastError: row.last_error,
    createdAt: toDate(row.created_at),
  };
}

export class PgWorkerQueue implements WorkerQueue {
  constructor(
    private readonly sql: DbClient['sql'],
    private readonly opts: { leaseDurationMs: number },
  ) {}

  async claim(workerId: string): Promise<Job | null> {
    for (let attempt = 0; attempt < MAX_CLAIM_CONTENTION_RETRIES; attempt++) {
      try {
        const rows = await this.sql<JobRow[]>`
          UPDATE jobs SET
            status = ${jobStatus.running},
            locked_by = ${workerId},
            lease_expires_at = now() + ${this.opts.leaseDurationMs} * interval '1 millisecond',
            attempts = attempts + 1
          WHERE id = (
            SELECT j.id FROM jobs j
            WHERE j.status = ${jobStatus.pending} AND j.next_run_at <= now()
              AND NOT EXISTS (
                SELECT 1 FROM jobs r
                WHERE r.conversation_id = j.conversation_id
                  AND r.status IN (${jobStatus.pending}, ${jobStatus.running})
                  AND (r.created_at, r.id) < (j.created_at, j.id))
            ORDER BY j.created_at, j.id
            FOR UPDATE SKIP LOCKED
            LIMIT 1)
          RETURNING *`;
        const row = rows[0];
        return row ? rowToJob(row) : null;
      } catch (error) {
        if (isBenignContention(error)) continue;
        throw error;
      }
    }
    return null;
  }

  async complete(tx: Tx, jobId: string, workerId: string): Promise<boolean> {
    const rows = await asDrizzle(tx)
      .update(jobs)
      .set({ status: jobStatus.completed })
      .where(and(eq(jobs.id, jobId), eq(jobs.lockedBy, workerId)))
      .returning({ id: jobs.id });
    return rows.length > 0;
  }

  async fail(tx: Tx, jobId: string, workerId: string, error: string, retryAt: Date | null): Promise<boolean> {
    const owned = and(eq(jobs.id, jobId), eq(jobs.lockedBy, workerId));
    const set = retryAt
      ? { status: jobStatus.pending, nextRunAt: retryAt, lastError: error }
      : { status: jobStatus.failed, lastError: error };
    const rows = await asDrizzle(tx).update(jobs).set(set).where(owned).returning({ id: jobs.id });
    return rows.length > 0;
  }

  async reapExpiredLeases(): Promise<number> {
    const rows = await this.sql`
      UPDATE jobs SET status = ${jobStatus.pending}, locked_by = NULL, lease_expires_at = NULL
      WHERE status = ${jobStatus.running} AND lease_expires_at < now()
      RETURNING id`;
    return rows.length;
  }
}
