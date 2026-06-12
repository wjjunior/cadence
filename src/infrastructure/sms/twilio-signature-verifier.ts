import { createHmac, timingSafeEqual } from 'node:crypto';

import type { WebhookVerifier } from '../../application/ports/webhook-verifier.js';

const compareTwilioParamKeys = (a: string, b: string): number => {
  if (a < b) return -1;
  if (a > b) return 1;
  return a.localeCompare(b);
};

export class TwilioSignatureVerifier implements WebhookVerifier {
  constructor(private readonly authToken: string) {}

  verify(input: { signature: string | undefined; url: string; params: Record<string, string> }): boolean {
    if (!input.signature) return false;

    // Twilio recipe: URL, then each POST param appended as key+value sorted by key.
    const signed = Object.keys(input.params)
      .sort(compareTwilioParamKeys)
      .reduce((acc, key) => acc + key + input.params[key], input.url);
    const expected = createHmac('sha1', this.authToken).update(signed, 'utf8').digest('base64');

    const a = Buffer.from(expected);
    const b = Buffer.from(input.signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
