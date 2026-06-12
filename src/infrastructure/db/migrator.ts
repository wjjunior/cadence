import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDbClient } from './client.js';

// Resolved relative to this module, not process.cwd(), so migrations are found regardless of launch dir.
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle', import.meta.url));

export async function runMigrations(databaseUrl: string): Promise<void> {
  const { sql, db } = createDbClient(databaseUrl, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await sql.end();
  }
}
