import type { MessageStatus } from '@/shared/api';

export type StatusBadgeVariant = 'neutral' | 'progress' | 'success' | 'destructive';

export interface StatusBadgeSpec {
  label: string;
  variant: StatusBadgeVariant;
  pulse: boolean;
}

// Appendix A.3 status → badge mapping, kept pure so it is exhaustively unit-testable
// and components carry no status logic.
const statusBadges: Record<MessageStatus, StatusBadgeSpec> = {
  received: { label: 'received', variant: 'neutral', pulse: false },
  queued: { label: 'queued', variant: 'neutral', pulse: false },
  processing: { label: 'processing', variant: 'progress', pulse: true },
  sending: { label: 'sending', variant: 'progress', pulse: true },
  processed: { label: 'processed', variant: 'success', pulse: false },
  sent: { label: 'sent', variant: 'success', pulse: false },
  failed: { label: 'failed', variant: 'destructive', pulse: false },
};

export function statusBadge(status: MessageStatus): StatusBadgeSpec {
  return statusBadges[status];
}
