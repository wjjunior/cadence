import { hostname } from 'node:os';

import { ProcessJob } from '../application/process-job.js';
import { loadConfig } from '../infrastructure/config.js';
import { createDbClient } from '../infrastructure/db/client.js';
import { DrizzleUnitOfWork } from '../infrastructure/db/unit-of-work.js';
import { PgWorkerQueue } from '../infrastructure/job-queue/pg-worker-queue.js';
import { createLogger } from '../infrastructure/logging/logger.js';
import { SimulatedReplyGenerator } from '../infrastructure/reply/simulated-reply-generator.js';
import { DrizzleConversationRepository } from '../infrastructure/repositories/conversation-repository.js';
import { DrizzleMessageRepository } from '../infrastructure/repositories/message-repository.js';
import { PgNotifier } from '../infrastructure/repositories/notifier.js';
import { createSmsProvider } from '../infrastructure/sms/create-sms-provider.js';
import { WorkerRuntime } from '../infrastructure/worker/worker-runtime.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL, service: 'worker' });
  const { sql, db } = createDbClient(config.DATABASE_URL);

  const conversations = new DrizzleConversationRepository(db);
  const messages = new DrizzleMessageRepository(db);
  const queue = new PgWorkerQueue(sql, { leaseDurationMs: config.LEASE_DURATION_MS });
  const replyGenerator = new SimulatedReplyGenerator({
    minMs: config.REPLY_DELAY_MIN_MS,
    maxMs: config.REPLY_DELAY_MAX_MS,
  });
  const smsProvider = await createSmsProvider(config);

  const processJob = new ProcessJob(
    new DrizzleUnitOfWork(db),
    conversations,
    messages,
    queue,
    replyGenerator,
    smsProvider,
    new PgNotifier(),
    {
      backoffBaseMs: config.BACKOFF_BASE_MS,
      backoffCapMs: config.BACKOFF_CAP_MS,
      now: () => new Date(),
      random: Math.random,
    },
    logger,
  );

  const runtime = new WorkerRuntime({
    queue,
    sql,
    processJob: (job) => processJob.execute(job),
    concurrency: config.WORKER_CONCURRENCY,
    reconcilePollMs: config.RECONCILE_POLL_MS,
    workerId: `${hostname()}-${process.pid}`,
    logger,
  });

  const metricsTimer = setInterval(() => {
    void queue
      .stats()
      .then((stats) => logger.info({ event: 'queue_stats', ...stats }))
      .catch((error) =>
        logger.error({ event: 'metrics_error', error: error instanceof Error ? error.message : String(error) }),
      );
  }, config.METRICS_POLL_MS);

  await runtime.start();

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(metricsTimer);
    void runtime
      .stop()
      .finally(() => sql.end())
      .catch(() => {});
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, shutdown);
}

main().catch((error) => {
  process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
});
