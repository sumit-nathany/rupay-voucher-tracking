import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Thin page wrapper — clean card surface with enter animation. */
export function ContentStage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'w-full mx-auto rounded-xl border border-border bg-card p-5 shadow-sm page-enter transition-all duration-200 ease-in-out sm:p-8',
        className,
      )}
    >
      {children}
    </div>
  );
}
