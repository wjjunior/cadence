import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProcessJob, ProcessJobError } from '../../src/application/process-job.js';
import type { ReplyGenerator } from '../../src/application/ports/reply-generator.js';
import { conversationKey } from '../../src/domain/conversation.js';
import type { Job } from '../../src/domain/job.js';
import { type DbClient, createDbClient } from '../../src/infrastructure/db/client.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { DrizzleUnitOfWork } from '../../src/infrastructure/db/unit-of-work.js';
import { PgWorkerQueue } from '../../src/infrastructure/job-queue/pg-worker-queue.js';
import { SimulatedReplyGenerator } from '../../src/infrastructure/reply/simulated-reply-generator.js';
import { DrizzleConversationRepository } from '../../src/infrastructure/repositories/conversation-repository.js';
import { DrizzleJobEnqueuer } from '../../src/infrastructure/repositories/job-enqueuer.js';
import { DrizzleMessageRepository } from '../../src/infrastructure/repositories/message-repository.js';
import { PgNotifier } from '../../src/infrastructure/repositories/notifier.js';
import { MockSmsProvider } from '../../src/infrastructure/sms/mock-sms-provider.js';

let container: StartedPostgreSqlContainer;
let client: DbClient;
let uow: DrizzleUnitOfWork;
let conversations: DrizzleConversationRepository;
let messages: DrizzleMessageRepository;
let enqueuer: DrizzleJobEnqueuer;
let workerQueue: PgWorkerQueue;
let notifier: PgNotifier;
let sms: MockSmsProvider;
let seq = 0;

const FIXED_NOW = new Date('2026-06-11T00:00:00.000Z');
const settings = {
  backoffBaseMs: 1_000,
  backoffCapMs: 60_000,
  now: () => FIXED_NOW,
  random: () => 0,
};

function makeProcessJob(replyGenerator: ReplyGenerator): ProcessJob {
  return new ProcessJob(
    uow,
    conversations,
    messages,
    workerQueue,
    replyGenerator,
    sms,
    notifier,
    settings,
  );
}

const fastGenerator = new SimulatedReplyGenerator({ minMs: 0, maxMs: 0 });

async function seedClaimedJob(): Promise<Job> {
  const n = ++seq;
  const job = await uow.run(async (tx) => {
    const conversation = await conversations.upsert(
      tx,
      conversationKey(`+1555${String(n).padStart(7, '0')}`, `+1999${String(n).padStart(7, '0')}`),
    );
    const message = await messages.insertInbound(tx, {
      conversationId: conversation.id,
      body: 'hi',
      providerMessageSid: `SM-${n}`,
    });
    await enqueuer.enqueueInTx(tx, {
      inboundMessageId: message.id,
      conversationId: conversation.id,
    });
    return { conversationId: conversation.id, inboundMessageId: message.id };
  });
  const claimed = await workerQueue.claim('worker-test');
  if (!claimed || claimed.inboundMessageId !== job.inboundMessageId) {
    throw new Error('failed to claim the seeded job');
  }
  return claimed;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  client = createDbClient(url, { max: 5 });
  uow = new DrizzleUnitOfWork(client.db);
  conversations = new DrizzleConversationRepository(client.db);
  messages = new DrizzleMessageRepository(client.db);
  enqueuer = new DrizzleJobEnqueuer();
  workerQueue = new PgWorkerQueue(client.sql, { leaseDurationMs: 60_000 });
  notifier = new PgNotifier();
  sms = new MockSmsProvider({ recordSends: true });
});

afterAll(async () => {
  try {
    await client?.sql?.end();
  } finally {
    await container?.stop();
  }
});

beforeEach(async () => {
  sms.reset();
  await client.sql`truncate conversations, messages, jobs, webhook_events restart identity cascade`;
});

async function messageStatus(id: string): Promise<string> {
  const rows = await client.sql<{ status: string }[]>`select status from messages where id = ${id}`;
  return rows[0]?.status ?? 'missing';
}

async function jobRow(id: string): Promise<{ status: string; nextRunAt: Date; lastError: string | null }> {
  const rows = await client.sql<{ status: string; next_run_at: string; last_error: string | null }[]>`
    select status, next_run_at, last_error from jobs where id = ${id}`;
  const row = rows[0];
  if (!row) throw new Error('job not found');
  return { status: row.status, nextRunAt: new Date(row.next_run_at), lastError: row.last_error };
}

describe('ProcessJob', () => {
  it('should process the happy path to a sent reply and a completed job', async () => {
    const job = await seedClaimedJob();
    await makeProcessJob(fastGenerator).execute(job);

    expect(await messageStatus(job.inboundMessageId)).toBe('processed');
    expect((await jobRow(job.id)).status).toBe('completed');
    expect(sms.sentMessages).toHaveLength(1);
    const outbound = await client.sql<{ status: string }[]>`
      select status from messages where direction = 'outbound' and in_reply_to = ${job.inboundMessageId}`;
    expect(outbound).toHaveLength(1);
    expect(outbound[0]?.status).toBe('sent');
  });

  it('should reject with ProcessJobError when the job has no lease owner', async () => {
    const job = await seedClaimedJob();
    await expect(
      makeProcessJob(fastGenerator).execute({ ...job, lockedBy: null }),
    ).rejects.toBeInstanceOf(ProcessJobError);
  });

  it('should reschedule with backoff on a send failure without duplicating the outbound', async () => {
    sms.failNextSends(1);
    const job = await seedClaimedJob();
    await makeProcessJob(fastGenerator).execute(job);

    const afterFail = await jobRow(job.id);
    expect(afterFail.status).toBe('pending');
    expect(afterFail.nextRunAt.getTime()).toBe(FIXED_NOW.getTime() + 2_000); // base*2^attempt(1), random 0
    expect(await messageStatus(job.inboundMessageId)).toBe('processing');
    expect(sms.sentMessages).toHaveLength(0);

    sms.reset();
    await client.sql`update jobs set next_run_at = now() where id = ${job.id}`;
    const reclaimed = await workerQueue.claim('worker-test');
    if (!reclaimed) throw new Error('expected to re-claim');
    await makeProcessJob(fastGenerator).execute(reclaimed);

    expect((await jobRow(job.id)).status).toBe('completed');
    expect(sms.sentMessages).toHaveLength(1);
    const outbound = await client.sql<{ count: number }[]>`
      select count(*)::int as count from messages where direction = 'outbound' and in_reply_to = ${job.inboundMessageId}`;
    expect(outbound[0]?.count).toBe(1);
  });

  it('should mark job, inbound and outbound failed when attempts are exhausted', async () => {
    sms.failAlways();
    const seeded = await seedClaimedJob();
    await client.sql`update jobs set attempts = max_attempts where id = ${seeded.id}`;
    const job = { ...seeded, attempts: seeded.maxAttempts };

    await makeProcessJob(fastGenerator).execute(job);

    const failed = await jobRow(job.id);
    expect(failed.status).toBe('failed');
    expect(failed.lastError).toBeTruthy();
    expect(await messageStatus(job.inboundMessageId)).toBe('failed');
    const outbound = await client.sql<{ status: string }[]>`
      select status from messages where direction = 'outbound' and in_reply_to = ${job.inboundMessageId}`;
    expect(outbound[0]?.status).toBe('failed');
  });

  it('should not commit a sent reply when the lease was lost before the terminal commit', async () => {
    const job = await seedClaimedJob();
    await client.sql`update jobs set locked_by = 'w2' where id = ${job.id}`;

    await makeProcessJob(fastGenerator).execute(job);

    expect(await messageStatus(job.inboundMessageId)).toBe('processing');
    const outbound = await client.sql<{ status: string }[]>`
      select status from messages where direction = 'outbound' and in_reply_to = ${job.inboundMessageId}`;
    expect(outbound[0]?.status).toBe('queued');
    expect((await jobRow(job.id)).status).toBe('running');
  });

  it('should not mark messages failed when the lease was lost before a terminal failure', async () => {
    sms.failAlways();
    const seeded = await seedClaimedJob();
    await client.sql`update jobs set attempts = max_attempts, locked_by = 'w2' where id = ${seeded.id}`;
    const job = { ...seeded, attempts: seeded.maxAttempts };

    await makeProcessJob(fastGenerator).execute(job);

    expect(await messageStatus(job.inboundMessageId)).toBe('processing');
    const outbound = await client.sql<{ status: string }[]>`
      select status from messages where direction = 'outbound' and in_reply_to = ${job.inboundMessageId}`;
    expect(outbound[0]?.status).toBe('queued');
    expect((await jobRow(job.id)).status).toBe('running');
  });

  it('should fail a prior-attempt outbound when the terminal attempt throws before recreating it', async () => {
    const seeded = await seedClaimedJob();
    await uow.run((tx) =>
      messages.insertOutbound(tx, {
        conversationId: seeded.conversationId,
        body: 'prior reply',
        idempotencyKey: `reply:${seeded.inboundMessageId}`,
        inReplyTo: seeded.inboundMessageId,
        providerMessageSid: null,
      }),
    );
    await client.sql`update jobs set attempts = max_attempts where id = ${seeded.id}`;
    const job = { ...seeded, attempts: seeded.maxAttempts };
    const throwingGenerator: ReplyGenerator = {
      generate: () => Promise.reject(new Error('generator boom')),
    };

    await makeProcessJob(throwingGenerator).execute(job);

    expect((await jobRow(job.id)).status).toBe('failed');
    expect(await messageStatus(job.inboundMessageId)).toBe('failed');
    const outbound = await client.sql<{ status: string }[]>`
      select status from messages where direction = 'outbound' and in_reply_to = ${seeded.inboundMessageId}`;
    expect(outbound[0]?.status).toBe('failed');
  });
});
