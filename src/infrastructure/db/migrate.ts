import { loadDatabaseUrl } from '../config.js';
import { runMigrations } from './migrator.js';

// CLI entry: `pnpm db:migrate`. The database URL is resolved through the config
// module so process.env stays confined to one place (CLAUDE.md rule 11).
try {
  await runMigrations(loadDatabaseUrl());
} catch (error) {
  // Set the code and let the process exit naturally so stderr flushes first.
  process.exitCode = 1;
  process.stderr.write(`${String(error)}\n`);
}
