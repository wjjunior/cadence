import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const DEFAULT_POOL_MAX = 10;

export interface DbClient {
  sql: ReturnType<typeof postgres>;
  db: PostgresJsDatabase<typeof schema>;
}

export type Database = DbClient['db'];

// Single place the postgres.js driver is wired (CLAUDE.md: the driver enters as
// one adapter). Repositories, the worker's LISTEN connection and the migrator
// all build their client through here so connection options never drift.
export function createDbClient(databaseUrl: string, options: { max?: number } = {}): DbClient {
  const sql = postgres(databaseUrl, { max: options.max ?? DEFAULT_POOL_MAX });
  const db = drizzle(sql, { schema });
  return { sql, db };
}
