import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ReplyGenerator } from '../../src/application/ports/reply-generator.js';
import { ProcessJob } from '../../src/application/process-job.js';
import { conversationKey } from '../../src/domain/conversation.js';
import { type DbClient, createDbClient } from '../../src/infrastructure/db/client.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { DrizzleUnitOfWork } from '../../src/infrastructure/db/unit-of-work.js';
import { PgWorkerQueue } from '../../src/infrastructure/job-queue/pg-worker-queue.js';
import { SimulatedReplyGenerator } from '../../src/infrastructure/reply/simulated-reply-generator.js';
import { DrizzleConversationRepository } from '../../src/infrastructure/repositories/conversation-repository.js';
import { DrizzleMessageRepository } from '../../src/infrastructure/repositories/message-repository.js';
import { PgNotifier } from '../../src/infrastructure/repositories/notifier.js';
import { MockSmsProvider } from '../../src/infrastructure/sms/mock-sms-provider.js';

let container: StartedPostgreSqlContainer;
let client: DbClient;
let sql: DbClient['sql'];
let uow: DrizzleUnitOfWork;
let conversations: DrizzleConversationRepository;
let messages: DrizzleMessageRepository;
let workerQueue: PgWorkerQueue;
let notifier: PgNotifier;
let sms: MockSmsProvider;
let seq = 0;

const settings = {
  backoffBaseMs: 1_000,
  backoffCapMs: 60_000,
  // Real clock so a backoff reschedules next_run_at into the actual future — a
  // job in backoff must be genuinely unclaimable, which the FIFO tests rely on.
  now: () => new Date(),
  random: () => 0,
};

const fastGenerator = new SimulatedReplyGenerator({ minMs: 0, maxMs: 0 });
const delayGenerator = (ms: number): ReplyGenerator => new SimulatedReplyGenerator({ minMs: ms, maxMs: ms });
const recordingGenerator = (order: string[]): ReplyGenerator => ({
  generate: (ctx) => {
    order.push(ctx.inboundBody);
    return Promise.resolve({ body: `reply to ${ctx.inboundBody}` });
  },
});

function makeProcessJob(generator: ReplyGenerator): ProcessJob {
  return new ProcessJob(uow, conversations, messages, workerQueue, generator, sms, notifier, settings);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const pad = (n: number): string => String(n).padStart(7, '0');

// A true barrier: poll until the specific backend (by pid) is genuinely waiting on
// a lock, so the write-skew test commits the first transaction only once the second
// is blocked — no timing guess, and scoped to our connection so an unrelated
// lock-waiter can never release it early.
async function waitUntilLockWaiting(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const rows = await sql<{ pid: number }[]>`
      select pid from pg_stat_activity
      where pid = ${pid} and wait_event_type = 'Lock' and state = 'active'`;
    if (rows.length > 0) return;
    await sleep(10);
  }
  throw new Error('the competing transaction never reached the lock-waiting state');
}

async function newConversation(): Promise<string> {
  const n = ++seq;
  const conversation = await uow.run((tx) =>
    conversations.upsert(tx, conversationKey(`+1555${pad(n)}`, `+1999${pad(n)}`)),
  );
  return conversation.id;
}

interface SeedJob {
  conversationId?: string;
  body?: string;
  createdAt?: string;
}

async function seedJob(opts: SeedJob = {}): Promise<{ jobId: string; inboundMessageId: string; conversationId: string }> {
  const conversationId = opts.conversationId ?? (await newConversation());
  const n = ++seq;
  const inbound = await sql<{ id: string }[]>`
    insert into messages (conversation_id, direction, body, status, provider_message_sid)
    values (${conversationId}, 'inbound', ${opts.body ?? 'hi'}, 'received', ${`SM-${n}`})
    returning id`;
  const inboundMessageId = inbound[0]!.id;
  const createdAt = opts.createdAt ? sql.unsafe(opts.createdAt) : sql`now()`;
  const job = await sql<{ id: string }[]>`
    insert into jobs (inbound_message_id, conversation_id, status, created_at)
    values (${inboundMessageId}, ${conversationId}, 'pending', ${createdAt})
    returning id`;
  return { jobId: job[0]!.id, inboundMessageId, conversationId };
}

async function drain(workerId: string, processJob: ProcessJob): Promise<void> {
  for (;;) {
    const job = await workerQueue.claim(workerId);
    if (!job) return;
    await processJob.execute(job);
  }
}

async function jobStatus(id: string): Promise<string> {
  const rows = await sql<{ status: string }[]>`select status from jobs where id = ${id}`;
  return rows[0]?.status ?? 'missing';
}

async function messageStatus(id: string): Promise<string> {
  const rows = await sql<{ status: string }[]>`select status from messages where id = ${id}`;
  return rows[0]?.status ?? 'missing';
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  client = createDbClient(url, { max: 12 });
  sql = client.sql;
  uow = new DrizzleUnitOfWork(client.db);
  conversations = new DrizzleConversationRepository(client.db);
  messages = new DrizzleMessageRepository(client.db);
  workerQueue = new PgWorkerQueue(client.sql, { leaseDurationMs: 60_000 });
  notifier = new PgNotifier();
  sms = new MockSmsProvider({ recordSends: true });
});

afterAll(async () => {
  try {
    await sql?.end();
  } finally {
    await container?.stop();
  }
});

beforeEach(async () => {
  sms.reset();
  await sql`truncate conversations, messages, jobs, webhook_events restart identity cascade`;
});

// Retry-without-duplicate-send is proven at the single-job level in process-job.test.ts
// (CAD-23); this suite owns the concurrency/storage invariants.
describe('worker invariants', () => {
  it('should reject a second concurrent running job of the same conversation (write-skew, deterministic)', async () => {
    const conversationId = await newConversation();
    const j1 = await seedJob({ conversationId, createdAt: "now() - interval '2 seconds'" });
    const j2 = await seedJob({ conversationId, createdAt: "now() - interval '1 second'" });

    const c1 = await sql.reserve();
    const c2 = await sql.reserve();
    let c1Committed = false;
    try {
      await c1`begin`;
      await c1`update jobs set status = 'running', locked_by = 'w1', lease_expires_at = now() + interval '60 seconds' where id = ${j1.jobId}`;

      await c2`begin`;
      // Captured before the blocking update so the barrier can target this backend.
      const c2Pid = (await c2<{ pid: number }[]>`select pg_backend_pid() as pid`)[0]!.pid;
      // Blocks on the one_running_per_conversation unique index until c1 resolves.
      const c2Attempt = c2`update jobs set status = 'running', locked_by = 'w2', lease_expires_at = now() + interval '60 seconds' where id = ${j2.jobId}`
        .then(() => null as { code?: string; constraint_name?: string } | null)
        .catch((error: { code?: string; constraint_name?: string }) => error);

      await waitUntilLockWaiting(c2Pid); // release the barrier only once c2 is truly blocked
      await c1`commit`;
      c1Committed = true;

      const error = await c2Attempt;
      expect(error?.code).toBe('23505');
      expect(error?.constraint_name).toBe('one_running_per_conversation');
    } finally {
      await c2`rollback`.catch(() => undefined);
      if (!c1Committed) await c1`rollback`.catch(() => undefined);
      c1.release();
      c2.release();
    }

    // Only J1 ended up running; J2 is untouched.
    expect(await jobStatus(j1.jobId)).toBe('running');
    expect(await jobStatus(j2.jobId)).toBe('pending');
  });

  it('should never claim a job twice under 4 concurrent workers draining 50 jobs', async () => {
    for (let i = 0; i < 50; i++) await seedJob();

    await Promise.all(
      ['w1', 'w2', 'w3', 'w4'].map((w) => drain(w, makeProcessJob(fastGenerator))),
    );

    const rows = await sql<{ status: string; attempts: number }[]>`select status, attempts from jobs`;
    expect(rows).toHaveLength(50);
    expect(rows.every((r) => r.status === 'completed')).toBe(true);
    // attempts === 1 everywhere means each job was claimed exactly once.
    expect(rows.every((r) => r.attempts === 1)).toBe(true);
    expect(sms.sentMessages).toHaveLength(50);
  });

  it('should process same-conversation jobs in acceptance order under concurrent workers', async () => {
    const conversationId = await newConversation();
    for (let i = 1; i <= 5; i++) {
      await seedJob({ conversationId, body: String(i), createdAt: `now() - interval '${6 - i} seconds'` });
    }

    const order: string[] = [];
    const pj = makeProcessJob(recordingGenerator(order));
    let stop = false;
    const loop = async (workerId: string): Promise<void> => {
      while (!stop) {
        const job = await workerQueue.claim(workerId);
        if (!job) {
          await sleep(3);
          continue;
        }
        await pj.execute(job);
      }
    };
    const workers = ['w1', 'w2', 'w3'].map(loop);
    const startedAt = Date.now();
    while (order.length < 5 && Date.now() - startedAt < 5_000) await sleep(5);
    stop = true;
    await Promise.all(workers);

    expect(order).toEqual(['1', '2', '3', '4', '5']);
  });

  it('should block a younger sibling during backoff and release it on the older job terminal failure', async () => {
    const conversationId = await newConversation();
    const j1 = await seedJob({ conversationId, body: 'older', createdAt: "now() - interval '2 seconds'" });
    const j2 = await seedJob({ conversationId, body: 'younger', createdAt: "now() - interval '1 second'" });
    sms.failAlways();

    const claimed1 = await workerQueue.claim('w1');
    expect(claimed1?.id).toBe(j1.jobId);
    await makeProcessJob(fastGenerator).execute(claimed1!);
    expect(await jobStatus(j1.jobId)).toBe('pending'); // backed off, non-terminal

    // J2 stays blocked while its older sibling is non-terminal.
    expect(await workerQueue.claim('w2')).toBeNull();

    // Drive J1 to terminal failed.
    for (let i = 0; i < 5 && (await jobStatus(j1.jobId)) !== 'failed'; i++) {
      await sql`update jobs set next_run_at = now() where id = ${j1.jobId} and status = 'pending'`;
      const again = await workerQueue.claim('w1');
      if (!again) break;
      await makeProcessJob(fastGenerator).execute(again);
    }
    expect(await jobStatus(j1.jobId)).toBe('failed');

    // The conversation is unblocked: J2 now processes.
    sms.reset();
    const claimed2 = await workerQueue.claim('w2');
    expect(claimed2?.id).toBe(j2.jobId);
    await makeProcessJob(fastGenerator).execute(claimed2!);
    expect(await jobStatus(j2.jobId)).toBe('completed');
  });

  it('should process jobs from different conversations in parallel (wall-clock)', async () => {
    await seedJob({ body: 'a' });
    await seedJob({ body: 'b' });

    const pj = makeProcessJob(delayGenerator(400));
    const startedAt = Date.now();
    await Promise.all([drain('w1', pj), drain('w2', pj)]);
    const elapsedMs = Date.now() - startedAt;

    expect(sms.sentMessages).toHaveLength(2);
    // Two ~400ms jobs in parallel finish in ~400ms, not ~800ms.
    expect(elapsedMs).toBeLessThan(700);
  });

  it('should reclaim a lease-expired job and deliver exactly one reply', async () => {
    const seeded = await seedJob();
    await workerQueue.claim('wA'); // wA claims, then "crashes" without completing

    await sql`update jobs set lease_expires_at = now() - interval '1 second' where id = ${seeded.jobId}`;
    expect(await workerQueue.reapExpiredLeases()).toBe(1);

    const jobB = await workerQueue.claim('wB');
    expect(jobB?.id).toBe(seeded.jobId);
    await makeProcessJob(fastGenerator).execute(jobB!);

    expect(await jobStatus(seeded.jobId)).toBe('completed');
    expect(await messageStatus(seeded.inboundMessageId)).toBe('processed');
    expect(sms.sentMessages).toHaveLength(1);
    const outbound = await sql<{ count: number }[]>`
      select count(*)::int as count from messages where direction = 'outbound' and in_reply_to = ${seeded.inboundMessageId}`;
    expect(outbound[0]?.count).toBe(1);
  });

  it('should land a poison job terminal failed and immediately unblock the conversation', async () => {
    const conversationId = await newConversation();
    const j1 = await seedJob({ conversationId, body: 'poison', createdAt: "now() - interval '2 seconds'" });
    const j2 = await seedJob({ conversationId, body: 'next', createdAt: "now() - interval '1 second'" });
    sms.failAlways();

    const claimed1 = await workerQueue.claim('w1');
    expect(claimed1?.id).toBe(j1.jobId);
    // While J1 is running, the younger sibling is blocked.
    expect(await workerQueue.claim('w2')).toBeNull();

    await sql`update jobs set attempts = max_attempts where id = ${j1.jobId}`;
    await makeProcessJob(fastGenerator).execute({ ...claimed1!, attempts: claimed1!.maxAttempts });
    expect(await jobStatus(j1.jobId)).toBe('failed');
    expect(await messageStatus(j1.inboundMessageId)).toBe('failed');

    // The conversation unblocks immediately: J2 is claimable and succeeds.
    sms.reset();
    const claimed2 = await workerQueue.claim('w2');
    expect(claimed2?.id).toBe(j2.jobId);
    await makeProcessJob(fastGenerator).execute(claimed2!);
    expect(await jobStatus(j2.jobId)).toBe('completed');
  });
});
