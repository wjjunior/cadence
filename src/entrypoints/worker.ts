function main(): void {
  process.stdout.write(
    `${JSON.stringify({ service: 'worker', event: 'bootstrap.noop' })}\n`,
  );
}

main();
