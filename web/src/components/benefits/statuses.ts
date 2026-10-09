import type { InstanceListItem } from '@/domain/instance-queries';

type OrderStatus = InstanceListItem['status'];

// Client-safe copy of ORDER_STATUSES (importing '@/domain/instances' would pull
// node:crypto into the client bundle). The Record type makes tsc fail if the
// domain list gains or loses a status.
const MAP: Record<OrderStatus, true> = {
  'Not Ordered': true,
  'Ordered but Coupon not received': true,
  'Coupon Received': true,
  'Coupon Redeemed': true,
  Skipped: true,
  Withdrawn: true,
};
export const STATUS_OPTIONS = Object.keys(MAP) as OrderStatus[];
