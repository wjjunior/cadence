function main(): void {
  process.stdout.write(
    `${JSON.stringify({ service: 'api', event: 'bootstrap.noop' })}\n`,
  );
}

main();
