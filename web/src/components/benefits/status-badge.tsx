import { Ban, CircleSlash, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { InstanceListItem } from '@/domain/instance-queries';

/**
 * Status chip. Decision (spec silent on styling): Lapsed (missed, Not Ordered
 * past period end) is red with a clock icon; Withdrawn is dashed-outline grey
 * with a ban icon; Skipped is plain muted with strike-through-free slashed
 * circle icon. Active Not Ordered stays a neutral outline.
 */
export function StatusBadge({ item, className }: { item: Pick<InstanceListItem, 'status' | 'lapsed' | 'soldFor'>; className?: string }) {
  const { status, lapsed, soldFor } = item;
  if (lapsed) {
    return (
      <Badge variant="destructive" className={cn('gap-1', className)}>
        <Clock className="h-3 w-3" aria-hidden /> Lapsed
      </Badge>
    );
  }
  switch (status) {
    case 'Withdrawn':
      return (
        <Badge variant="outline" className={cn('gap-1 border-dashed text-muted-foreground', className)}>
          <Ban className="h-3 w-3" aria-hidden /> Withdrawn
        </Badge>
      );
    case 'Skipped':
      return (
        <Badge variant="secondary" className={cn('gap-1 text-muted-foreground', className)}>
          <CircleSlash className="h-3 w-3" aria-hidden /> Skipped
        </Badge>
      );
    case 'Not Ordered':
      return <Badge variant="outline" className={className}>Not ordered</Badge>;
    case 'Ordered but Coupon not received':
      return <Badge variant="warning" className={className}>Ordered, awaiting coupon</Badge>;
    case 'Coupon Received':
      return <Badge variant="default" className={className}>{soldFor != null ? 'Received · sold' : 'Coupon received'}</Badge>;
    case 'Coupon Redeemed':
      return <Badge variant="success" className={className}>{soldFor != null ? 'Sold' : 'Redeemed'}</Badge>;
  }
}
