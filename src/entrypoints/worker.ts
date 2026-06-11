import { randomUUID } from 'node:crypto';

import { ProcessJob } from '../application/process-job.js';
import { loadConfig } from '../infrastructure/config.js';
import { createDbClient } from '../infrastructure/db/client.js';
import { DrizzleUnitOfWork } from '../infrastructure/db/unit-of-work.js';
import { PgWorkerQueue } from '../infrastructure/job-queue/pg-worker-queue.js';
import { SimulatedReplyGenerator } from '../infrastructure/reply/simulated-reply-generator.js';
import { DrizzleConversationRepository } from '../infrastructure/repositories/conversation-repository.js';
import { DrizzleHeartbeatRepository } from '../infrastructure/repositories/heartbeat-repository.js';
import { DrizzleMessageRepository } from '../infrastructure/repositories/message-repository.js';
import { PgNotifier } from '../infrastructure/repositories/notifier.js';
import { createSmsProvider } from '../infrastructure/sms/create-sms-provider.js';
import { HeartbeatBeater } from '../infrastructure/worker/heartbeat-beater.js';
import { WorkerRuntime } from '../infrastructure/worker/worker-runtime.js';

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 5_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const { sql, db } = createDbClient(config.DATABASE_URL);
  const workerId = `worker-${randomUUID()}`;

  const conversations = new DrizzleConversationRepository(db);
  const messages = new DrizzleMessageRepository(db);
  const workerQueue = new PgWorkerQueue(sql, { leaseDurationMs: config.LEASE_DURATION_MS });

  const processJob = new ProcessJob(
    new DrizzleUnitOfWork(db),
    conversations,
    messages,
    workerQueue,
    new SimulatedReplyGenerator({
      minMs: config.REPLY_DELAY_MIN_MS,
      maxMs: config.REPLY_DELAY_MAX_MS,
    }),
    await createSmsProvider(config),
    new PgNotifier(),
    {
      backoffBaseMs: BACKOFF_BASE_MS,
      backoffCapMs: BACKOFF_CAP_MS,
      now: () => new Date(),
      random: Math.random,
    },
  );

  const runtime = new WorkerRuntime({
    queue: workerQueue,
    sql,
    processJob: (job) => processJob.execute(job),
    concurrency: config.WORKER_CONCURRENCY,
    reconcilePollMs: config.RECONCILE_POLL_MS,
    workerId,
  });
  const heartbeat = new HeartbeatBeater(
    new DrizzleHeartbeatRepository(db),
    workerId,
    HEARTBEAT_INTERVAL_MS,
  );

  await runtime.start();
  await heartbeat.start();
  process.stdout.write(
    `${JSON.stringify({ service: 'worker', event: 'started', workerId, concurrency: config.WORKER_CONCURRENCY })}\n`,
  );

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    heartbeat.stop();
    await runtime.stop();
    await sql.end();
    process.exit(0);
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => void shutdown());
  }
}

main().catch((error) => {
  process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
});
