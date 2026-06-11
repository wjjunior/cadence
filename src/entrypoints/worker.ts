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

const errMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL, service: 'worker' });
  const { sql, db } = createDbClient(config.DATABASE_URL);

  let metricsTimer: ReturnType<typeof setInterval> | undefined;
  let runtime: WorkerRuntime | undefined;
  // Frees every handle (timer, lease loops, db pool) so the process can exit —
  // shared by the signal path and the startup-failure path below.
  const teardown = async (): Promise<void> => {
    if (metricsTimer) clearInterval(metricsTimer);
    if (runtime) await runtime.stop().catch(() => {});
    await sql.end().catch(() => {});
  };

  try {
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

    runtime = new WorkerRuntime({
      queue,
      sql,
      processJob: (job) => processJob.execute(job),
      concurrency: config.WORKER_CONCURRENCY,
      reconcilePollMs: config.RECONCILE_POLL_MS,
      workerId: `${hostname()}-${process.pid}`,
      logger,
    });

    metricsTimer = setInterval(() => {
      void queue
        .stats()
        .then((stats) => logger.info({ event: 'queue_stats', ...stats }))
        .catch((error) => logger.error({ event: 'metrics_error', error: errMessage(error) }));
    }, config.METRICS_POLL_MS);

    let shuttingDown = false;
    const shutdown = (): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      void teardown();
    };
    // Registered before start() so a signal during startup still triggers a clean
    // shutdown (stop() on a not-yet-started runtime is a safe no-op).
    for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, shutdown);

    await runtime.start();
  } catch (error) {
    // Free the handles opened above so the failed process exits (and the
    // container restarts) instead of hanging on the metrics timer / db pool.
    await teardown();
    throw error;
  }
}

main().catch((error) => {
  process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
});
