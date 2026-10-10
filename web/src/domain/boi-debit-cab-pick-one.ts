import { eq, sql } from 'drizzle-orm';
import { benefitCatalogVersions } from '@/db/schema';
import type { Database } from '@/lib/context';

/** Bank of India RuPay Select Debit — shared catalog ids (stable across envs). */
export const BOI_SELECT_DEBIT_BANK_CARD_TYPE_ID = '6ea891d3-25e3-4b77-974f-485423443ace';
export const BOI_SELECT_DEBIT_CAB_BENEFIT_ID = '54a0d991-3147-40b4-8bc7-15cac91e9089';
export const BOI_SELECT_DEBIT_CAB_VERSION_ID = '8e7921d8-f039-4f00-b069-976973aa1fe3';
export const BOI_SELECT_DEBIT_CAB_OLA_OPTION_ID = '7c4e6a10-b011-4cab-8001-010000000001';
export const BOI_SELECT_DEBIT_CAB_UBER_OPTION_ID = '7c4e6a10-b011-4cab-8001-010000000002';

/** Retired when cab pick-one shipped (see drizzle/0005_boi_debit_cab_pick_one.sql). */
export const BOI_SELECT_DEBIT_CAB_UBER_BENEFIT_ID = '899823cc-b1d4-43b3-aaf0-828611fe5fb6';

export interface CabOfferLike {
  benefitType: string;
  benefitProvider: string | null;
  exactBenefit: string;
  frequency: string;
  instanceCount: number;
  defaultCashValue: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  options: readonly {
    provider: string;
    offerName: string;
    cashValue: number | null;
    portalOfferId: number | null;
  }[];
}

const CAB_TYPES = /^(cab services|travel)$/i;
const CAB_PROVIDER = /^(ola|uber)$/i;

/** Loosely match BOI Select Debit catalog cards (display name omits "Debit" on some rows). */
export function isBoiSelectDebitCatalogCard(displayName: string): boolean {
  const n = displayName.toLowerCase();
  const isBoi = n.includes('bank of india') || /\bboi\b/.test(n);
  if (!isBoi || !n.includes('select')) return false;
  if (n.includes('credit')) return false;
  return n.includes('debit') || !n.includes('credit');
}

function isStandaloneOlaUberCab(b: CabOfferLike): boolean {
  return (
    CAB_TYPES.test(b.benefitType.trim()) &&
    b.benefitProvider != null &&
    CAB_PROVIDER.test(b.benefitProvider.trim()) &&
    b.options.length === 0
  );
}

/**
 * Portal import lists Ola and Uber as separate Cab/Travel offers for BOI Select Debit.
 * Product rule: one quarterly redemption, chosen per period (same as spa pick-one).
 */
export function mergeBoiSelectDebitOlaUberCab<T extends CabOfferLike>(benefits: T[]): T[] {
  const cabOffers = benefits.filter(isStandaloneOlaUberCab);
  if (cabOffers.length !== 2) return benefits;
  const providers = new Set(cabOffers.map((b) => b.benefitProvider!.trim().toLowerCase()));
  if (!providers.has('ola') || !providers.has('uber')) return benefits;

  const ola = cabOffers.find((b) => b.benefitProvider!.toLowerCase().startsWith('ola'))!;
  const uber = cabOffers.find((b) => b.benefitProvider!.toLowerCase().startsWith('uber'))!;
  const rest = benefits.filter((b) => !cabOffers.includes(b));
  const values = [ola.defaultCashValue, uber.defaultCashValue].filter((v): v is number => v != null);
  const merged = {
    benefitType: ola.benefitType,
    benefitProvider: null,
    exactBenefit: 'Any one of 2 offers',
    frequency: ola.frequency,
    instanceCount: Math.max(ola.instanceCount, uber.instanceCount, 1),
    defaultCashValue: values.length ? Math.max(...values) : null,
    effectiveFrom: [ola.effectiveFrom, uber.effectiveFrom].sort()[0],
    effectiveTo: null,
    options: [
      {
        provider: ola.benefitProvider!.trim(),
        offerName: ola.exactBenefit,
        cashValue: ola.defaultCashValue,
        portalOfferId: null,
      },
      {
        provider: uber.benefitProvider!.trim(),
        offerName: uber.exactBenefit,
        cashValue: uber.defaultCashValue,
        portalOfferId: null,
      },
    ].sort((a, b) => a.provider.localeCompare(b.provider)),
  } as unknown as T;

  return [...rest, merged];
}

/**
 * Ensures database consistency for BOI RuPay Select Debit cab pick-one benefits:
 * 1. Guarantees catalog version has benefit_provider = NULL and exact_benefit = 'Any one of 2 offers'.
 * 2. Ensures Ola & Uber options exist for that version in benefit_options.
 * 3. Merges duplicate instances on cards sharing this benefit.
 * 4. Repoints any orphaned instances from retired standalone Uber benefit to the pick-one benefit.
 * 5. Clears chosen_option_id for any 'Not Ordered' instances without a booking ID so they show "Any one of 2 offers".
 */
export async function healBoiDebitCabInstances(tx: Database, workspaceId: string): Promise<void> {
  const [ver] = await tx
    .select({ id: benefitCatalogVersions.id })
    .from(benefitCatalogVersions)
    .where(eq(benefitCatalogVersions.id, BOI_SELECT_DEBIT_CAB_VERSION_ID));
  if (!ver) return;

  await tx.execute(sql`
    UPDATE "app"."benefit_catalog_versions"
    SET
      "benefit_provider" = NULL,
      "exact_benefit" = 'Any one of 2 offers',
      "default_cash_value" = COALESCE("default_cash_value", '100.00')
    WHERE "id" = ${BOI_SELECT_DEBIT_CAB_VERSION_ID}::uuid;
  `);

  await tx.execute(sql`
    INSERT INTO "app"."benefit_options" ("id", "version_id", "provider", "offer_name", "cash_value", "sort_order")
    VALUES
      (${BOI_SELECT_DEBIT_CAB_OLA_OPTION_ID}::uuid, ${BOI_SELECT_DEBIT_CAB_VERSION_ID}::uuid, 'Ola', 'Instant Gift Card - INR 100', '100.00', 0),
      (${BOI_SELECT_DEBIT_CAB_UBER_OPTION_ID}::uuid, ${BOI_SELECT_DEBIT_CAB_VERSION_ID}::uuid, 'Uber', 'Redeemable Coupon - INR 100', '100.00', 1)
    ON CONFLICT ("version_id", "provider", "offer_name") DO NOTHING;
  `);

  await tx.execute(sql`
    WITH "paired" AS (
      SELECT
        o."id" AS "ola_id",
        u."id" AS "uber_id",
        (CASE o."order_status"
          WHEN 'Not Ordered' THEN 1
          WHEN 'Ordered but Coupon not received' THEN 2
          WHEN 'Coupon Received' THEN 3
          WHEN 'Skipped' THEN 4
          WHEN 'Coupon Redeemed' THEN 5
          WHEN 'Withdrawn' THEN 6
          ELSE 0
        END) AS "ola_rank",
        (CASE u."order_status"
          WHEN 'Not Ordered' THEN 1
          WHEN 'Ordered but Coupon not received' THEN 2
          WHEN 'Coupon Received' THEN 3
          WHEN 'Skipped' THEN 4
          WHEN 'Coupon Redeemed' THEN 5
          WHEN 'Withdrawn' THEN 6
          ELSE 0
        END) AS "uber_rank",
        o."rupay_booking_id" AS "ola_booking",
        u."rupay_booking_id" AS "uber_booking"
      FROM "app"."benefit_instances" o
      INNER JOIN "app"."benefit_instances" u
        ON u."card_id" = o."card_id"
       AND u."period_start" = o."period_start"
       AND u."instance_number" = o."instance_number"
       AND u."benefit_id" = ${BOI_SELECT_DEBIT_CAB_UBER_BENEFIT_ID}::uuid
      WHERE o."benefit_id" = ${BOI_SELECT_DEBIT_CAB_BENEFIT_ID}::uuid
        AND o."workspace_id" = ${workspaceId}::uuid
    ),
    "decision" AS (
      SELECT
        "ola_id",
        "uber_id",
        CASE
          WHEN "uber_rank" > "ola_rank" THEN "uber_id"
          WHEN "ola_rank" > "uber_rank" THEN "ola_id"
          WHEN "uber_booking" IS NOT NULL AND "ola_booking" IS NULL THEN "uber_id"
          WHEN "ola_booking" IS NOT NULL AND "uber_booking" IS NULL THEN "ola_id"
          ELSE "ola_id"
        END AS "keep_id",
        CASE
          WHEN "uber_rank" > "ola_rank" THEN "uber_id"
          WHEN "ola_rank" > "uber_rank" THEN "ola_id"
          WHEN "uber_booking" IS NOT NULL AND "ola_booking" IS NULL THEN "uber_id"
          WHEN "ola_booking" IS NOT NULL AND "uber_booking" IS NULL THEN "ola_id"
          ELSE "ola_id"
        END = "uber_id" AS "keep_is_uber",
        GREATEST("ola_rank", "uber_rank") AS "best_rank"
      FROM "paired"
    ),
    "updated" AS (
      UPDATE "app"."benefit_instances" i
      SET
        "benefit_id" = ${BOI_SELECT_DEBIT_CAB_BENEFIT_ID}::uuid,
        "generated_from_version" = ${BOI_SELECT_DEBIT_CAB_VERSION_ID}::uuid,
        "chosen_option_id" = CASE
          WHEN d."best_rank" > 1 AND d."keep_is_uber" THEN ${BOI_SELECT_DEBIT_CAB_UBER_OPTION_ID}::uuid
          WHEN d."best_rank" > 1 AND NOT d."keep_is_uber" THEN ${BOI_SELECT_DEBIT_CAB_OLA_OPTION_ID}::uuid
          ELSE NULL
        END
      FROM "decision" d
      WHERE i."id" = d."keep_id"
      RETURNING d."ola_id", d."uber_id", d."keep_id"
    )
    DELETE FROM "app"."benefit_instances" i
    USING "decision" d
    WHERE i."id" IN (d."ola_id", d."uber_id") AND i."id" <> d."keep_id";
  `);

  await tx.execute(sql`
    UPDATE "app"."benefit_instances"
    SET
      "benefit_id" = ${BOI_SELECT_DEBIT_CAB_BENEFIT_ID}::uuid,
      "generated_from_version" = ${BOI_SELECT_DEBIT_CAB_VERSION_ID}::uuid,
      "chosen_option_id" = CASE
        WHEN "order_status" <> 'Not Ordered' OR "rupay_booking_id" IS NOT NULL
          THEN ${BOI_SELECT_DEBIT_CAB_UBER_OPTION_ID}::uuid
        ELSE NULL
      END
    WHERE "benefit_id" = ${BOI_SELECT_DEBIT_CAB_UBER_BENEFIT_ID}::uuid
      AND "workspace_id" = ${workspaceId}::uuid;
  `);

  await tx.execute(sql`
    UPDATE "app"."benefit_instances"
    SET "chosen_option_id" = NULL
    WHERE "generated_from_version" = ${BOI_SELECT_DEBIT_CAB_VERSION_ID}::uuid
      AND "workspace_id" = ${workspaceId}::uuid
      AND "order_status" = 'Not Ordered'
      AND "rupay_booking_id" IS NULL
      AND "chosen_option_id" IS NOT NULL;
  `);
}
