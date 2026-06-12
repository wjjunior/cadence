import { loadDatabaseUrl } from '../config.js';
import { runMigrations } from './migrator.js';

try {
  await runMigrations(loadDatabaseUrl());
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`${String(error)}\n`);
}
