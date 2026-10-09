CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."bank_card_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_name" text NOT NULL,
	"card_type" text NOT NULL,
	"network" text DEFAULT 'RuPay' NOT NULL,
	"curation_status" text DEFAULT 'uncurated' NOT NULL,
	"active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "bank_card_types_bank_name_card_type_network_key" UNIQUE("bank_name","card_type","network"),
	CONSTRAINT "bank_card_types_curation_status_check" CHECK ("app"."bank_card_types"."curation_status" IN ('uncurated','curated','no_benefits'))
);
--> statement-breakpoint
CREATE TABLE "app"."benefit_catalog_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benefit_id" uuid NOT NULL,
	"benefit_type" text NOT NULL,
	"benefit_provider" text,
	"exact_benefit" text NOT NULL,
	"frequency" text NOT NULL,
	"instance_count" integer DEFAULT 1 NOT NULL,
	"default_cash_value" numeric(10, 2),
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "benefit_catalog_versions_id_benefit_id_key" UNIQUE("id","benefit_id"),
	CONSTRAINT "benefit_catalog_versions_frequency_check" CHECK ("app"."benefit_catalog_versions"."frequency" IN ('Annual','6 months','Quarterly','Monthly')),
	CONSTRAINT "benefit_catalog_versions_instance_count_check" CHECK ("app"."benefit_catalog_versions"."instance_count" >= 1),
	CONSTRAINT "benefit_catalog_versions_effective_range_check" CHECK ("app"."benefit_catalog_versions"."effective_to" IS NULL OR "app"."benefit_catalog_versions"."effective_to" >= "app"."benefit_catalog_versions"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "app"."benefit_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"bank_card_type_id" uuid NOT NULL,
	"benefit_id" uuid,
	"override_id" uuid,
	"generated_from_version" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"period_label" text NOT NULL,
	"instance_number" integer DEFAULT 1 NOT NULL,
	"order_status" text DEFAULT 'Not Ordered' NOT NULL,
	"sold_for" numeric(10, 2),
	"cash_value" numeric(10, 2),
	"order_date" date,
	"expiry_date" date,
	"order_deadline" date NOT NULL,
	"rupay_booking_id" text,
	"code_encrypted" text,
	"comments" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "benefit_instances_identity_key" UNIQUE NULLS NOT DISTINCT("card_id","benefit_id","override_id","period_start","instance_number"),
	CONSTRAINT "benefit_instances_instance_number_check" CHECK ("app"."benefit_instances"."instance_number" >= 1),
	CONSTRAINT "benefit_instances_order_status_check" CHECK ("app"."benefit_instances"."order_status" IN ('Not Ordered','Ordered but Coupon not received','Coupon Received','Coupon Redeemed','Skipped','Withdrawn')),
	CONSTRAINT "benefit_instances_one_source_check" CHECK (num_nonnulls("app"."benefit_instances"."benefit_id", "app"."benefit_instances"."override_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "app"."benefits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_card_type_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "benefits_id_bank_card_type_id_key" UNIQUE("id","bank_card_type_id")
);
--> statement-breakpoint
CREATE TABLE "app"."card_benefit_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"bank_card_type_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"benefit_id" uuid,
	"benefit_type" text,
	"benefit_provider" text,
	"exact_benefit" text,
	"frequency" text,
	"instance_count" integer,
	"default_cash_value" numeric(10, 2),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "card_benefit_overrides_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "card_benefit_overrides_workspace_id_card_id_id_key" UNIQUE("workspace_id","card_id","id"),
	CONSTRAINT "card_benefit_overrides_identity_key" UNIQUE NULLS NOT DISTINCT("card_id","kind","benefit_id","benefit_type","benefit_provider","exact_benefit"),
	CONSTRAINT "card_benefit_overrides_kind_check" CHECK ("app"."card_benefit_overrides"."kind" IN ('add','suppress')),
	CONSTRAINT "card_benefit_overrides_frequency_check" CHECK ("app"."card_benefit_overrides"."frequency" IS NULL OR "app"."card_benefit_overrides"."frequency" IN ('Annual','6 months','Quarterly','Monthly')),
	CONSTRAINT "card_benefit_overrides_instance_count_check" CHECK ("app"."card_benefit_overrides"."instance_count" IS NULL OR "app"."card_benefit_overrides"."instance_count" >= 1),
	CONSTRAINT "card_benefit_overrides_kind_shape_check" CHECK (("app"."card_benefit_overrides"."kind" = 'suppress' AND "app"."card_benefit_overrides"."benefit_id" IS NOT NULL AND "app"."card_benefit_overrides"."benefit_type" IS NULL)
        OR
        ("app"."card_benefit_overrides"."kind" = 'add' AND "app"."card_benefit_overrides"."benefit_id" IS NULL AND "app"."card_benefit_overrides"."benefit_type" IS NOT NULL AND "app"."card_benefit_overrides"."exact_benefit" IS NOT NULL AND "app"."card_benefit_overrides"."frequency" IS NOT NULL AND "app"."card_benefit_overrides"."instance_count" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."card_holders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "card_holders_workspace_id_name_key" UNIQUE("workspace_id","name"),
	CONSTRAINT "card_holders_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"holder_id" uuid NOT NULL,
	"bank_card_type_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"last_digits" text,
	"tracking_from" date DEFAULT CURRENT_DATE NOT NULL,
	"active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "cards_workspace_id_display_name_key" UNIQUE("workspace_id","display_name"),
	CONSTRAINT "cards_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "cards_workspace_id_id_bank_card_type_id_key" UNIQUE("workspace_id","id","bank_card_type_id")
);
--> statement-breakpoint
CREATE TABLE "app"."notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"holder_id" uuid NOT NULL,
	"email_enabled" boolean DEFAULT true,
	"days_before" integer[] DEFAULT '{7, 3, 1}',
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "notification_preferences_holder_id_key" UNIQUE("holder_id")
);
--> statement-breakpoint
CREATE TABLE "app"."reminder_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"reminder_type" text NOT NULL,
	"days_before" integer,
	"sent_at" timestamp with time zone DEFAULT now(),
	"channel" text DEFAULT 'email',
	CONSTRAINT "reminder_log_instance_id_reminder_type_days_before_key" UNIQUE("instance_id","reminder_type","days_before"),
	CONSTRAINT "reminder_log_reminder_type_check" CHECK ("app"."reminder_log"."reminder_type" IN ('expiry','order_lapse','stale_order'))
);
--> statement-breakpoint
CREATE TABLE "app"."system_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "system_admins_user_id_key" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "workspace_members_user_id_key" UNIQUE("user_id"),
	CONSTRAINT "workspace_members_role_check" CHECK ("app"."workspace_members"."role" IN ('admin','member'))
);
--> statement-breakpoint
CREATE TABLE "app"."workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "app"."benefit_catalog_versions" ADD CONSTRAINT "benefit_catalog_versions_benefit_id_benefits_id_fk" FOREIGN KEY ("benefit_id") REFERENCES "app"."benefits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD CONSTRAINT "benefit_instances_workspace_id_card_id_fkey" FOREIGN KEY ("workspace_id","card_id") REFERENCES "app"."cards"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD CONSTRAINT "benefit_instances_override_fkey" FOREIGN KEY ("workspace_id","card_id","override_id") REFERENCES "app"."card_benefit_overrides"("workspace_id","card_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD CONSTRAINT "benefit_instances_benefit_card_type_fkey" FOREIGN KEY ("benefit_id","bank_card_type_id") REFERENCES "app"."benefits"("id","bank_card_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD CONSTRAINT "benefit_instances_card_type_fkey" FOREIGN KEY ("workspace_id","card_id","bank_card_type_id") REFERENCES "app"."cards"("workspace_id","id","bank_card_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."benefit_instances" ADD CONSTRAINT "benefit_instances_version_fkey" FOREIGN KEY ("generated_from_version","benefit_id") REFERENCES "app"."benefit_catalog_versions"("id","benefit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."benefits" ADD CONSTRAINT "benefits_bank_card_type_id_bank_card_types_id_fk" FOREIGN KEY ("bank_card_type_id") REFERENCES "app"."bank_card_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."card_benefit_overrides" ADD CONSTRAINT "card_benefit_overrides_workspace_id_card_id_fkey" FOREIGN KEY ("workspace_id","card_id") REFERENCES "app"."cards"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."card_benefit_overrides" ADD CONSTRAINT "card_benefit_overrides_card_type_fkey" FOREIGN KEY ("workspace_id","card_id","bank_card_type_id") REFERENCES "app"."cards"("workspace_id","id","bank_card_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."card_benefit_overrides" ADD CONSTRAINT "card_benefit_overrides_benefit_type_fkey" FOREIGN KEY ("benefit_id","bank_card_type_id") REFERENCES "app"."benefits"("id","bank_card_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."card_holders" ADD CONSTRAINT "card_holders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cards" ADD CONSTRAINT "cards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cards" ADD CONSTRAINT "cards_bank_card_type_id_bank_card_types_id_fk" FOREIGN KEY ("bank_card_type_id") REFERENCES "app"."bank_card_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cards" ADD CONSTRAINT "cards_workspace_id_holder_id_fkey" FOREIGN KEY ("workspace_id","holder_id") REFERENCES "app"."card_holders"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification_preferences" ADD CONSTRAINT "notification_preferences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification_preferences" ADD CONSTRAINT "notification_preferences_workspace_id_holder_id_fkey" FOREIGN KEY ("workspace_id","holder_id") REFERENCES "app"."card_holders"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reminder_log" ADD CONSTRAINT "reminder_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reminder_log" ADD CONSTRAINT "reminder_log_instance_id_benefit_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "app"."benefit_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_benefit_catalog_versions_lookup" ON "app"."benefit_catalog_versions" USING btree ("benefit_id","effective_from","effective_to");