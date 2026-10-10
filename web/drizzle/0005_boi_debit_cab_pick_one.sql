-- BOI RuPay Select Debit: Cab Services (portal "Travel") Ola + Uber -> one pick-one benefit.
-- No-op when this catalog row is absent (e.g. empty PGlite test DB).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "app"."benefit_catalog_versions" WHERE "id" = '8e7921d8-f039-4f00-b069-976973aa1fe3'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO "app"."benefit_options" ("id", "version_id", "provider", "offer_name", "cash_value", "portal_offer_id", "sort_order")
  VALUES
    ('7c4e6a10-b011-4cab-8001-010000000001', '8e7921d8-f039-4f00-b069-976973aa1fe3', 'Ola', 'Instant Gift Card - INR 100', '100.00', NULL, 0),
    ('7c4e6a10-b011-4cab-8001-010000000002', '8e7921d8-f039-4f00-b069-976973aa1fe3', 'Uber', 'Redeemable Coupon - INR 100', '100.00', NULL, 1)
  ON CONFLICT ON CONSTRAINT "benefit_options_version_provider_offer_key" DO NOTHING;

  UPDATE "app"."benefit_catalog_versions"
  SET
    "benefit_provider" = NULL,
    "exact_benefit" = 'Any one of 2 offers',
    "default_cash_value" = '100.00'
  WHERE "id" = '8e7921d8-f039-4f00-b069-976973aa1fe3';

  UPDATE "app"."benefit_catalog_versions"
  SET "effective_to" = '2026-10-09'
  WHERE "id" = 'ee5ab49a-cd4a-4b84-97b0-8d45d6d2641b'
    AND "effective_to" IS NULL;

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
     AND u."benefit_id" = '899823cc-b1d4-43b3-aaf0-828611fe5fb6'
    WHERE o."benefit_id" = '54a0d991-3147-40b4-8bc7-15cac91e9089'
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
  )
  UPDATE "app"."benefit_instances" i
  SET
    "benefit_id" = '54a0d991-3147-40b4-8bc7-15cac91e9089',
    "generated_from_version" = '8e7921d8-f039-4f00-b069-976973aa1fe3',
    "chosen_option_id" = CASE
      WHEN d."best_rank" > 1 AND d."keep_is_uber" THEN '7c4e6a10-b011-4cab-8001-010000000002'::uuid
      WHEN d."best_rank" > 1 AND NOT d."keep_is_uber" THEN '7c4e6a10-b011-4cab-8001-010000000001'::uuid
      ELSE NULL
    END
  FROM "decision" d
  WHERE i."id" = d."keep_id";

  DELETE FROM "app"."benefit_instances" i
  USING (
    SELECT
      "ola_id",
      "uber_id",
      CASE
        WHEN "uber_rank" > "ola_rank" THEN "uber_id"
        WHEN "ola_rank" > "uber_rank" THEN "ola_id"
        WHEN "uber_booking" IS NOT NULL AND "ola_booking" IS NULL THEN "uber_id"
        WHEN "ola_booking" IS NOT NULL AND "uber_booking" IS NULL THEN "ola_id"
        ELSE "ola_id"
      END AS "keep_id"
    FROM (
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
       AND u."benefit_id" = '899823cc-b1d4-43b3-aaf0-828611fe5fb6'
      WHERE o."benefit_id" = '54a0d991-3147-40b4-8bc7-15cac91e9089'
    ) paired
  ) d
  WHERE i."id" IN (d."ola_id", d."uber_id") AND i."id" <> d."keep_id";

  UPDATE "app"."benefit_instances"
  SET
    "generated_from_version" = '8e7921d8-f039-4f00-b069-976973aa1fe3',
    "benefit_id" = '54a0d991-3147-40b4-8bc7-15cac91e9089'
  WHERE "benefit_id" = '54a0d991-3147-40b4-8bc7-15cac91e9089';
END $$;
