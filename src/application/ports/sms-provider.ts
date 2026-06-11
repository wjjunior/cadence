export interface SmsProvider {
  send(input: {
    to: string;
    from: string;
    body: string;
    idempotencyKey: string;
  }): Promise<{ providerSid: string }>;
}
