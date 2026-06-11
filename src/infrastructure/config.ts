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
const DEFAULT_BACKOFF_BASE_MS = 1_000;
const DEFAULT_BACKOFF_CAP_MS = 60_000;
const DEFAULT_API_PORT = 3_000;
// 15s heartbeat sits well under the ~60s idle timeout of typical proxies.
const DEFAULT_SSE_HEARTBEAT_MS = 15_000;
const DEFAULT_METRICS_POLL_MS = 10_000;

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof logLevels)[number];
const DEFAULT_LOG_LEVEL = 'info';

const twilioKeys = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'] as const;

const positiveInt = (defaultValue: number) =>
  z.coerce.number().int().positive().default(defaultValue);

// A blank value in a copied .env (e.g. TWILIO_ACCOUNT_SID=) means "unset", not a
// zero-length secret, so it must not trip the min(1) check while in mock mode.
const optionalSecret = () =>
  z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional());

const databaseUrlSchema = z
  .string()
  .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
    message: 'must be a postgres connection string (postgres:// or postgresql://)',
  })
  .default(DEFAULT_DATABASE_URL);

const envSchema = z
  .object({
    DATABASE_URL: databaseUrlSchema,
    SMS_PROVIDER: z.enum([smsProvider.mock, smsProvider.twilio]).default(smsProvider.mock),
    REPLY_DELAY_MIN_MS: z.coerce.number().int().nonnegative().default(DEFAULT_REPLY_DELAY_MIN_MS),
    REPLY_DELAY_MAX_MS: z.coerce.number().int().nonnegative().default(DEFAULT_REPLY_DELAY_MAX_MS),
    WORKER_CONCURRENCY: positiveInt(DEFAULT_WORKER_CONCURRENCY),
    JOB_MAX_ATTEMPTS: positiveInt(DEFAULT_JOB_MAX_ATTEMPTS),
    LEASE_DURATION_MS: positiveInt(DEFAULT_LEASE_DURATION_MS),
    RECONCILE_POLL_MS: positiveInt(DEFAULT_RECONCILE_POLL_MS),
    BACKOFF_BASE_MS: positiveInt(DEFAULT_BACKOFF_BASE_MS),
    BACKOFF_CAP_MS: positiveInt(DEFAULT_BACKOFF_CAP_MS),
    API_PORT: positiveInt(DEFAULT_API_PORT),
    SSE_HEARTBEAT_MS: positiveInt(DEFAULT_SSE_HEARTBEAT_MS),
    METRICS_POLL_MS: positiveInt(DEFAULT_METRICS_POLL_MS),
    LOG_LEVEL: z.enum(logLevels).default(DEFAULT_LOG_LEVEL),
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

    if (cfg.BACKOFF_BASE_MS > cfg.BACKOFF_CAP_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['BACKOFF_CAP_MS'],
        message: 'BACKOFF_CAP_MS must be greater than or equal to BACKOFF_BASE_MS',
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

// The migration CLI needs only the database URL and must not require the SMS
// configuration (e.g. Twilio credentials) just to run migrations — so it routes
// through here rather than reading process.env itself (rule 11).
export function loadDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const result = databaseUrlSchema.safeParse(env.DATABASE_URL);
  if (!result.success) {
    throw new ConfigValidationError(result.error);
  }
  return result.data;
}
