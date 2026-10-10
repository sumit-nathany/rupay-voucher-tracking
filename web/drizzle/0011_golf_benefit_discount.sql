UPDATE "app"."benefit_catalog_versions"
SET "offer_kind" = 'discount'
WHERE "benefit_type" ILIKE '%golf%'
   OR "exact_benefit" ILIKE '%golf%'
   OR coalesce("benefit_provider", '') ILIKE '%golf%';
--> statement-breakpoint
UPDATE "app"."card_benefit_overrides"
SET "offer_kind" = 'discount'
WHERE "benefit_type" ILIKE '%golf%'
   OR "exact_benefit" ILIKE '%golf%'
   OR coalesce("benefit_provider", '') ILIKE '%golf%';
