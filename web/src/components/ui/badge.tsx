import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-violet/15 text-primary',
        secondary: 'border-transparent bg-muted text-foreground',
        outline: 'text-foreground',
        success: 'border-transparent bg-teal/15 text-teal',
        warning: 'border-transparent bg-gold/25 text-warning',
        destructive: 'border-transparent bg-rani/15 text-rani',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
