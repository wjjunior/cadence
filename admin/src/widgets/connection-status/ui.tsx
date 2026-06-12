import type { SseStatus } from '@/shared/api';
import { cn } from '@/shared/lib';

const presentation: Record<SseStatus, { label: string; dot: string; muted?: boolean }> = {
  open: { label: 'Live', dot: 'bg-primary' },
  connecting: { label: 'Reconnecting…', dot: 'bg-[var(--color-warning)] animate-pulse' },
  closed: { label: 'Offline', dot: 'bg-muted-foreground', muted: true },
};

export function ConnectionStatus({ status }: Readonly<{ status: SseStatus }>) {
  const { label, dot, muted } = presentation[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs',
        muted ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      <span className={cn('size-2 rounded-full', dot)} />
      {label}
    </span>
  );
}
