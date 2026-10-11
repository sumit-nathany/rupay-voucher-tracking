ALTER TABLE app.automation_settings ADD COLUMN IF NOT EXISTS telegram_chat_id text;--> statement-breakpoint
ALTER TABLE app.portal_order_otp_challenges ADD COLUMN IF NOT EXISTS telegram_chat_id text;--> statement-breakpoint
ALTER TABLE app.portal_order_otp_challenges ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp';--> statement-breakpoint
ALTER TABLE app.portal_order_otp_challenges ALTER COLUMN phone_number DROP NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS portal_order_otp_challenges_telegram_pending_idx ON app.portal_order_otp_challenges USING btree (telegram_chat_id, status);

