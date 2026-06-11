import { describe, expect, it } from 'vitest';

import { ConfigValidationError, loadConfig, loadDatabaseUrl } from './config.js';

const twilioEnv = {
  SMS_PROVIDER: 'twilio',
  TWILIO_ACCOUNT_SID: 'AC_test_sid',
  TWILIO_AUTH_TOKEN: 'test_token',
  TWILIO_FROM_NUMBER: '+15555550100',
} as const;

describe('loadConfig', () => {
  it('should resolve to the mock provider and sane defaults when no env is set', () => {
    const config = loadConfig({});

    expect(config.SMS_PROVIDER).toBe('mock');
    expect(config.DATABASE_URL).toMatch(/^postgres(ql)?:\/\//);
    expect(config.REPLY_DELAY_MIN_MS).toBe(3_000);
    expect(config.REPLY_DELAY_MAX_MS).toBe(15_000);
    expect(config.WORKER_CONCURRENCY).toBe(10);
    expect(config.JOB_MAX_ATTEMPTS).toBe(3);
    expect(config.LEASE_DURATION_MS).toBe(60_000);
    expect(config.RECONCILE_POLL_MS).toBe(5_000);
    expect(config.API_PORT).toBe(3000);
  });

  it('should coerce an API_PORT override', () => {
    expect(loadConfig({ API_PORT: '8080' }).API_PORT).toBe(8080);
  });

  it('should coerce numeric variables from their string env representation', () => {
    const config = loadConfig({ WORKER_CONCURRENCY: '4', LEASE_DURATION_MS: '90000' });

    expect(config.WORKER_CONCURRENCY).toBe(4);
    expect(config.LEASE_DURATION_MS).toBe(90_000);
  });

  it('should ignore unrelated environment variables', () => {
    const config = loadConfig({ PATH: '/usr/bin', HOME: '/root' });

    expect(config.SMS_PROVIDER).toBe('mock');
    expect(config).not.toHaveProperty('PATH');
  });

  it('should accept the twilio provider when all credentials are present', () => {
    const config = loadConfig(twilioEnv);

    expect(config.SMS_PROVIDER).toBe('twilio');
    expect(config.TWILIO_ACCOUNT_SID).toBe('AC_test_sid');
    expect(config.TWILIO_AUTH_TOKEN).toBe('test_token');
    expect(config.TWILIO_FROM_NUMBER).toBe('+15555550100');
  });

  it('should treat blank twilio credentials as absent in mock mode', () => {
    const config = loadConfig({
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
      TWILIO_FROM_NUMBER: '',
    });

    expect(config.SMS_PROVIDER).toBe('mock');
    expect(config.TWILIO_ACCOUNT_SID).toBeUndefined();
  });

  it('should throw ConfigValidationError when a malformed DATABASE_URL is provided', () => {
    expect(() => loadConfig({ DATABASE_URL: 'not-a-connection-string' })).toThrow(
      ConfigValidationError,
    );
  });

  it('should throw ConfigValidationError when a numeric variable is not a number', () => {
    expect(() => loadConfig({ WORKER_CONCURRENCY: 'three' })).toThrow(ConfigValidationError);
  });

  it('should throw ConfigValidationError when a numeric variable is out of range', () => {
    expect(() => loadConfig({ WORKER_CONCURRENCY: '0' })).toThrow(ConfigValidationError);
  });

  it('should reject an unknown SMS_PROVIDER value', () => {
    expect(() => loadConfig({ SMS_PROVIDER: 'sns' })).toThrow(ConfigValidationError);
  });

  it('should fail fast when SMS_PROVIDER=twilio but credentials are missing', () => {
    expect(() => loadConfig({ SMS_PROVIDER: 'twilio' })).toThrow(ConfigValidationError);
  });

  it('should name every missing twilio credential in the failure message', () => {
    try {
      loadConfig({ SMS_PROVIDER: 'twilio' });
      expect.unreachable('expected loadConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const message = (error as ConfigValidationError).message;
      expect(message).toContain('TWILIO_ACCOUNT_SID');
      expect(message).toContain('TWILIO_AUTH_TOKEN');
      expect(message).toContain('TWILIO_FROM_NUMBER');
    }
  });

  it('should reject a reply delay window where the minimum exceeds the maximum', () => {
    expect(() => loadConfig({ REPLY_DELAY_MIN_MS: '20000', REPLY_DELAY_MAX_MS: '15000' })).toThrow(
      ConfigValidationError,
    );
  });
});

describe('loadDatabaseUrl', () => {
  it('should return the provided database url', () => {
    expect(loadDatabaseUrl({ DATABASE_URL: 'postgres://u:p@db:5432/app' })).toBe(
      'postgres://u:p@db:5432/app',
    );
  });

  it('should resolve to the default when no database url is set', () => {
    expect(loadDatabaseUrl({})).toMatch(/^postgres(ql)?:\/\//);
  });

  it('should throw ConfigValidationError on a malformed database url', () => {
    expect(() => loadDatabaseUrl({ DATABASE_URL: 'not-a-connection-string' })).toThrow(
      ConfigValidationError,
    );
  });
});
