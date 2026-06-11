import { describe, expect, it } from 'vitest';
import { SmsSendError } from '../../application/ports/sms-provider.js';
import { MockSmsProvider, mockSid } from './mock-sms-provider.js';

const input = { to: '+15550001234', from: '+15559876543', body: 'hi', idempotencyKey: 'reply:abc' };

describe('mockSid', () => {
  it('should return the same SID for the same idempotency key', () => {
    expect(mockSid('reply:abc')).toBe(mockSid('reply:abc'));
  });

  it('should return distinct SIDs for distinct keys', () => {
    expect(mockSid('reply:a')).not.toBe(mockSid('reply:b'));
  });

  it('should produce a Twilio-shaped SID (SM + 32 hex)', () => {
    expect(mockSid('reply:abc')).toMatch(/^SM[0-9a-f]{32}$/);
  });
});

describe('MockSmsProvider', () => {
  it('should derive providerSid deterministically from the idempotency key', async () => {
    const { providerSid } = await new MockSmsProvider().send(input);
    expect(providerSid).toBe(mockSid(input.idempotencyKey));
  });

  it('should return the same SID on a resend with the same key', async () => {
    const provider = new MockSmsProvider();
    const first = await provider.send(input);
    const second = await provider.send(input);
    expect(second.providerSid).toBe(first.providerSid);
  });

  it('should reject the next send then succeed (failNextSends)', async () => {
    const provider = new MockSmsProvider();
    provider.failNextSends(1);
    await expect(provider.send(input)).rejects.toBeInstanceOf(SmsSendError);
    await expect(provider.send(input)).resolves.toMatchObject({ providerSid: expect.any(String) });
  });

  it('should reject every send when failAlways is set', async () => {
    const provider = new MockSmsProvider();
    provider.failAlways();
    await expect(provider.send(input)).rejects.toBeInstanceOf(SmsSendError);
    await expect(provider.send(input)).rejects.toBeInstanceOf(SmsSendError);
  });

  it('should clear failure state and recorded sends on reset', async () => {
    const provider = new MockSmsProvider({ recordSends: true });
    provider.failAlways();
    provider.reset();
    await provider.send(input);
    expect(provider.sentMessages).toHaveLength(1);
    provider.reset();
    expect(provider.sentMessages).toHaveLength(0);
  });

  it('should record sends only when recordSends is enabled', async () => {
    const recording = new MockSmsProvider({ recordSends: true });
    await recording.send(input);
    expect(recording.sentMessages).toHaveLength(1);

    const silent = new MockSmsProvider();
    await silent.send(input);
    expect(silent.sentMessages).toHaveLength(0);
  });
});
