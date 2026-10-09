CREATE TABLE "app"."card_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "card_variants_name_key" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "app"."bank_card_types" ALTER COLUMN "bank_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."bank_card_types" ALTER COLUMN "card_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."bank_card_types" ADD COLUMN "display_name" text;--> statement-breakpoint
-- Hand-edited: backfill existing (spreadsheet-seeded) rows before enforcing NOT NULL.
UPDATE "app"."bank_card_types" SET "display_name" = trim(concat_ws(' ', "bank_name", "card_type"));--> statement-breakpoint
ALTER TABLE "app"."bank_card_types" ALTER COLUMN "display_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."bank_card_types" ADD COLUMN "variant_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."bank_card_types" ADD CONSTRAINT "bank_card_types_variant_id_card_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "app"."card_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bank_card_types" ADD CONSTRAINT "bank_card_types_variant_display_name_key" UNIQUE NULLS NOT DISTINCT("variant_id","display_name");--> statement-breakpoint
-- Hand-edited: starting variants. Admins add/rename more (e.g. Platinum) from the admin page.
INSERT INTO "app"."card_variants" ("name", "sort_order") VALUES
	('RuPay Select Debit Card', 10),
	('RuPay Select Credit Card', 20)
ON CONFLICT ("name") DO NOTHING;
