import { z } from 'zod';

export const IngestInboundCommand = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  body: z.string(),
  providerSid: z.string().min(1),
});

export type IngestInboundCommand = z.infer<typeof IngestInboundCommand>;
