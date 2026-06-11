import { sql } from 'drizzle-orm';

import type { HeartbeatRepository } from '../../application/ports/heartbeat-repository.js';
import type { Database } from '../db/client.js';
import { workerHeartbeats } from '../db/schema.js';

export class DrizzleHeartbeatRepository implements HeartbeatRepository {
  constructor(private readonly db: Database) {}

  async beat(workerId: string): Promise<void> {
    await this.db
      .insert(workerHeartbeats)
      .values({ workerId, lastBeatAt: sql`now()` })
      .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: { lastBeatAt: sql`now()` } });
  }
}
