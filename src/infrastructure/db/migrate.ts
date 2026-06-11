import { runMigrations } from './migrator.js';

// CLI entry: `pnpm db:migrate`. DATABASE_URL is read here, at the script's
// composition root, not scattered through the app (CLAUDE.md rule 11).
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run migrations');
}

try {
  await runMigrations(databaseUrl);
} catch (error) {
  // Set the code and let the process exit naturally so stderr flushes first.
  process.exitCode = 1;
  process.stderr.write(`${String(error)}\n`);
}
