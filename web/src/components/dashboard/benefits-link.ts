import type { OrderStatus } from '@/domain/instances';
import { calendarQuarterForDate, type ViewedPeriod } from '@/lib/periods';
import { viewToParams } from './view-params';

export type BenefitsLinkOpts = {
  /** Not Ordered only: `1` missed (period ended), `0` still in period. */
  lapsed?: '0' | '1';
  holderId?: string;
  lifetime?: boolean;
};

function buildBenefitsSearchParams(
  view: ViewedPeriod | undefined,
  status?: OrderStatus,
  opts?: BenefitsLinkOpts,
): URLSearchParams {
  const p = new URLSearchParams();
  if (opts?.lifetime) {
    p.set('lifetime', '1');
  } else if (view) {
    for (const [k, v] of Object.entries(viewToParams(view))) p.set(k, v);
  }
  if (status) p.set('status', status);
  if (opts?.lapsed) p.set('lapsed', opts.lapsed);
  if (opts?.holderId) p.set('holder', opts.holderId);
  return p;
}

/**
 * Benefits list for the same period view and a single status filter.
 * `lapsed=1` with status Not Ordered shows missed (period ended) rows only;
 * `lapsed=0` shows Not Ordered rows still within the period.
 * Gift vouchers only (discount coupons excluded) unless the URL already includes discounts.
 */
export function benefitsStatusHref(
  view: ViewedPeriod,
  status: OrderStatus,
  opts?: Omit<BenefitsLinkOpts, 'lifetime'>,
): string {
  return `/benefits?${buildBenefitsSearchParams(view, status, opts).toString()}`;
}

export function benefitsLifetimeStatusHref(
  status: OrderStatus,
  opts?: Omit<BenefitsLinkOpts, 'lifetime'>,
): string {
  return `/benefits?${buildBenefitsSearchParams(undefined, status, { ...opts, lifetime: true }).toString()}`;
}

export function benefitsViewHref(view: ViewedPeriod, opts?: BenefitsLinkOpts): string {
  return `/benefits?${buildBenefitsSearchParams(view, undefined, opts).toString()}`;
}

/** Calendar quarter containing `todayStr` (IST), not the dashboard viewed period. */
export function benefitsRedeemedThisQuarterHref(todayStr: string): string {
  return benefitsStatusHref(calendarQuarterForDate(todayStr), 'Coupon Redeemed');
}

/** Calendar year of `todayStr`, not the dashboard viewed period. */
export function benefitsRedeemedThisYearHref(todayStr: string): string {
  const year = Number(todayStr.slice(0, 4));
  return benefitsStatusHref({ kind: 'year', year }, 'Coupon Redeemed');
}
