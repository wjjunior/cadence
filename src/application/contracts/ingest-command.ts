import { z } from 'zod';

// Transport-agnostic ingest input. Both the Twilio webhook (CAD-17) and the
// mock-mode simulate route (CAD-27) map their wire shape into this command.
export const IngestInboundCommand = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  body: z.string(),
  providerSid: z.string().min(1), // dedup key for webhook_events and the inbound provider_message_sid
});

export type IngestInboundCommand = z.infer<typeof IngestInboundCommand>;
