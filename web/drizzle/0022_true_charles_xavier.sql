CREATE TABLE "app"."ordering_queue_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"chosen_option_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ordering_queue_workspace_instance_key" UNIQUE("workspace_id","instance_id")
);
--> statement-breakpoint
ALTER TABLE "app"."ordering_queue_items" ADD CONSTRAINT "ordering_queue_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ordering_queue_items" ADD CONSTRAINT "ordering_queue_items_instance_id_benefit_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "app"."benefit_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ordering_queue_items" ADD CONSTRAINT "ordering_queue_items_chosen_option_id_benefit_options_id_fk" FOREIGN KEY ("chosen_option_id") REFERENCES "app"."benefit_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ordering_queue_position" ON "app"."ordering_queue_items" USING btree ("workspace_id","position");