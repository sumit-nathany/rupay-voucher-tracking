ALTER TABLE "app"."cards" DROP CONSTRAINT IF EXISTS "cards_workspace_id_display_name_key";--> statement-breakpoint
UPDATE "app"."cards" SET "last_digits" = '0000' WHERE "last_digits" IS NULL;--> statement-breakpoint
ALTER TABLE "app"."cards" ALTER COLUMN "last_digits" SET DEFAULT '0000';--> statement-breakpoint
ALTER TABLE "app"."cards" ALTER COLUMN "last_digits" SET NOT NULL;
