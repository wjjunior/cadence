import { describe, expect, it } from 'vitest';

import { messageStatuses } from '@/shared/api';

import { statusBadge } from './status-badge';

describe('statusBadge', () => {
  it('should map every status to a defined spec', () => {
    for (const status of messageStatuses) {
      const spec = statusBadge(status);
      expect(spec.label).toBe(status);
      expect(['neutral', 'progress', 'success', 'destructive']).toContain(spec.variant);
    }
  });

  it('should mark received and queued as neutral, non-pulsing', () => {
    for (const status of ['received', 'queued'] as const) {
      expect(statusBadge(status)).toMatchObject({ variant: 'neutral', pulse: false });
    }
  });

  it('should mark in-progress states as pulsing progress', () => {
    for (const status of ['processing', 'sending'] as const) {
      expect(statusBadge(status)).toMatchObject({ variant: 'progress', pulse: true });
    }
  });

  it('should mark processed and sent as the brand success state', () => {
    for (const status of ['processed', 'sent'] as const) {
      expect(statusBadge(status)).toMatchObject({ variant: 'success', pulse: false });
    }
  });

  it('should mark failed as destructive', () => {
    expect(statusBadge('failed')).toMatchObject({ variant: 'destructive', pulse: false });
  });
});
