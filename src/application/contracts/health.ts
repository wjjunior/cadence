import { z } from 'zod';

export const HealthResponse = z.object({
  db: z.literal('ok'),
  worker: z.object({ heartbeatAgeMs: z.number().nullable() }),
  queue: z.object({ pending: z.number(), oldestPendingAgeMs: z.number().nullable() }),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
