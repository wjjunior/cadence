import { z } from 'zod';

import type { IngestInboundCommand } from './ingest-command.js';

export const TwilioInboundWebhook = z
  .object({
    From: z.string().min(1),
    To: z.string().min(1),
    Body: z.string().default(''),
    MessageSid: z.string().min(1),
  })
  .transform(
    (w): IngestInboundCommand => ({
      from: w.From,
      to: w.To,
      body: w.Body,
      providerSid: w.MessageSid,
    }),
  );
