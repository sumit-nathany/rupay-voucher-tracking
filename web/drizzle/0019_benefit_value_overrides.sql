CREATE TABLE IF NOT EXISTS "app"."benefit_value_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"benefit_name" text NOT NULL,
	"benefit_type" text,
	"benefit_provider" text,
	"benefit_id" uuid,
	"custom_value" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "benefit_value_overrides_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "benefit_value_overrides_workspace_benefit_name_key" UNIQUE("workspace_id","benefit_name"),
	CONSTRAINT "benefit_value_overrides_custom_value_check" CHECK ("app"."benefit_value_overrides"."custom_value" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."benefit_value_overrides" ADD CONSTRAINT "benefit_value_overrides_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_benefit_value_overrides_name" ON "app"."benefit_value_overrides" ("workspace_id", lower(trim("benefit_name")));
