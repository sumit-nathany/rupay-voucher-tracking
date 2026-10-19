export type ColumnId =
  | 'category'
  | 'benefit'
  | 'card'
  | 'rupayBookingId'
  | 'portalAccount'
  | 'period'
  | 'orderDate'
  | 'expiryDate'
  | 'deadline'
  | 'frequency'
  | 'value'
  | 'status'
  | 'comments';

export interface ColumnDefinition {
  id: ColumnId;
  label: string;
  description: string;
  align: 'left' | 'right';
  minWidthPx: number;
  gridWidth: string;
}

export const ALL_COLUMNS: ColumnDefinition[] = [
  {
    id: 'category',
    label: 'Category',
    description: 'Benefit category (e.g. Dining, Spa, OTT)',
    align: 'left',
    minWidthPx: 120,
    gridWidth: 'minmax(120px, 1.2fr)',
  },
  {
    id: 'benefit',
    label: 'Benefit',
    description: 'Brand or benefit name',
    align: 'left',
    minWidthPx: 140,
    gridWidth: 'minmax(140px, 1.5fr)',
  },
  {
    id: 'card',
    label: 'Holder / Card',
    description: 'Cardholder and bank card details',
    align: 'left',
    minWidthPx: 160,
    gridWidth: 'minmax(160px, 2fr)',
  },
  {
    id: 'rupayBookingId',
    label: 'RuPay Tag ID',
    description: 'RuPay portal booking / order reference',
    align: 'left',
    minWidthPx: 140,
    gridWidth: 'minmax(140px, 1.3fr)',
  },
  {
    id: 'portalAccount',
    label: 'RuPay Account',
    description: 'Linked RuPay portal login account',
    align: 'left',
    minWidthPx: 130,
    gridWidth: 'minmax(130px, 1.2fr)',
  },
  {
    id: 'period',
    label: 'Period',
    description: 'Entitlement period (e.g. Q4 2025, 2025)',
    align: 'left',
    minWidthPx: 95,
    gridWidth: 'minmax(95px, 0.9fr)',
  },
  {
    id: 'orderDate',
    label: 'Order Date',
    description: 'Date the order was placed',
    align: 'left',
    minWidthPx: 105,
    gridWidth: 'minmax(105px, 1fr)',
  },
  {
    id: 'expiryDate',
    label: 'Expiry Date',
    description: 'Voucher validity expiration date',
    align: 'left',
    minWidthPx: 105,
    gridWidth: 'minmax(105px, 1fr)',
  },
  {
    id: 'deadline',
    label: 'Deadline',
    description: 'Last date to order in entitlement period',
    align: 'left',
    minWidthPx: 105,
    gridWidth: 'minmax(105px, 1fr)',
  },
  {
    id: 'frequency',
    label: 'Frequency',
    description: 'Cycle frequency (Quarterly, Annual, etc.)',
    align: 'left',
    minWidthPx: 95,
    gridWidth: 'minmax(95px, 0.8fr)',
  },
  {
    id: 'value',
    label: 'Value',
    description: 'Cash value or voucher face amount',
    align: 'right',
    minWidthPx: 85,
    gridWidth: 'minmax(85px, 0.8fr)',
  },
  {
    id: 'status',
    label: 'Status',
    description: 'Voucher status (Ordered, Redeemed, etc.)',
    align: 'right',
    minWidthPx: 160,
    gridWidth: 'minmax(160px, 1.4fr)',
  },
  {
    id: 'comments',
    label: 'Notes',
    description: 'User notes or remarks',
    align: 'left',
    minWidthPx: 120,
    gridWidth: 'minmax(120px, 1.2fr)',
  },
];

export const ALL_COLUMN_IDS = new Set<ColumnId>(ALL_COLUMNS.map((c) => c.id));

/**
 * Whatever is available currently is the baseline default.
 */
export const BASE_DEFAULT_COLUMNS: ColumnId[] = [
  'category',
  'benefit',
  'card',
  'value',
  'status',
];

export interface BenefitViewContext {
  status?: string | null;
  lifetime?: boolean;
  searchScope?: string | null;
  portalAccountId?: string | null;
}

export function resolveContextKey(ctx: BenefitViewContext): string {
  if (ctx.status === 'Ordered') return 'ordered';
  if (ctx.status === 'Coupon Received') return 'received';
  if (ctx.status === 'Not Ordered') return 'not_ordered';
  if (ctx.status === 'Redeemed') return 'redeemed';
  if (ctx.status) return `status_${ctx.status.toLowerCase().replace(/\s+/g, '_')}`;
  if (ctx.portalAccountId) return 'account';
  if (ctx.lifetime || ctx.searchScope === 'all') return 'lifetime';
  return 'default';
}

export function getContextLabel(ctx: BenefitViewContext): string {
  if (ctx.status === 'Ordered') return 'Ordered benefits (Tag ID included by default)';
  if (ctx.status === 'Coupon Received') return 'Received coupons (Tag ID & Expiry included)';
  if (ctx.status === 'Not Ordered') return 'Not Ordered benefits (Deadline included)';
  if (ctx.status === 'Redeemed') return 'Redeemed benefits';
  if (ctx.portalAccountId) return 'RuPay Account orders (Tag ID included)';
  if (ctx.lifetime || ctx.searchScope === 'all') return 'Lifetime view (Period included)';
  return 'Standard view';
}

/**
 * Dynamically determines default columns based on what the user is currently looking into.
 * Example: when looking into only ordered benefits, RuPay Tag ID becomes part of the default list.
 */
export function getDefaultColumnsForContext(ctx: BenefitViewContext): ColumnId[] {
  if (ctx.status === 'Ordered') {
    return ['category', 'benefit', 'card', 'rupayBookingId', 'orderDate', 'value', 'status'];
  }
  if (ctx.status === 'Coupon Received') {
    return ['category', 'benefit', 'card', 'rupayBookingId', 'expiryDate', 'value', 'status'];
  }
  if (ctx.status === 'Not Ordered') {
    return ['category', 'benefit', 'card', 'deadline', 'value', 'status'];
  }
  if (ctx.portalAccountId) {
    return ['category', 'benefit', 'card', 'rupayBookingId', 'value', 'status'];
  }
  if (ctx.lifetime || ctx.searchScope === 'all') {
    return ['category', 'benefit', 'card', 'period', 'value', 'status'];
  }
  return [...BASE_DEFAULT_COLUMNS];
}

export function parseColumnsParam(raw: string | null | undefined): ColumnId[] | null {
  if (!raw) return null;
  const parts = raw.split(',').map((s) => s.trim()) as ColumnId[];
  const valid = parts.filter((p) => ALL_COLUMN_IDS.has(p));
  return valid.length > 0 ? valid : null;
}

export function serializeColumns(cols: ColumnId[]): string {
  return cols.join(',');
}

const STORAGE_PREFIX = 'rupay_benefit_cols_v1_';

export function loadSavedColumns(ctx: BenefitViewContext): ColumnId[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = STORAGE_PREFIX + resolveContextKey(ctx);
    const item = window.localStorage.getItem(key);
    if (!item) return null;
    const parsed = JSON.parse(item);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((id: string) => ALL_COLUMN_IDS.has(id as ColumnId)) as ColumnId[];
      return valid.length > 0 ? valid : null;
    }
  } catch {
    // ignore storage read issues
  }
  return null;
}

export function saveColumnsPreference(ctx: BenefitViewContext, cols: ColumnId[]): void {
  if (typeof window === 'undefined') return;
  try {
    const key = STORAGE_PREFIX + resolveContextKey(ctx);
    window.localStorage.setItem(key, JSON.stringify(cols));
  } catch {
    // ignore storage quota issues
  }
}

export function clearSavedColumnsPreference(ctx: BenefitViewContext): void {
  if (typeof window === 'undefined') return;
  try {
    const key = STORAGE_PREFIX + resolveContextKey(ctx);
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage issues
  }
}
