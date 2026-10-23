ALTER TABLE "app"."benefit_instances" DROP CONSTRAINT "benefit_instances_identity_key";--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD COLUMN "archive_reason" text;--> statement-breakpoint
CREATE INDEX "idx_benefit_instances_archived" ON "app"."benefit_instances" USING btree ("archived");--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD CONSTRAINT "benefit_instances_identity_key" UNIQUE NULLS NOT DISTINCT("card_id","benefit_id","override_id","period_start","instance_number","archived");