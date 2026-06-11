import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { HealthResponse } from '../../src/application/contracts/health.js';
import { type DbClient, createDbClient } from '../../src/infrastructure/db/client.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import type { DrizzleHeartbeatRepository } from '../../src/infrastructure/repositories/heartbeat-repository.js';
import { buildTestApp } from './helpers/build-app.js';

let container: StartedPostgreSqlContainer;
let client: DbClient;
let sql: DbClient['sql'];
let app: FastifyInstance;
let heartbeats: DrizzleHeartbeatRepository;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  client = createDbClient(url, { max: 6 });
  sql = client.sql;
  ({ app, heartbeats } = buildTestApp(client));
  await app.ready();
});

afterAll(async () => {
  try {
    await app?.close();
    await sql?.end();
  } finally {
    await container?.stop();
  }
});

beforeEach(async () => {
  await sql`truncate conversations, messages, jobs, webhook_events, worker_heartbeats restart identity cascade`;
});

const getHealth = async (): Promise<HealthResponse> => {
  const res = await app.inject({ url: '/health' });
  expect(res.statusCode).toBe(200);
  return res.json<HealthResponse>();
};

let seq = 0;
async function seedPendingJob(ageSeconds: number): Promise<void> {
  const n = ++seq;
  const conv = await sql<{ id: string }[]>`
    insert into conversations (user_phone, system_phone)
    values (${`u-${n}`}, ${`s-${n}`}) returning id`;
  const msg = await sql<{ id: string }[]>`
    insert into messages (conversation_id, direction, body, status)
    values (${conv[0]!.id}, 'inbound', 'hi', 'received') returning id`;
  await sql`insert into jobs (inbound_message_id, conversation_id, status, created_at)
            values (${msg[0]!.id}, ${conv[0]!.id}, 'pending', now() - ${`${ageSeconds} seconds`}::interval)`;
}

describe('GET /health', () => {
  it('should report null heartbeat age and zero pending when nothing has happened', async () => {
    const health = await getHealth();
    expect(health.db).toBe('ok');
    expect(health.worker.heartbeatAgeMs).toBeNull();
    expect(health.queue.pending).toBe(0);
    expect(health.queue.oldestPendingAgeMs).toBeNull();
  });

  it('should report a fresh heartbeat age right after a beat', async () => {
    await heartbeats.beat('worker-1');
    const health = await getHealth();
    expect(health.worker.heartbeatAgeMs).not.toBeNull();
    expect(health.worker.heartbeatAgeMs!).toBeLessThan(60_000);
  });

  it('should report a stale heartbeat age once the worker stops beating', async () => {
    await heartbeats.beat('worker-1');
    await sql`update worker_heartbeats set last_beat_at = now() - interval '1 hour'`;
    const health = await getHealth();
    expect(health.worker.heartbeatAgeMs!).toBeGreaterThan(3_000_000);
  });

  it('should report queue depth and the oldest pending age', async () => {
    await seedPendingJob(120);
    await seedPendingJob(30);
    const health = await getHealth();
    expect(health.queue.pending).toBe(2);
    expect(health.queue.oldestPendingAgeMs!).toBeGreaterThanOrEqual(120_000 - 5_000);
  });
});
