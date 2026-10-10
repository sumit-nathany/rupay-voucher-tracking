import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { benefitInstances, benefitOptions } from '@/db/schema';
import { NotFoundError, type Ctx } from '@/lib/context';
import { decryptCode, encryptCode } from '@/lib/crypto';

// Instance workflow actions (PLAN.md "Status workflow", "Voucher code display",
// Security model #2/#3). Every query is filtered by ctx.workspaceId; no function
// accepts a caller-supplied workspace id. A row in another workspace is
// indistinguishable from a missing row (same NotFoundError, same message).

export class InstanceStateError extends Error {}

export const ORDER_STATUSES = [
  'Not Ordered',
  'Ordered but Coupon not received',
  'Coupon Received',
  'Coupon Redeemed',
  'Skipped',
  'Withdrawn',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const WORKFLOW: readonly OrderStatus[] = [
  'Not Ordered',
  'Ordered but Coupon not received',
  'Coupon Received',
  'Coupon Redeemed',
];

// ── validation ──────────────────────────────────────────────────────────────

const uuid = z.string().uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a real calendar date');
const money = z.number().finite().min(0).max(99_999_999.99);
const toMoney = (n: number) => n.toFixed(2);

const statusInput = z.object({ instanceId: uuid, status: z.enum(ORDER_STATUSES) }).strict();
const idInput = z.object({ instanceId: uuid }).strict();
const saleInput = z.object({ instanceId: uuid, soldFor: money.nullable() }).strict();
const detailsInput = z
  .object({
    instanceId: uuid,
    orderDate: isoDate.nullable().optional(),
    expiryDate: isoDate.nullable().optional(),
    cashValue: money.nullable().optional(),
    rupayBookingId: z.string().trim().min(1).max(200).nullable().optional(),
    comments: z.string().max(5000).nullable().optional(),
  })
  .strict();
const chooseInput = z.object({ instanceId: uuid, optionId: uuid.nullable() }).strict();
const codeInput = z
  .object({ instanceId: uuid, code: z.string().trim().min(1).max(500).nullable() })
  .strict();

// ── types ───────────────────────────────────────────────────────────────────

type Row = typeof benefitInstances.$inferSelect;
/** Instance as returned to callers: ciphertext is never exposed, only whether a code exists. */
export type InstanceView = Omit<Row, 'codeEncrypted'> & { hasCode: boolean };

function toView(row: Row): InstanceView {
  const { codeEncrypted, ...rest } = row;
  return { ...rest, hasCode: codeEncrypted != null };
}

export interface RevealedCode {
  code: string;
  /** Present only when the value is exactly two whitespace-separated tokens. */
  number?: string;
  pin?: string;
}

// ── internals ───────────────────────────────────────────────────────────────

const scope = (ctx: Ctx, instanceId: string) =>
  and(eq(benefitInstances.id, instanceId), eq(benefitInstances.workspaceId, ctx.workspaceId));

async function load(ctx: Ctx, instanceId: string): Promise<Row> {
  const [row] = await ctx.db.select().from(benefitInstances).where(scope(ctx, instanceId));
  if (!row) throw new NotFoundError('Instance not found');
  return row;
}

function assertNotWithdrawn(row: Row) {
  if (row.orderStatus === 'Withdrawn') {
    throw new InstanceStateError('A Withdrawn instance cannot be changed');
  }
}

/** Optimistic update: only applies if the status is still what we read. */
async function update(ctx: Ctx, row: Row, patch: Partial<typeof benefitInstances.$inferInsert>) {
  const updated = await ctx.db
    .update(benefitInstances)
    .set({ ...patch, updatedAt: new Date() }) // no trigger: set explicitly
    .where(and(scope(ctx, row.id), eq(benefitInstances.orderStatus, row.orderStatus)))
    .returning();
  if (updated.length === 0) {
    // Lost a race with a concurrent change (or the row vanished).
    throw new InstanceStateError('Instance changed concurrently; reload and retry');
  }
  return toView(updated[0]);
}

// ── reads ───────────────────────────────────────────────────────────────────

export async function getInstance(ctx: Ctx, instanceId: string): Promise<InstanceView> {
  const { instanceId: id } = idInput.parse({ instanceId });
  return toView(await load(ctx, id));
}

/**
 * Decrypts on demand. AAD = the instance's own id, so a ciphertext copied from
 * another row fails authentication. Returns null when the instance has no code.
 * Never logs, and never puts plaintext or ciphertext in an error.
 */
export async function revealCode(ctx: Ctx, instanceId: string): Promise<RevealedCode | null> {
  const { instanceId: id } = idInput.parse({ instanceId });
  const [row] = await ctx.db
    .select({ id: benefitInstances.id, codeEncrypted: benefitInstances.codeEncrypted })
    .from(benefitInstances)
    .where(scope(ctx, id));
  if (!row) throw new NotFoundError('Instance not found');
  if (row.codeEncrypted == null) return null;
  const code = decryptCode(row.codeEncrypted, row.id); // throws a generic error on failure
  const tokens = code.split(/\s+/).filter(Boolean);
  if (tokens.length === 2) return { code, number: tokens[0], pin: tokens[1] };
  return { code };
}

// ── status transitions ──────────────────────────────────────────────────────

/**
 * Rules:
 *  - Withdrawn is system-driven: never a source or a target here.
 *  - Among the four workflow statuses any move is allowed (forward, backward;
 *    forward jumps are allowed too, e.g. straight to Coupon Redeemed).
 *  - Skipped is reachable only from Not Ordered and leaves only to Not Ordered.
 *  - Setting the status an instance already has is a no-op.
 */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (from === 'Withdrawn') throw new InstanceStateError('A Withdrawn instance cannot be changed');
  if (to === 'Withdrawn') throw new InstanceStateError('Withdrawn is system-driven and cannot be set');
  if (from === to) return;
  if (to === 'Skipped') {
    if (from !== 'Not Ordered') {
      throw new InstanceStateError('Only a Not Ordered instance can be skipped');
    }
    return;
  }
  if (from === 'Skipped') {
    if (to !== 'Not Ordered') {
      throw new InstanceStateError('A Skipped instance can only be unskipped to Not Ordered');
    }
    return;
  }
  if (!WORKFLOW.includes(from) || !WORKFLOW.includes(to)) {
    throw new InstanceStateError('Illegal status transition');
  }
}

export async function setStatus(
  ctx: Ctx,
  input: { instanceId: string; status: OrderStatus },
): Promise<InstanceView> {
  const { instanceId, status } = statusInput.parse(input);
  const row = await load(ctx, instanceId);
  const from = row.orderStatus as OrderStatus;
  assertTransition(from, status);
  if (from === status) return toView(row);
  return update(ctx, row, { orderStatus: status });
}

export const skipInstance = (ctx: Ctx, instanceId: string) =>
  setStatus(ctx, { instanceId, status: 'Skipped' });

export async function unskipInstance(ctx: Ctx, instanceId: string): Promise<InstanceView> {
  const { instanceId: id } = idInput.parse({ instanceId });
  const row = await load(ctx, id);
  if (row.orderStatus !== 'Skipped') throw new InstanceStateError('Instance is not Skipped');
  return update(ctx, row, { orderStatus: 'Not Ordered' });
}

// ── data edits ──────────────────────────────────────────────────────────────

/**
 * Records (or clears, with null) the sale amount. Does not change order_status:
 * per REQUIREMENTS.md §6 "sold" is Coupon Redeemed + sold_for, but §6 also
 * expects sold_for on a Coupon Received instance, so status stays the caller's
 * explicit choice. Not allowed on Skipped/Withdrawn (nothing to sell).
 */
export async function recordSale(
  ctx: Ctx,
  input: { instanceId: string; soldFor: number | null },
): Promise<InstanceView> {
  const { instanceId, soldFor } = saleInput.parse(input);
  const row = await load(ctx, instanceId);
  assertNotWithdrawn(row);
  if (soldFor != null && row.orderStatus === 'Skipped') {
    throw new InstanceStateError('A Skipped instance cannot be sold');
  }
  return update(ctx, row, { soldFor: soldFor == null ? null : toMoney(soldFor) });
}

/** Omitted field = unchanged; null = clear. */
export async function updateDetails(
  ctx: Ctx,
  input: {
    instanceId: string;
    orderDate?: string | null;
    expiryDate?: string | null;
    cashValue?: number | null;
    rupayBookingId?: string | null;
    comments?: string | null;
  },
): Promise<InstanceView> {
  const p = detailsInput.parse(input);
  const row = await load(ctx, p.instanceId);
  assertNotWithdrawn(row);
  const orderDate = p.orderDate === undefined ? row.orderDate : p.orderDate;
  const expiryDate = p.expiryDate === undefined ? row.expiryDate : p.expiryDate;
  if (orderDate && expiryDate && expiryDate < orderDate) {
    throw new InstanceStateError('expiry_date cannot be before order_date');
  }
  const patch: Partial<typeof benefitInstances.$inferInsert> = {};
  if (p.orderDate !== undefined) patch.orderDate = p.orderDate;
  if (p.expiryDate !== undefined) patch.expiryDate = p.expiryDate;
  if (p.cashValue !== undefined) patch.cashValue = p.cashValue == null ? null : toMoney(p.cashValue);
  if (p.rupayBookingId !== undefined) patch.rupayBookingId = p.rupayBookingId;
  if (p.comments !== undefined) patch.comments = p.comments;
  return update(ctx, row, patch);
}

/** Encrypts with the instance's own id as AAD. Plaintext is never stored or logged. */
export async function setCode(
  ctx: Ctx,
  input: { instanceId: string; code: string | null },
): Promise<InstanceView> {
  const { instanceId, code } = codeInput.parse(input);
  const row = await load(ctx, instanceId);
  assertNotWithdrawn(row);

  const patch: Partial<typeof benefitInstances.$inferInsert> = {
    codeEncrypted: code == null ? null : encryptCode(code, row.id),
  };

  if (code != null && row.orderStatus === 'Ordered but Coupon not received') {
    patch.orderStatus = 'Coupon Received';
  }

  return update(ctx, row, patch);
}

// ── "redeem any one" choice ─────────────────────────────────────────────────

export interface BenefitOptionView {
  id: string;
  provider: string;
  offerName: string;
  cashValue: number | null;
}

/** The offers to choose from for this instance; empty for an ordinary benefit. */
export async function getInstanceOptions(ctx: Ctx, instanceId: string): Promise<BenefitOptionView[]> {
  const { instanceId: id } = idInput.parse({ instanceId });
  const row = await load(ctx, id);
  if (!row.generatedFromVersion) return [];
  const opts = await ctx.db
    .select()
    .from(benefitOptions)
    .where(eq(benefitOptions.versionId, row.generatedFromVersion))
    .orderBy(asc(benefitOptions.sortOrder), asc(benefitOptions.provider));
  return opts.map((o) => ({
    id: o.id,
    provider: o.provider,
    offerName: o.offerName,
    cashValue: o.cashValue == null ? null : Number(o.cashValue),
  }));
}

/**
 * Records which offer was taken (null clears it). The option must belong to the
 * catalog version this instance was generated from, so a choice can't point at
 * another benefit's offer. Value shown in totals follows the chosen offer unless
 * the instance has its own cash_value.
 */
export async function chooseOption(
  ctx: Ctx,
  input: { instanceId: string; optionId: string | null },
): Promise<InstanceView> {
  const { instanceId, optionId } = chooseInput.parse(input);
  const row = await load(ctx, instanceId);
  assertNotWithdrawn(row);
  if (optionId != null) {
    const [opt] = await ctx.db.select({ versionId: benefitOptions.versionId }).from(benefitOptions).where(eq(benefitOptions.id, optionId));
    if (!opt || opt.versionId !== row.generatedFromVersion) {
      throw new InstanceStateError('That offer is not one of the choices for this benefit');
    }
  }
  return update(ctx, row, { chosenOptionId: optionId });
}
