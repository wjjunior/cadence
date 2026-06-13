import { z } from 'zod';

export const SendMessage = z.object({
  to: z.string().min(1),
  body: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

export type SendMessage = z.infer<typeof SendMessage>;
