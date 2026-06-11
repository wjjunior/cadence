// Worker process entrypoint (composition root). The claim -> process loop,
// LISTEN wake-up, reconciliation poll and lease reaper are wired here in later
// waves (CAD-19/20/23). For now it is a no-op that starts and exits cleanly.
function main(): void {
  process.stdout.write(
    `${JSON.stringify({ service: 'worker', event: 'bootstrap.noop' })}\n`,
  );
}

main();
