import { z } from 'zod';

// Transport-agnostic ingest input. Both the Twilio webhook (CAD-17) and the
// mock-mode simulate route (CAD-27) map their wire shape into this command.
export const IngestInboundCommand = z.object({
  from: z.string().min(1), // user phone -> conversationKey
  to: z.string().min(1), // system phone -> conversationKey
  body: z.string(), // message text (may be empty)
  providerSid: z.string().min(1), // Twilio MessageSid -> webhook_events dedup + inbound SID
});

export type IngestInboundCommand = z.infer<typeof IngestInboundCommand>;
