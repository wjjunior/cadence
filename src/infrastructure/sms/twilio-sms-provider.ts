import { type SmsProvider, SmsSendError } from '../../application/ports/sms-provider.js';

export interface TwilioMessagesClient {
  create(input: { to: string; from: string; body: string }): Promise<{ sid: string }>;
}

export class TwilioSmsProvider implements SmsProvider {
  constructor(private readonly client: TwilioMessagesClient) {}

  async send(input: {
    to: string;
    from: string;
    body: string;
    idempotencyKey: string;
  }): Promise<{ providerSid: string }> {
    // The Messages API has no per-request idempotency key, so it is not forwarded;
    // effectively-once here rests on the outbound UNIQUE plus the worker's pre-send check.
    try {
      const { sid } = await this.client.create({
        to: input.to,
        from: input.from,
        body: input.body,
      });
      return { providerSid: sid };
    } catch (error) {
      throw new SmsSendError('Twilio send failed', { cause: error });
    }
  }
}
