import { loadConfig } from '../infrastructure/config.js';

function main(): void {
  const config = loadConfig();
  process.stdout.write(
    `${JSON.stringify({
      service: 'worker',
      event: 'startup',
      smsProvider: config.SMS_PROVIDER,
      concurrency: config.WORKER_CONCURRENCY,
    })}\n`,
  );
}

try {
  main();
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
}
