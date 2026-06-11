import { describe, expect, it } from 'vitest';

import { TwilioInboundWebhook } from './twilio-webhook.js';

const form = {
  From: '+15550001234',
  To: '+15559876543',
  Body: 'hello',
  MessageSid: 'SM00000000000000000000000000000001',
};

describe('TwilioInboundWebhook', () => {
  it('should map a Twilio form to the ingest command', () => {
    expect(TwilioInboundWebhook.parse(form)).toEqual({
      from: form.From,
      to: form.To,
      body: 'hello',
      providerSid: form.MessageSid,
    });
  });

  it('should default an absent Body to an empty string', () => {
    expect(
      TwilioInboundWebhook.parse({ From: form.From, To: form.To, MessageSid: form.MessageSid }).body,
    ).toBe('');
  });

  it('should reject a missing From', () => {
    expect(() =>
      TwilioInboundWebhook.parse({ To: form.To, Body: form.Body, MessageSid: form.MessageSid }),
    ).toThrow();
  });

  it('should reject a missing MessageSid', () => {
    expect(() =>
      TwilioInboundWebhook.parse({ From: form.From, To: form.To, Body: form.Body }),
    ).toThrow();
  });
});
