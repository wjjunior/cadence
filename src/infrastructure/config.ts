import { z } from 'zod';

export const smsProvider = {
  mock: 'mock',
  twilio: 'twilio',
} as const;

export type SmsProviderName = (typeof smsProvider)[keyof typeof smsProvider];

const DEFAULT_DATABASE_URL = 'postgresql://cadence:cadence@localhost:5433/cadence';
const DEFAULT_REPLY_DELAY_MIN_MS = 3_000;
const DEFAULT_REPLY_DELAY_MAX_MS = 15_000;
const DEFAULT_WORKER_CONCURRENCY = 10;
const DEFAULT_JOB_MAX_ATTEMPTS = 3;
// 60s lease is 4x the 15s worst-case processing time (design §5.1).
const DEFAULT_LEASE_DURATION_MS = 60_000;
const DEFAULT_RECONCILE_POLL_MS = 5_000;

const twilioKeys = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'] as const;

const port = (defaultMs: number) => z.coerce.number().int().positive().default(defaultMs);

// A blank value in a copied .env (e.g. TWILIO_ACCOUNT_SID=) means "unset", not a
// zero-length secret, so it must not trip the min(1) check while in mock mode.
const optionalSecret = () =>
  z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional());

const envSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
        message: 'must be a postgres connection string (postgres:// or postgresql://)',
      })
      .default(DEFAULT_DATABASE_URL),
    SMS_PROVIDER: z.enum([smsProvider.mock, smsProvider.twilio]).default(smsProvider.mock),
    REPLY_DELAY_MIN_MS: z.coerce.number().int().nonnegative().default(DEFAULT_REPLY_DELAY_MIN_MS),
    REPLY_DELAY_MAX_MS: z.coerce.number().int().nonnegative().default(DEFAULT_REPLY_DELAY_MAX_MS),
    WORKER_CONCURRENCY: port(DEFAULT_WORKER_CONCURRENCY),
    JOB_MAX_ATTEMPTS: port(DEFAULT_JOB_MAX_ATTEMPTS),
    LEASE_DURATION_MS: port(DEFAULT_LEASE_DURATION_MS),
    RECONCILE_POLL_MS: port(DEFAULT_RECONCILE_POLL_MS),
    TWILIO_ACCOUNT_SID: optionalSecret(),
    TWILIO_AUTH_TOKEN: optionalSecret(),
    TWILIO_FROM_NUMBER: optionalSecret(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.REPLY_DELAY_MIN_MS > cfg.REPLY_DELAY_MAX_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['REPLY_DELAY_MAX_MS'],
        message: 'REPLY_DELAY_MAX_MS must be greater than or equal to REPLY_DELAY_MIN_MS',
      });
    }

    if (cfg.SMS_PROVIDER !== smsProvider.twilio) return;

    for (const key of twilioKeys) {
      if (!cfg[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when SMS_PROVIDER=twilio`,
        });
      }
    }
  });

export type Config = z.infer<typeof envSchema>;

export class ConfigValidationError extends Error {
  constructor(error: z.ZodError) {
    super(`Invalid environment configuration:\n${z.prettifyError(error)}`);
    this.name = 'ConfigValidationError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigValidationError(result.error);
  }
  return result.data;
}
