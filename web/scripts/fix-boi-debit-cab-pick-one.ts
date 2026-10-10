/**
 * Retrospective data fix for BOI Select Debit Ola/Uber cab pick-one benefit.
 *
 * 1. Ensures catalog version has benefit_provider = NULL and exact_benefit = 'Any one of 2 offers'.
 * 2. Ensures Ola & Uber benefit options exist.
 * 3. Deletes any leftover orphaned/withdrawn instances of the retired standalone Uber benefit.
 * 4. Merges any paired Ola/Uber instances, keeping booking ID/advanced status and setting chosen_option_id only if ordered.
 * 5. Clears chosen_option_id (to NULL) for all un-ordered Cab Services instances so they correctly display "Any one of 2 offers".
 * 6. Restores any accidentally withdrawn un-ordered Cab Services instances to 'Not Ordered'.
 *
 * Usage (from web/):
 *   DATABASE_URL="<connection_string>" npx tsx scripts/fix-boi-debit-cab-pick-one.ts
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

export const BOI_SELECT_DEBIT_CAB_BENEFIT_ID = '54a0d991-3147-40b4-8bc7-15cac91e9089';
export const BOI_SELECT_DEBIT_CAB_VERSION_ID = '8e7921d8-f039-4f00-b069-976973aa1fe3';
export const BOI_SELECT_DEBIT_CAB_OLA_OPTION_ID = '7c4e6a10-b011-4cab-8001-010000000001';
export const BOI_SELECT_DEBIT_CAB_UBER_OPTION_ID = '7c4e6a10-b011-4cab-8001-010000000002';
export const BOI_SELECT_DEBIT_CAB_UBER_BENEFIT_ID = '899823cc-b1d4-43b3-aaf0-828611fe5fb6';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  console.log('Running BOI Select Debit Cab Services retrospective data fix...');

  // 1. Catalog fix
  await db.execute(sql`
    UPDATE "app"."benefit_catalog_versions"
    SET
      "benefit_provider" = NULL,
      "exact_benefit" = 'Any one of 2 offers',
      "default_cash_value" = COALESCE("default_cash_value", '100.00')
    WHERE "id" = ${BOI_SELECT_DEBIT_CAB_VERSION_ID}::uuid;
  `);

  // 2. Ensure options
  await db.execute(sql`
    INSERT INTO "app"."benefit_options" ("id", "version_id", "provider", "offer_name", "cash_value", "sort_order")
    VALUES
      (${BOI_SELECT_DEBIT_CAB_OLA_OPTION_ID}::uuid, ${BOI_SELECT_DEBIT_CAB_VERSION_ID}::uuid, 'Ola', 'Instant Gift Card - INR 100', '100.00', 0),
      (${BOI_SELECT_DEBIT_CAB_UBER_OPTION_ID}::uuid, ${BOI_SELECT_DEBIT_CAB_VERSION_ID}::uuid, 'Uber', 'Redeemable Coupon - INR 100', '100.00', 1)
    ON CONFLICT ("version_id", "provider", "offer_name") DO NOTHING;
  `);

  // 3. Merge paired instances where both Ola and retired Uber existed for the same card & period
  const merged = await db.execute(sql`
    WITH "paired" AS (
      SELECT
        o."id" AS "ola_id",
        u."id" AS "uber_id",
        (CASE o."order_status"
          WHEN 'Ordered but Coupon not received' THEN 1
          WHEN 'Coupon Received' THEN 2
          WHEN 'Coupon Redeemed' THEN 3
          ELSE 0
        END) AS "ola_action_rank",
        (CASE u."order_status"
          WHEN 'Ordered but Coupon not received' THEN 1
          WHEN 'Coupon Received' THEN 2
          WHEN 'Coupon Redeemed' THEN 3
          ELSE 0
        END) AS "uber_action_rank",
        o."rupay_booking_id" AS "ola_booking",
        u."rupay_booking_id" AS "uber_booking"
      FROM "app"."benefit_instances" o
      INNER JOIN "app"."benefit_instances" u
        ON u."card_id" = o."card_id"
       AND u."period_start" = o."period_start"
       AND u."instance_number" = o."instance_number"
       AND u."benefit_id" = ${BOI_SELECT_DEBIT_CAB_UBER_BENEFIT_ID}::uuid
      WHERE o."benefit_id" = ${BOI_SELECT_DEBIT_CAB_BENEFIT_ID}::uuid
    ),
    "decision" AS (
      SELECT
        "ola_id",
        "uber_id",
        CASE
          WHEN "uber_action_rank" > "ola_action_rank" THEN "uber_id"
          WHEN "ola_action_rank" > "uber_action_rank" THEN "ola_id"
          WHEN "uber_booking" IS NOT NULL AND "ola_booking" IS NULL THEN "uber_id"
          WHEN "ola_booking" IS NOT NULL AND "uber_booking" IS NULL THEN "ola_id"
          ELSE "ola_id"
        END AS "keep_id",
        CASE
          WHEN "uber_action_rank" > "ola_action_rank" THEN true
          WHEN "ola_action_rank" > "uber_action_rank" THEN false
          WHEN "uber_booking" IS NOT NULL AND "ola_booking" IS NULL THEN true
          ELSE false
        END AS "keep_is_uber",
        GREATEST("ola_action_rank", "uber_action_rank") AS "best_action_rank",
        COALESCE("uber_booking", "ola_booking") AS "booking_id"
      FROM "paired"
    ),
    "updated" AS (
      UPDATE "app"."benefit_instances" i
      SET
        "benefit_id" = ${BOI_SELECT_DEBIT_CAB_BENEFIT_ID}::uuid,
        "generated_from_version" = ${BOI_SELECT_DEBIT_CAB_VERSION_ID}::uuid,
        "chosen_option_id" = CASE
          WHEN (d."best_action_rank" > 0 OR d."booking_id" IS NOT NULL) AND d."keep_is_uber"
            THEN ${BOI_SELECT_DEBIT_CAB_UBER_OPTION_ID}::uuid
          WHEN (d."best_action_rank" > 0 OR d."booking_id" IS NOT NULL) AND NOT d."keep_is_uber"
            THEN ${BOI_SELECT_DEBIT_CAB_OLA_OPTION_ID}::uuid
          ELSE NULL
        END,
        "order_status" = CASE
          WHEN d."best_action_rank" = 0 AND d."booking_id" IS NULL AND i."order_status" = 'Withdrawn'
            THEN 'Not Ordered'
          ELSE i."order_status"
        END
      FROM "decision" d
      WHERE i."id" = d."keep_id"
      RETURNING d."ola_id", d."uber_id", d."keep_id"
    )
    DELETE FROM "app"."benefit_instances" i
    USING "decision" d
    WHERE i."id" IN (d."ola_id", d."uber_id") AND i."id" <> d."keep_id"
    RETURNING i."id";
  `);
  console.log('Merged paired duplicate instances:', merged.length);

  // 4. Delete any remaining un-ordered / withdrawn instances of the retired standalone Uber benefit
  const deletedRetiredUber = await db.execute(sql`
    DELETE FROM "app"."benefit_instances"
    WHERE "benefit_id" = ${BOI_SELECT_DEBIT_CAB_UBER_BENEFIT_ID}::uuid
      AND "rupay_booking_id" IS NULL
      AND ("order_status" IN ('Not Ordered', 'Withdrawn', 'Skipped') OR "code_encrypted" IS NULL)
    RETURNING "id";
  `);
  console.log('Deleted orphaned retired Uber instances:', deletedRetiredUber.length);

  // 5. Repoint any remaining ordered standalone Uber instances (if any exist with booking ID)
  const repointedOrderedUber = await db.execute(sql`
    UPDATE "app"."benefit_instances"
    SET
      "benefit_id" = ${BOI_SELECT_DEBIT_CAB_BENEFIT_ID}::uuid,
      "generated_from_version" = ${BOI_SELECT_DEBIT_CAB_VERSION_ID}::uuid,
      "chosen_option_id" = ${BOI_SELECT_DEBIT_CAB_UBER_OPTION_ID}::uuid
    WHERE "benefit_id" = ${BOI_SELECT_DEBIT_CAB_UBER_BENEFIT_ID}::uuid
    RETURNING "id";
  `);
  console.log('Repointed ordered retired Uber instances:', repointedOrderedUber.length);

  // 6. Reset chosen_option_id to NULL on un-ordered Cab Services instances
  const clearedChoices = await db.execute(sql`
    UPDATE "app"."benefit_instances"
    SET
      "chosen_option_id" = NULL,
      "order_status" = CASE WHEN "order_status" = 'Withdrawn' THEN 'Not Ordered' ELSE "order_status" END
    WHERE "benefit_id" = ${BOI_SELECT_DEBIT_CAB_BENEFIT_ID}::uuid
      AND "rupay_booking_id" IS NULL
      AND "order_status" IN ('Not Ordered', 'Withdrawn', 'Skipped')
      AND "chosen_option_id" IS NOT NULL
    RETURNING "id";
  `);
  console.log('Cleared chosen_option_id on un-ordered Cab Services instances:', clearedChoices.length);

  // 7. Ensure retired standalone Uber version ended on 2026-09-30 so Q4 never regenerates it
  await db.execute(sql`
    UPDATE "app"."benefit_catalog_versions"
    SET "effective_to" = '2026-09-30'
    WHERE "id" = 'ee5ab49a-cd4a-4b84-97b0-8d45d6d2641b';

    DELETE FROM "app"."benefit_instances"
    WHERE "benefit_id" = ${BOI_SELECT_DEBIT_CAB_UBER_BENEFIT_ID}::uuid
      AND "period_start" >= '2026-10-01'::date;
  `);

  console.log('Retrospective fix completed successfully.');
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
