import type { MessageStatus } from '@/shared/api';

export type StatusBadgeVariant = 'neutral' | 'progress' | 'success' | 'destructive';

export interface StatusBadgeSpec {
  label: string;
  variant: StatusBadgeVariant;
  pulse: boolean;
}

// Appendix A.3 status → badge mapping. Pure so it can be exhaustively unit-tested
// and so components carry no status logic (rule 8).
const STATUS_BADGES: Record<MessageStatus, StatusBadgeSpec> = {
  received: { label: 'received', variant: 'neutral', pulse: false },
  queued: { label: 'queued', variant: 'neutral', pulse: false },
  processing: { label: 'processing', variant: 'progress', pulse: true },
  sending: { label: 'sending', variant: 'progress', pulse: true },
  processed: { label: 'processed', variant: 'success', pulse: false },
  sent: { label: 'sent', variant: 'success', pulse: false },
  failed: { label: 'failed', variant: 'destructive', pulse: false },
};

export function statusBadge(status: MessageStatus): StatusBadgeSpec {
  return STATUS_BADGES[status];
}
