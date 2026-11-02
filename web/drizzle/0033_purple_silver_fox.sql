CREATE TABLE "app"."portal_order_preorder_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"message_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"selected_option_id" uuid,
	"selected_option_name" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."portal_order_preorder_sessions" ADD CONSTRAINT "portal_order_preorder_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."portal_order_preorder_sessions" ADD CONSTRAINT "portal_order_preorder_sessions_instance_id_benefit_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "app"."benefit_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_order_preorder_sessions_status_idx" ON "app"."portal_order_preorder_sessions" USING btree ("status","expires_at");