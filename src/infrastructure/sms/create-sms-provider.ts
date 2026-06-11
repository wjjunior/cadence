import twilio from 'twilio';
import type { SmsProvider } from '../../application/ports/sms-provider.js';
import { type Config, smsProvider } from '../config.js';
import { MockSmsProvider } from './mock-sms-provider.js';
import { type TwilioMessagesClient, TwilioSmsProvider } from './twilio-sms-provider.js';

class IncompleteTwilioConfigError extends Error {
  constructor() {
    super('SMS_PROVIDER=twilio requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
    this.name = 'IncompleteTwilioConfigError';
  }
}

export function createSmsProvider(config: Config): SmsProvider {
  if (config.SMS_PROVIDER !== smsProvider.twilio) {
    return new MockSmsProvider();
  }
  // Unreachable given config validation, but it narrows the optional secrets for the type system.
  if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) {
    throw new IncompleteTwilioConfigError();
  }
  const client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  const messages: TwilioMessagesClient = {
    create: async ({ to, from, body }) => {
      const message = await client.messages.create({ to, from, body });
      return { sid: message.sid };
    },
  };
  return new TwilioSmsProvider(messages);
}
