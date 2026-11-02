ALTER TABLE "app"."portal_accounts" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."portal_accounts" ADD COLUMN "automation_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "app"."portal_accounts" SET "active" = false, "automation_enabled" = false WHERE "status" = 'paused';