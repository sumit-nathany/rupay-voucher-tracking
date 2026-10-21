ALTER TABLE "app"."benefit_instances" ADD COLUMN "portal_refusal" text;--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD COLUMN "portal_refusal_source" text;--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD COLUMN "portal_refusal_detail" text;--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD COLUMN "portal_refusal_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD CONSTRAINT "benefit_instances_portal_refusal_check" CHECK ("app"."benefit_instances"."portal_refusal" IS NULL OR "app"."benefit_instances"."portal_refusal" IN ('benefit_unavailable','card_limit_reached','already_ordered'));--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD CONSTRAINT "benefit_instances_portal_refusal_source_check" CHECK ("app"."benefit_instances"."portal_refusal_source" IS NULL OR "app"."benefit_instances"."portal_refusal_source" IN ('rupay_portal','bank'));