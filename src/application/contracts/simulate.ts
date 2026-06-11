import { z } from 'zod';

// The mock-mode demo form posts only the user's number and the message body; the
// system number and a provider SID are synthesized by the route.
export const SimulateInbound = z.object({
  from: z.string().min(1),
  body: z.string(),
});

export type SimulateInbound = z.infer<typeof SimulateInbound>;
