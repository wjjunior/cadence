import { runMigrations } from './migrator.js';

// CLI entry: `pnpm db:migrate`. DATABASE_URL is read here, at the script's
// composition root, not scattered through the app (CLAUDE.md rule 11).
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations');
  }
  await runMigrations(databaseUrl);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  },
);
