import { createHash } from 'node:crypto';
import { type SmsProvider, SmsSendError } from '../../application/ports/sms-provider.js';

interface SentMessage {
  to: string;
  from: string;
  body: string;
  idempotencyKey: string;
  providerSid: string;
}

// Twilio message SIDs are SM + 32 hex chars; deriving from the key (no stored map) makes a
// resend with the same key return the same SID by construction.
export function mockSid(idempotencyKey: string): string {
  return `SM${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
}

export class MockSmsProvider implements SmsProvider {
  private readonly recordSends: boolean;
  private readonly sent: SentMessage[] = [];
  private failuresRemaining = 0;
  private alwaysFail = false;

  constructor(options: { recordSends?: boolean } = {}) {
    this.recordSends = options.recordSends ?? false;
  }

  async send(input: {
    to: string;
    from: string;
    body: string;
    idempotencyKey: string;
  }): Promise<{ providerSid: string }> {
    if (this.alwaysFail || this.failuresRemaining > 0) {
      if (this.failuresRemaining > 0) this.failuresRemaining -= 1;
      throw new SmsSendError('mock send failure');
    }
    const providerSid = mockSid(input.idempotencyKey);
    if (this.recordSends) this.sent.push({ ...input, providerSid });
    return { providerSid };
  }

  failNextSends(count: number): void {
    this.failuresRemaining = count;
  }

  failAlways(): void {
    this.alwaysFail = true;
  }

  reset(): void {
    this.failuresRemaining = 0;
    this.alwaysFail = false;
    this.sent.length = 0;
  }

  get sentMessages(): readonly SentMessage[] {
    return [...this.sent];
  }
}
