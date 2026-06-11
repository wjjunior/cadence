// API process entrypoint (composition root). The Fastify server — webhook
// ingestion, admin REST and the SSE stream — is wired here in later waves
// (CAD-16/17, CAD-25/26/27). For now it is a no-op that starts and exits cleanly.
function main(): void {
  process.stdout.write(
    `${JSON.stringify({ service: 'api', event: 'bootstrap.noop' })}\n`,
  );
}

main();
