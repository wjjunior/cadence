import { z } from 'zod';

export const AppConfig = z.object({
  smsProvider: z.enum(['mock', 'twilio']),
});

export type AppConfig = z.infer<typeof AppConfig>;
