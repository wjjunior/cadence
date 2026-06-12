import { z } from 'zod';

export const SimulateInbound = z.object({
  from: z.string().min(1),
  body: z.string(),
});

export type SimulateInbound = z.infer<typeof SimulateInbound>;
