import { defineConfig } from 'vitest/config';

// Integration tests spin a throwaway Postgres via Testcontainers, so they get
// generous startup timeouts and run isolated from the fast `pnpm test` suite.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
