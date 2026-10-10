DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "app"."benefit_catalog_versions" WHERE "id" = '8e7921d8-f039-4f00-b069-976973aa1fe3'
  ) THEN
    RETURN;
  END IF;

  -- 1. Ensure the catalog version has benefit_provider = NULL and exact_benefit = 'Any one of 2 offers'
  UPDATE "app"."benefit_catalog_versions"
  SET
    "benefit_provider" = NULL,
    "exact_benefit" = 'Any one of 2 offers',
    "default_cash_value" = COALESCE("default_cash_value", '100.00')
  WHERE "id" = '8e7921d8-f039-4f00-b069-976973aa1fe3'::uuid;

  -- 2. Ensure options exist
  INSERT INTO "app"."benefit_options" ("id", "version_id", "provider", "offer_name", "cash_value", "sort_order")
  VALUES
    ('7c4e6a10-b011-4cab-8001-010000000001'::uuid, '8e7921d8-f039-4f00-b069-976973aa1fe3'::uuid, 'Ola', 'Instant Gift Card - INR 100', '100.00', 0),
    ('7c4e6a10-b011-4cab-8001-010000000002'::uuid, '8e7921d8-f039-4f00-b069-976973aa1fe3'::uuid, 'Uber', 'Redeemable Coupon - INR 100', '100.00', 1)
  ON CONFLICT ("version_id", "provider", "offer_name") DO NOTHING;

  -- 3. Merge paired instances where both Ola and retired Uber existed for the same card & period
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
     AND u."benefit_id" = '899823cc-b1d4-43b3-aaf0-828611fe5fb6'::uuid
    WHERE o."benefit_id" = '54a0d991-3147-40b4-8bc7-15cac91e9089'::uuid
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
      "benefit_id" = '54a0d991-3147-40b4-8bc7-15cac91e9089'::uuid,
      "generated_from_version" = '8e7921d8-f039-4f00-b069-976973aa1fe3'::uuid,
      "chosen_option_id" = CASE
        WHEN (d."best_action_rank" > 0 OR d."booking_id" IS NOT NULL) AND d."keep_is_uber"
          THEN '7c4e6a10-b011-4cab-8001-010000000002'::uuid
        WHEN (d."best_action_rank" > 0 OR d."booking_id" IS NOT NULL) AND NOT d."keep_is_uber"
          THEN '7c4e6a10-b011-4cab-8001-010000000001'::uuid
        ELSE NULL
      END,
      "order_status" = CASE
        WHEN d."best_action_rank" = 0 AND d."booking_id" IS NULL AND i."order_status" = 'Withdrawn'
          THEN 'Not Ordered'
        ELSE i."order_status"
      END
    FROM "decision" d
    WHERE i."id" = d."keep_id"
  )
  DELETE FROM "app"."benefit_instances" i
  USING "decision" d
  WHERE i."id" IN (d."ola_id", d."uber_id") AND i."id" <> d."keep_id";

  -- 4. Delete any remaining un-ordered / withdrawn instances of the retired standalone Uber benefit
  DELETE FROM "app"."benefit_instances"
  WHERE "benefit_id" = '899823cc-b1d4-43b3-aaf0-828611fe5fb6'::uuid
    AND "rupay_booking_id" IS NULL
    AND ("order_status" IN ('Not Ordered', 'Withdrawn', 'Skipped') OR "code_encrypted" IS NULL);

  -- 5. Repoint any remaining ordered standalone Uber instances (if any exist with booking ID)
  UPDATE "app"."benefit_instances"
  SET
    "benefit_id" = '54a0d991-3147-40b4-8bc7-15cac91e9089'::uuid,
    "generated_from_version" = '8e7921d8-f039-4f00-b069-976973aa1fe3'::uuid,
    "chosen_option_id" = '7c4e6a10-b011-4cab-8001-010000000002'::uuid
  WHERE "benefit_id" = '899823cc-b1d4-43b3-aaf0-828611fe5fb6'::uuid;

  -- 6. Reset chosen_option_id to NULL on un-ordered Cab Services instances
  UPDATE "app"."benefit_instances"
  SET
    "chosen_option_id" = NULL,
    "order_status" = CASE WHEN "order_status" = 'Withdrawn' THEN 'Not Ordered' ELSE "order_status" END
  WHERE "benefit_id" = '54a0d991-3147-40b4-8bc7-15cac91e9089'::uuid
    AND "rupay_booking_id" IS NULL
    AND "order_status" IN ('Not Ordered', 'Withdrawn', 'Skipped')
    AND "chosen_option_id" IS NOT NULL;

  -- 7. Ensure retired standalone Uber version ended on 2026-09-30 so Q4 never regenerates it
  UPDATE "app"."benefit_catalog_versions"
  SET "effective_to" = '2026-09-30'
  WHERE "id" = 'ee5ab49a-cd4a-4b84-97b0-8d45d6d2641b';

  DELETE FROM "app"."benefit_instances"
  WHERE "benefit_id" = '899823cc-b1d4-43b3-aaf0-828611fe5fb6'::uuid
    AND "period_start" >= '2026-10-01'::date;
END $$;
