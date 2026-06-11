import type { JobEnqueuer } from '../../application/ports/job-queue.js';
import type { Tx } from '../../application/ports/tx.js';
import type { NewJob } from '../../domain/job.js';
import { jobs } from '../db/schema.js';
import { asDrizzle } from '../db/tx.js';

export class DrizzleJobEnqueuer implements JobEnqueuer {
  async enqueueInTx(tx: Tx, job: NewJob): Promise<void> {
    await asDrizzle(tx)
      .insert(jobs)
      .values({ inboundMessageId: job.inboundMessageId, conversationId: job.conversationId })
      .onConflictDoNothing({ target: jobs.inboundMessageId });
  }
}
