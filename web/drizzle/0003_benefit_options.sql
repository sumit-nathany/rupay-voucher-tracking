CREATE TABLE "app"."benefit_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"offer_name" text NOT NULL,
	"cash_value" numeric(10, 2),
	"portal_offer_id" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "benefit_options_version_provider_offer_key" UNIQUE("version_id","provider","offer_name")
);
--> statement-breakpoint
ALTER TABLE "app"."bank_card_types" ADD COLUMN "portal_card_id" integer;--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD COLUMN "chosen_option_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."card_variants" ADD COLUMN "portal_card_type" integer;--> statement-breakpoint
ALTER TABLE "app"."benefit_options" ADD CONSTRAINT "benefit_options_version_id_benefit_catalog_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "app"."benefit_catalog_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_benefit_options_version" ON "app"."benefit_options" USING btree ("version_id");--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD CONSTRAINT "benefit_instances_chosen_option_id_benefit_options_id_fk" FOREIGN KEY ("chosen_option_id") REFERENCES "app"."benefit_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bank_card_types" ADD CONSTRAINT "bank_card_types_portal_card_id_key" UNIQUE("portal_card_id");--> statement-breakpoint
ALTER TABLE "app"."card_variants" ADD CONSTRAINT "card_variants_portal_card_type_key" UNIQUE("portal_card_type");--> statement-breakpoint
-- Hand-edited: portal variant numbers learned from getCardNames (docs/rupay-portal-api.md).
UPDATE "app"."card_variants" SET "portal_card_type" = 41 WHERE "name" = 'RuPay Select Debit Card';--> statement-breakpoint
UPDATE "app"."card_variants" SET "portal_card_type" = 42 WHERE "name" = 'RuPay Select Credit Card';
