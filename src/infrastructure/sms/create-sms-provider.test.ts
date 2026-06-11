import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createSmsProvider } from './create-sms-provider.js';
import { MockSmsProvider } from './mock-sms-provider.js';
import { TwilioSmsProvider } from './twilio-sms-provider.js';

describe('createSmsProvider', () => {
  it('should select the mock provider with no env', () => {
    expect(createSmsProvider(loadConfig({}))).toBeInstanceOf(MockSmsProvider);
  });

  it('should select the mock provider in explicit mock mode (Twilio not constructed)', () => {
    expect(createSmsProvider(loadConfig({ SMS_PROVIDER: 'mock' }))).toBeInstanceOf(MockSmsProvider);
  });

  it('should select the Twilio provider when configured with credentials', () => {
    const config = loadConfig({
      SMS_PROVIDER: 'twilio',
      TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
      TWILIO_AUTH_TOKEN: 'test-auth-token',
      TWILIO_FROM_NUMBER: '+15550000000',
    });
    expect(createSmsProvider(config)).toBeInstanceOf(TwilioSmsProvider);
  });
});
