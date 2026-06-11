import { describe, expect, it } from 'vitest';

import { TwilioSignatureVerifier } from './twilio-signature-verifier.js';

// Twilio's published example (https://www.twilio.com/docs/usage/webhooks/webhooks-security).
const AUTH_TOKEN = '12345';
const URL = 'https://mycompany.com/myapp.php?foo=1&bar=2';
const PARAMS = {
  CallSid: 'CA1234567890ABCDE',
  Caller: '+14158675309',
  Digits: '1234',
  From: '+14158675309',
  To: '+18005551212',
};
const VALID_SIGNATURE = 'RSOYDt4T1cUTdK1PDd93/VVr8B8=';

describe('TwilioSignatureVerifier', () => {
  const verifier = new TwilioSignatureVerifier(AUTH_TOKEN);

  it('should accept a correctly signed request (Twilio test vector)', () => {
    expect(verifier.verify({ signature: VALID_SIGNATURE, url: URL, params: PARAMS })).toBe(true);
  });

  it('should reject a tampered signature', () => {
    expect(verifier.verify({ signature: 'tampered', url: URL, params: PARAMS })).toBe(false);
  });

  it('should reject a missing signature', () => {
    expect(verifier.verify({ signature: undefined, url: URL, params: PARAMS })).toBe(false);
  });

  it('should reject when a param is altered', () => {
    expect(
      verifier.verify({ signature: VALID_SIGNATURE, url: URL, params: { ...PARAMS, Digits: '9999' } }),
    ).toBe(false);
  });
});
