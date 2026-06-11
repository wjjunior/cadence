import type { HealthRepository, HealthSnapshot } from '../../application/ports/health-repository.js';
import type { DbClient } from '../db/client.js';

// numeric columns come back from postgres.js as strings, so coerce at the boundary.
interface SnapshotRow {
  heartbeat_age_ms: string | null;
  pending: number;
  oldest_pending_age_ms: string | null;
}

const toMs = (value: string | null): number | null => (value === null ? null : Number(value));

export class PgHealthRepository implements HealthRepository {
  constructor(private readonly sql: DbClient['sql']) {}

  async snapshot(): Promise<HealthSnapshot> {
    const rows = await this.sql<SnapshotRow[]>`
      SELECT
        (SELECT round(extract(epoch FROM now() - max(last_beat_at)) * 1000)
           FROM worker_heartbeats) AS heartbeat_age_ms,
        (SELECT count(*)::int FROM jobs WHERE status = 'pending') AS pending,
        (SELECT round(extract(epoch FROM now() - min(created_at)) * 1000)
           FROM jobs WHERE status = 'pending') AS oldest_pending_age_ms`;
    const row = rows[0];
    return {
      heartbeatAgeMs: toMs(row?.heartbeat_age_ms ?? null),
      pending: row?.pending ?? 0,
      oldestPendingAgeMs: toMs(row?.oldest_pending_age_ms ?? null),
    };
  }
}
