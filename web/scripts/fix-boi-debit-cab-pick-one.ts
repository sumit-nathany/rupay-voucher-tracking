/**
 * Idempotent follow-up for drizzle/0005_boi_debit_cab_pick_one.sql.
 * Merges any remaining Ola/Uber duplicate instances on BOI Select Debit cab benefit.
 *
 * Usage (from web/): set -a && source .env.local && set +a && npx tsx scripts/fix-boi-debit-cab-pick-one.ts
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import {
  BOI_SELECT_DEBIT_CAB_BENEFIT_ID,
  BOI_SELECT_DEBIT_CAB_OLA_OPTION_ID,
  BOI_SELECT_DEBIT_CAB_UBER_BENEFIT_ID,
  BOI_SELECT_DEBIT_CAB_UBER_OPTION_ID,
  BOI_SELECT_DEBIT_CAB_VERSION_ID,
} from '../src/domain/boi-debit-cab-pick-one';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  const result = await db.execute(sql`
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
    WHERE i."id" IN (d."ola_id", d."uber_id") AND i."id" <> d."keep_id"
    RETURNING i."id"
  `);

  console.log('removed duplicate rows:', result.length);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
