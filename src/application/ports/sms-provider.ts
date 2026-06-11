export interface SmsProvider {
  send(input: {
    to: string;
    from: string;
    body: string;
    idempotencyKey: string;
  }): Promise<{ providerSid: string }>;
}

// Every SmsProvider.send rejects with this on a delivery failure, so the worker sees one
// failure type regardless of provider (the Twilio adapter wraps the SDK error as the cause).
export class SmsSendError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SmsSendError';
  }
}
