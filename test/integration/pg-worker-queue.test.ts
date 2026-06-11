import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type DbClient, createDbClient } from '../../src/infrastructure/db/client.js';
import { asTx } from '../../src/infrastructure/db/tx.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { PgWorkerQueue } from '../../src/infrastructure/job-queue/pg-worker-queue.js';

const LEASE_MS = 60_000;

let container: StartedPostgreSqlContainer;
let client: DbClient;
let sql: DbClient['sql'];
let queue: PgWorkerQueue;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  client = createDbClient(url, { max: 8 });
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

let seq = 0;
const uniq = (): string => `${Date.now()}-${++seq}`;

async function seedConversation(): Promise<string> {
  const n = uniq();
  const [row] = await sql<{ id: string }[]>`
    insert into conversations (user_phone, system_phone)
    values (${`u-${n}`}, ${`s-${n}`}) returning id`;
  if (!row) throw new Error('no conversation');
  return row.id;
}

async function seedInbound(conversationId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into messages (conversation_id, direction, body, status)
    values (${conversationId}, 'inbound', 'hi', 'received') returning id`;
  if (!row) throw new Error('no message');
  return row.id;
}

interface SeedJob {
  conversationId?: string;
  status?: string;
  createdAt?: string;
  nextRunAt?: string;
}

async function seedJob(opts: SeedJob = {}): Promise<string> {
  const conversationId = opts.conversationId ?? (await seedConversation());
  const inboundId = await seedInbound(conversationId);
  const createdAt = opts.createdAt ? sql.unsafe(opts.createdAt) : sql`now()`;
  const nextRunAt = opts.nextRunAt ? sql.unsafe(opts.nextRunAt) : sql`now()`;
  const [row] = await sql<{ id: string }[]>`
    insert into jobs (inbound_message_id, conversation_id, status, created_at, next_run_at)
    values (${inboundId}, ${conversationId}, ${opts.status ?? 'pending'}, ${createdAt}, ${nextRunAt})
    returning id`;
  if (!row) throw new Error('no job');
  return row.id;
}

describe('PgWorkerQueue.claim', () => {
  it('should claim the ready job and set running, lease and attempts=1', async () => {
    const jobId = await seedJob();

    const claimed = await queue.claim('w1');

    expect(claimed?.id).toBe(jobId);
    expect(claimed?.status).toBe('running');
    expect(claimed?.lockedBy).toBe('w1');
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.leaseExpiresAt).toBeInstanceOf(Date);
  });

  it('should return null when no job is ready', async () => {
    await seedJob({ nextRunAt: "now() + interval '1 hour'" });
    expect(await queue.claim('w1')).toBeNull();
  });

  it('should not claim a job while an older non-terminal sibling exists', async () => {
    const conversationId = await seedConversation();
    const older = await seedJob({ conversationId, createdAt: "now() - interval '2 seconds'" });
    await seedJob({ conversationId, createdAt: "now() - interval '1 second'" });

    const first = await queue.claim('w1');
    expect(first?.id).toBe(older);

    expect(await queue.claim('w2')).toBeNull();
  });

  it('should claim jobs from distinct conversations in parallel', async () => {
    await seedJob();
    await seedJob();

    const [a, b] = await Promise.all([queue.claim('w1'), queue.claim('w2')]);
    expect(a?.id).toBeDefined();
    expect(b?.id).toBeDefined();
    expect(a?.id).not.toBe(b?.id);
  });

  it('should never claim the same row twice under concurrent workers', async () => {
    for (let i = 0; i < 10; i++) await seedJob();

    const drain = async (): Promise<string[]> => {
      const ids: string[] = [];
      for (;;) {
        const job = await queue.claim('w');
        if (!job) return ids;
        ids.push(job.id);
      }
    };
    const claimed = (await Promise.all([drain(), drain(), drain(), drain()])).flat();

    expect(claimed).toHaveLength(10);
    expect(new Set(claimed).size).toBe(10);
  });
});

describe('PgWorkerQueue.complete', () => {
  it('should move the job to completed within the caller tx', async () => {
    const jobId = await seedJob();
    await queue.claim('w1');

    await client.db.transaction(async (txDb) => {
      await queue.complete(asTx(txDb), jobId);
    });

    const [row] = await sql<{ status: string }[]>`select status from jobs where id = ${jobId}`;
    expect(row?.status).toBe('completed');
  });
});

describe('PgWorkerQueue.fail', () => {
  it('should reschedule to pending with next_run_at when retryAt is a date', async () => {
    const jobId = await seedJob();
    await queue.claim('w1');
    const retryAt = new Date(Date.now() + 30_000);

    await client.db.transaction(async (txDb) => {
      await queue.fail(asTx(txDb), jobId, 'boom', retryAt);
    });

    const [row] = await sql<{ status: string; next_run_at: string | Date; last_error: string }[]>`
      select status, next_run_at, last_error from jobs where id = ${jobId}`;
    expect(row?.status).toBe('pending');
    expect(row?.last_error).toBe('boom');
    expect(new Date(row!.next_run_at).getTime()).toBeCloseTo(retryAt.getTime(), -3);
  });

  it('should mark failed with last_error when retryAt is null', async () => {
    const jobId = await seedJob();
    await queue.claim('w1');

    await client.db.transaction(async (txDb) => {
      await queue.fail(asTx(txDb), jobId, 'poison', null);
    });

    const [row] = await sql<{ status: string; last_error: string }[]>`
      select status, last_error from jobs where id = ${jobId}`;
    expect(row?.status).toBe('failed');
    expect(row?.last_error).toBe('poison');
  });

  it('should unblock the younger sibling once the older job reaches a terminal state', async () => {
    const conversationId = await seedConversation();
    await seedJob({ conversationId, createdAt: "now() - interval '2 seconds'" });
    const younger = await seedJob({ conversationId, createdAt: "now() - interval '1 second'" });

    const older = await queue.claim('w1');
    expect(await queue.claim('w2')).toBeNull();

    await client.db.transaction(async (txDb) => {
      await queue.fail(asTx(txDb), older!.id, 'poison', null);
    });

    expect((await queue.claim('w3'))?.id).toBe(younger);
  });
});

describe('PgWorkerQueue.reapExpiredLeases', () => {
  it('should return an expired running job to pending and clear its lock/lease', async () => {
    const jobId = await seedJob({ status: 'running' });
    await sql`update jobs set locked_by = 'dead', lease_expires_at = now() - interval '1 second' where id = ${jobId}`;

    const reaped = await queue.reapExpiredLeases();

    expect(reaped).toBe(1);
    const [row] = await sql<
      { status: string; locked_by: string | null; lease_expires_at: string | Date | null }[]
    >`select status, locked_by, lease_expires_at from jobs where id = ${jobId}`;
    expect(row?.status).toBe('pending');
    expect(row?.locked_by).toBeNull();
    expect(row?.lease_expires_at).toBeNull();
  });

  it('should leave a running job with a fresh lease untouched', async () => {
    const jobId = await seedJob({ status: 'running' });
    await sql`update jobs set lease_expires_at = now() + interval '1 minute' where id = ${jobId}`;

    expect(await queue.reapExpiredLeases()).toBe(0);
    const [row] = await sql<{ status: string }[]>`select status from jobs where id = ${jobId}`;
    expect(row?.status).toBe('running');
  });
});
