import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Main in-app surface — elevated “desk” on the textured canvas. */
export function ContentStage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('content-stage page-enter', className)}>{children}</div>;
}
