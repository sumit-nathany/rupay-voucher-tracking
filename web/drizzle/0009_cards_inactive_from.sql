-- Add inactive_from column to app.cards
ALTER TABLE "app"."cards" ADD COLUMN IF NOT EXISTS "inactive_from" date;

-- For existing inactive cards without inactive_from set, default to 2026-07-01
UPDATE "app"."cards"
SET "inactive_from" = '2026-07-01'
WHERE "active" = false AND "inactive_from" IS NULL;

-- Remove non-ordered benefits for inactive cards from their inactive_from date onwards
DELETE FROM "app"."benefit_instances" bi
USING "app"."cards" c
WHERE bi.card_id = c.id
  AND c.active = false
  AND c.inactive_from IS NOT NULL
  AND bi.period_end >= c.inactive_from
  AND bi.rupay_booking_id IS NULL
  AND bi.code_encrypted IS NULL
  AND bi.order_status IN ('Not Ordered', 'Withdrawn', 'Skipped');
