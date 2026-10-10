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

  -- 3. Repoint any instances from retired Uber benefit
  UPDATE "app"."benefit_instances"
  SET
    "benefit_id" = '54a0d991-3147-40b4-8bc7-15cac91e9089'::uuid,
    "generated_from_version" = '8e7921d8-f039-4f00-b069-976973aa1fe3'::uuid,
    "chosen_option_id" = CASE
      WHEN "order_status" <> 'Not Ordered' OR "rupay_booking_id" IS NOT NULL
        THEN '7c4e6a10-b011-4cab-8001-010000000002'::uuid
      ELSE NULL
    END
  WHERE "benefit_id" = '899823cc-b1d4-43b3-aaf0-828611fe5fb6'::uuid;

  -- 4. Clear chosen_option_id for any 'Not Ordered' instances without a booking ID
  UPDATE "app"."benefit_instances"
  SET "chosen_option_id" = NULL
  WHERE "generated_from_version" = '8e7921d8-f039-4f00-b069-976973aa1fe3'::uuid
    AND "order_status" = 'Not Ordered'
    AND "rupay_booking_id" IS NULL
    AND "chosen_option_id" IS NOT NULL;
END $$;
