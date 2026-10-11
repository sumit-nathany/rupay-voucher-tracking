ALTER TABLE app.portal_accounts ADD COLUMN IF NOT EXISTS phone_number text;

CREATE TABLE IF NOT EXISTS app.portal_order_otp_challenges (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	attempt_id uuid NOT NULL,
	portal_account_id uuid NOT NULL,
	phone_number text NOT NULL,
	status text DEFAULT 'pending' NOT NULL,
	otp_code text,
	message_id text,
	expires_at timestamp with time zone NOT NULL,
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	updated_at timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT portal_order_otp_challenges_status_check CHECK (status IN ('pending', 'received', 'expired', 'failed')),
	CONSTRAINT portal_order_otp_challenges_attempt_fkey FOREIGN KEY (attempt_id) REFERENCES app.portal_order_attempts(id) ON DELETE CASCADE,
	CONSTRAINT portal_order_otp_challenges_account_fkey FOREIGN KEY (portal_account_id) REFERENCES app.portal_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS portal_order_otp_challenges_phone_pending_idx ON app.portal_order_otp_challenges USING btree (phone_number, status);
