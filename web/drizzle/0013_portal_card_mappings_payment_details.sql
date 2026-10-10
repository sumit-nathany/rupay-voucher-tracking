ALTER TABLE app.portal_card_mappings ALTER COLUMN portal_card_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE app.portal_card_mappings ADD COLUMN IF NOT EXISTS payment_details_encrypted text;
