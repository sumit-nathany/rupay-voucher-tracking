// Pure helpers for the benefit drawer. No React, no server imports, no secrets.
// Mirrors (does not replace) the rules in src/domain/instances.ts; the server stays authoritative.

export const WORKFLOW_STATUSES = [
  'Not Ordered',
  'Ordered but Coupon not received',
  'Coupon Received',
  'Coupon Redeemed',
] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export type StatusKind = 'workflow' | 'skipped' | 'withdrawn';

export const CODE_MASK = '••••';
export const AUTO_HIDE_MS = 30_000;
export const COPIED_MS = 2_000;

export function statusKind(status: string): StatusKind {
  if (status === 'Withdrawn') return 'withdrawn';
  if (status === 'Skipped') return 'skipped';
  return 'workflow';
}

export function workflowIndex(status: string): number {
  return WORKFLOW_STATUSES.indexOf(status as WorkflowStatus);
}

/** Neighbouring workflow statuses, or null at the ends / outside the workflow. */
export function neighbours(status: string): { prev: WorkflowStatus | null; next: WorkflowStatus | null } {
  const i = workflowIndex(status);
  if (i < 0) return { prev: null, next: null };
  return { prev: WORKFLOW_STATUSES[i - 1] ?? null, next: WORKFLOW_STATUSES[i + 1] ?? null };
}

/** Skipped is reachable only from Not Ordered (domain rule). */
export const canSkip = (status: string) => status === 'Not Ordered';
/** Sales are not allowed on Skipped or Withdrawn instances. */
export const canRecordSale = (status: string) => statusKind(status) === 'workflow';
/** Withdrawn instances are read-only. */
export const canEdit = (status: string) => status !== 'Withdrawn';

// ── validation ──────────────────────────────────────────────────────────────

export const MAX_MONEY = 99_999_999.99;

/** Blank -> null (clear). Otherwise a non-negative number with at most 2 decimals. */
export function parseMoney(raw: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const s = raw.trim();
  if (s === '') return { ok: true, value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'Enter a non-negative amount with at most 2 decimals' };
  const n = Number(s);
  if (!Number.isFinite(n) || n > MAX_MONEY) return { ok: false, error: 'Amount is too large' };
  return { ok: true, value: n };
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export interface DetailsForm {
  orderDate: string;
  expiryDate: string;
  cashValue: string;
  rupayBookingId: string;
  comments: string;
}
export interface DetailsPayload {
  orderDate: string | null;
  expiryDate: string | null;
  cashValue: number | null;
  rupayBookingId: string | null;
  comments: string | null;
}
export type DetailsErrors = Partial<Record<keyof DetailsForm, string>>;

export function validateDetails(
  f: DetailsForm,
): { ok: true; value: DetailsPayload } | { ok: false; errors: DetailsErrors } {
  const errors: DetailsErrors = {};
  const orderDate = f.orderDate.trim();
  const expiryDate = f.expiryDate.trim();
  if (orderDate && !isIsoDate(orderDate)) errors.orderDate = 'Not a valid date';
  if (expiryDate && !isIsoDate(expiryDate)) errors.expiryDate = 'Not a valid date';
  if (!errors.orderDate && !errors.expiryDate && orderDate && expiryDate && expiryDate < orderDate) {
    errors.expiryDate = 'Expiry cannot be before the order date';
  }
  const cash = parseMoney(f.cashValue);
  if (!cash.ok) errors.cashValue = cash.error;
  if (f.rupayBookingId.length > 200) errors.rupayBookingId = 'At most 200 characters';
  if (f.comments.length > 5000) errors.comments = 'At most 5000 characters';
  if (Object.keys(errors).length > 0 || !cash.ok) return { ok: false, errors };
  return {
    ok: true,
    value: {
      orderDate: orderDate || null,
      expiryDate: expiryDate || null,
      cashValue: cash.value,
      rupayBookingId: f.rupayBookingId.trim() || null,
      comments: f.comments.trim() ? f.comments : null,
    },
  };
}

export function validateCode(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = raw.trim();
  if (!v) return { ok: false, error: 'Enter a code' };
  if (v.length > 500) return { ok: false, error: 'At most 500 characters' };
  return { ok: true, value: v };
}

/**
 * Short user-facing message for a thrown action error. Never includes stacks.
 * Next.js strips server error messages in production (generic text with a digest);
 * those collapse to the fallback.
 */
export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const m = e instanceof Error ? e.message.trim() : '';
  if (!m || m.length > 160 || m.includes('\n') || /digest|server components render|ZodError|^\[/i.test(m)) {
    return fallback;
  }
  return m;
}

export function formatMoney(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatDate(s: string | null | undefined): string {
  if (!s || !isIsoDate(s)) return '—';
  const d = new Date(`${s}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
