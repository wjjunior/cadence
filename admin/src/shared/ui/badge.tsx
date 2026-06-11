import { type VariantProps, cva } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/shared/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        neutral: 'border-transparent bg-muted text-muted-foreground',
        progress: 'border-transparent bg-[var(--color-warning-surface)] text-[var(--color-warning)]',
        success: 'border-transparent bg-primary/10 text-primary',
        destructive: 'border-transparent bg-destructive/10 text-destructive',
        outline: 'text-foreground',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export type BadgeProps = React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
