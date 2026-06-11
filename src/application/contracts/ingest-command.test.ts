import { describe, expect, it } from 'vitest';
import { IngestInboundCommand } from './ingest-command.js';

const valid = {
  from: '+15550001234',
  to: '+15559876543',
  body: 'hello',
  providerSid: 'SM00000000000000000000000000000001',
};

describe('IngestInboundCommand', () => {
  it('should parse a representative inbound command', () => {
    expect(IngestInboundCommand.parse(valid)).toEqual(valid);
  });

  it('should allow an empty body', () => {
    expect(IngestInboundCommand.parse({ ...valid, body: '' }).body).toBe('');
  });

  it('should reject a missing from', () => {
    expect(() => IngestInboundCommand.parse({ ...valid, from: undefined })).toThrow();
  });

  it('should reject a missing providerSid', () => {
    const withoutSid = { from: valid.from, to: valid.to, body: valid.body };
    expect(() => IngestInboundCommand.parse(withoutSid)).toThrow();
  });

  it('should reject an empty from', () => {
    expect(() => IngestInboundCommand.parse({ ...valid, from: '' })).toThrow();
  });
});
