import { describe, expect, it } from 'vitest';
import { type TwilioMessagesClient, TwilioSmsProvider } from './twilio-sms-provider.js';

const input = {
  to: '+15550001234',
  from: '+15559876543',
  body: 'reply',
  idempotencyKey: 'reply:abc',
};

describe('TwilioSmsProvider', () => {
  it('should pass to/from/body to the client and map sid to providerSid', async () => {
    let captured: unknown;
    const client: TwilioMessagesClient = {
      create: async (args) => {
        captured = args;
        return { sid: 'SM-twilio-123' };
      },
    };
    const result = await new TwilioSmsProvider(client).send(input);
    expect(result).toEqual({ providerSid: 'SM-twilio-123' });
    expect(captured).toEqual({ to: input.to, from: input.from, body: input.body });
  });

  it('should wrap a client error in SmsSendError preserving the cause', async () => {
    const cause = new Error('Twilio 21610');
    const client: TwilioMessagesClient = { create: () => Promise.reject(cause) };
    await expect(new TwilioSmsProvider(client).send(input)).rejects.toMatchObject({
      name: 'SmsSendError',
      cause,
    });
  });
});
