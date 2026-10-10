ALTER TABLE "app"."benefit_catalog_versions" ADD COLUMN "offer_kind" text DEFAULT 'voucher' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."benefit_catalog_versions" ADD CONSTRAINT "benefit_catalog_versions_offer_kind_check" CHECK ("offer_kind" IN ('voucher', 'discount'));--> statement-breakpoint
ALTER TABLE "app"."card_benefit_overrides" ADD COLUMN "offer_kind" text DEFAULT 'voucher' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."card_benefit_overrides" ADD CONSTRAINT "card_benefit_overrides_offer_kind_check" CHECK ("offer_kind" IN ('voucher', 'discount'));--> statement-breakpoint
UPDATE "app"."benefit_catalog_versions" SET "offer_kind" = 'discount'
WHERE lower(coalesce("benefit_provider", '') || ' ' || "exact_benefit" || ' ' || "benefit_type") LIKE '%bookmyshow%'
   OR lower(coalesce("benefit_provider", '') || ' ' || "exact_benefit" || ' ' || "benefit_type") LIKE '%makemytrip%'
   OR lower(coalesce("benefit_provider", '') || ' ' || "exact_benefit" || ' ' || "benefit_type") LIKE '%taxspanner%'
   OR lower(coalesce("benefit_provider", '') || ' ' || "exact_benefit" || ' ' || "benefit_type") LIKE '%tax spanner%'
   OR lower("exact_benefit") LIKE '%instant discount%'
   OR lower("exact_benefit") LIKE '%flat rs%discount%';
