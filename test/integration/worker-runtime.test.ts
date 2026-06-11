import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Job } from '../../src/domain/job.js';
import { type DbClient, createDbClient } from '../../src/infrastructure/db/client.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { PgWorkerQueue } from '../../src/infrastructure/job-queue/pg-worker-queue.js';
import { WorkerRuntime } from '../../src/infrastructure/worker/worker-runtime.js';

const LEASE_MS = 60_000;

let container: StartedPostgreSqlContainer;
let client: DbClient;
let sql: DbClient['sql'];
let queue: PgWorkerQueue;
let runtime: WorkerRuntime | null = null;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  client = createDbClient(url, { max: 12 });
  sql = client.sql;
  queue = new PgWorkerQueue(sql, { leaseDurationMs: LEASE_MS });
});

afterAll(async () => {
  try {
    await sql?.end();
  } finally {
    await container?.stop();
  }
});

beforeEach(async () => {
  await sql`truncate jobs, messages, conversations restart identity cascade`;
});

afterEach(async () => {
  await runtime?.stop();
  runtime = null;
});

let seq = 0;
const uniq = (): string => `${Date.now()}-${++seq}`;

async function seedPendingJob(): Promise<string> {
  const n = uniq();
  const conv = await sql<{ id: string }[]>`
    insert into conversations (user_phone, system_phone)
    values (${`u-${n}`}, ${`s-${n}`}) returning id`;
  const convId = conv[0]!.id;
  const msg = await sql<{ id: string }[]>`
    insert into messages (conversation_id, direction, body, status)
    values (${convId}, 'inbound', 'hi', 'received') returning id`;
  const job = await sql<{ id: string }[]>`
    insert into jobs (inbound_message_id, conversation_id, status)
    values (${msg[0]!.id}, ${convId}, 'pending') returning id`;
  return job[0]!.id;
}

async function seedRunningExpiredJob(): Promise<string> {
  const jobId = await seedPendingJob();
  await sql`update jobs set status = 'running', locked_by = 'dead',
            lease_expires_at = now() - interval '1 second' where id = ${jobId}`;
  return jobId;
}

function recorder() {
  const processed: string[] = [];
  const processJob = (job: Job): Promise<void> => {
    processed.push(job.id);
    return Promise.resolve();
  };
  return { processed, processJob };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('WorkerRuntime poll + reaper + concurrency', () => {
  it('should process a pending job via the reconciliation poll without any notification', async () => {
    const { processed, processJob } = recorder();
    runtime = new WorkerRuntime({
      queue,
      sql,
      processJob,
      concurrency: 2,
      reconcilePollMs: 300,
      workerId: 'w',
    });
    await runtime.start();

    const jobId = await seedPendingJob();
    await waitFor(() => processed.includes(jobId));
    expect(processed).toContain(jobId);
  });

  it('should reclaim a lease-expired running job and process it', async () => {
    const { processed, processJob } = recorder();
    const jobId = await seedRunningExpiredJob();
    runtime = new WorkerRuntime({
      queue,
      sql,
      processJob,
      concurrency: 2,
      reconcilePollMs: 300,
      workerId: 'w',
    });
    await runtime.start();

    await waitFor(() => processed.includes(jobId));
    expect(processed).toContain(jobId);
  });

  it('should process jobs from two conversations under concurrency 2', async () => {
    const { processed, processJob } = recorder();
    const a = await seedPendingJob();
    const b = await seedPendingJob();
    runtime = new WorkerRuntime({
      queue,
      sql,
      processJob,
      concurrency: 2,
      reconcilePollMs: 300,
      workerId: 'w',
    });
    await runtime.start();

    await waitFor(() => processed.includes(a) && processed.includes(b));
    expect(new Set(processed)).toEqual(new Set([a, b]));
  });

  it('should stop gracefully and process nothing afterwards', async () => {
    const { processed, processJob } = recorder();
    runtime = new WorkerRuntime({
      queue,
      sql,
      processJob,
      concurrency: 2,
      reconcilePollMs: 300,
      workerId: 'w',
    });
    await runtime.start();
    await runtime.stop();
    runtime = null;

    await seedPendingJob();
    await new Promise((r) => setTimeout(r, 500));
    expect(processed).toHaveLength(0);
  });
});

describe('WorkerRuntime LISTEN wake-up', () => {
  it('should pick up a job via notification well before the poll would', async () => {
    const { processed, processJob } = recorder();
    // Long poll so a fast pickup can only be the notification path.
    runtime = new WorkerRuntime({
      queue,
      sql,
      processJob,
      concurrency: 2,
      reconcilePollMs: 60_000,
      workerId: 'w',
    });
    await runtime.start();

    const jobId = await seedPendingJob();
    const startedAt = Date.now();
    await sql.notify('job_created', jobId);

    await waitFor(() => processed.includes(jobId), 2000);
    const elapsedMs = Date.now() - startedAt;
    expect(processed).toContain(jobId);
    // Notify-driven pickup: ~sub-100ms locally; the 60s poll cannot explain a
    // pickup this fast. Bounded loosely here to stay robust on shared CI.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('should be idempotent when start is called twice (no duplicate runners)', async () => {
    const { processed, processJob } = recorder();
    runtime = new WorkerRuntime({
      queue,
      sql,
      processJob,
      concurrency: 2,
      reconcilePollMs: 60_000,
      workerId: 'w',
    });
    await runtime.start();
    await runtime.start();

    const jobId = await seedPendingJob();
    await sql.notify('job_created', jobId);

    await waitFor(() => processed.length >= 1, 2000);
    await new Promise((r) => setTimeout(r, 200));
    expect(processed).toEqual([jobId]);
  });

  it('should process a single job once despite duplicate notifications', async () => {
    const { processed, processJob } = recorder();
    runtime = new WorkerRuntime({
      queue,
      sql,
      processJob,
      concurrency: 4,
      reconcilePollMs: 60_000,
      workerId: 'w',
    });
    await runtime.start();

    const jobId = await seedPendingJob();
    await sql.notify('job_created', jobId);
    await sql.notify('job_created', jobId);
    await sql.notify('job_created', jobId);

    await waitFor(() => processed.length >= 1, 2000);
    await new Promise((r) => setTimeout(r, 200));
    expect(processed).toEqual([jobId]);
  });
});
