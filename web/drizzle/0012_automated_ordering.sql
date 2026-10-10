-- Automated RuPay Ordering schema
CREATE TABLE IF NOT EXISTS app.automation_settings (
  workspace_id uuid PRIMARY KEY REFERENCES app.workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS app.portal_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE CASCADE,
  label text NOT NULL,
  credentials_encrypted text NOT NULL,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'paused', 'credentials_expired', 'challenge_required', 'portal_changed', 'needs_attention')),
  last_confirmed_order_at timestamptz,
  last_checked_at timestamptz,
  status_detail_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_accounts_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT portal_accounts_workspace_id_label_key UNIQUE (workspace_id, label)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS app.portal_card_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE CASCADE,
  portal_account_id uuid NOT NULL,
  card_id uuid NOT NULL,
  portal_card_id text NOT NULL,
  portal_cardbin_id text,
  portal_card_label text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_card_mappings_workspace_card_key UNIQUE (workspace_id, card_id),
  CONSTRAINT portal_card_mappings_account_card_key UNIQUE (portal_account_id, card_id),
  FOREIGN KEY (workspace_id, portal_account_id) REFERENCES app.portal_accounts(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, card_id) REFERENCES app.cards(workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS app.ordering_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE CASCADE,
  portal_account_id uuid NOT NULL,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ordering_rules_account_name_key UNIQUE (portal_account_id, name),
  FOREIGN KEY (workspace_id, portal_account_id) REFERENCES app.portal_accounts(workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS app.ordering_rule_cards (
  rule_id uuid NOT NULL REFERENCES app.ordering_rules(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES app.cards(id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, card_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS app.ordering_rule_benefits (
  rule_id uuid NOT NULL REFERENCES app.ordering_rules(id) ON DELETE CASCADE,
  benefit_id uuid NOT NULL REFERENCES app.benefits(id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, benefit_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS app.ordering_rule_option_defaults (
  rule_id uuid NOT NULL REFERENCES app.ordering_rules(id) ON DELETE CASCADE,
  benefit_id uuid NOT NULL REFERENCES app.benefits(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES app.benefit_options(id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, benefit_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS app.ordering_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  accounts_processed integer NOT NULL DEFAULT 0,
  orders_confirmed integer NOT NULL DEFAULT 0,
  orders_failed integer NOT NULL DEFAULT 0,
  failure_code text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS app.portal_order_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_run_id uuid REFERENCES app.ordering_job_runs(id) ON DELETE SET NULL,
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE CASCADE,
  portal_account_id uuid NOT NULL,
  rule_id uuid REFERENCES app.ordering_rules(id) ON DELETE SET NULL,
  instance_id uuid NOT NULL REFERENCES app.benefit_instances(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('reserved', 'submitting', 'confirmed', 'failed_pre_submit', 'uncertain', 'resolved_no_order', 'cancelled')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  submission_started_at timestamptz,
  finished_at timestamptz,
  lease_expires_at timestamptz,
  booking_reference text,
  failure_code text,
  FOREIGN KEY (workspace_id, portal_account_id) REFERENCES app.portal_accounts(workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS portal_order_attempts_active_instance_key ON app.portal_order_attempts (instance_id) WHERE state IN ('reserved', 'submitting', 'confirmed', 'uncertain');
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS portal_order_attempts_active_account_key ON app.portal_order_attempts (portal_account_id) WHERE state IN ('reserved', 'submitting');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS portal_order_attempts_account_submission_idx ON app.portal_order_attempts (portal_account_id, submission_started_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS portal_order_attempts_workspace_instance_idx ON app.portal_order_attempts (workspace_id, instance_id);
--> statement-breakpoint
DO $lockdown$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM %I', r);
    END IF;
  END LOOP;
END
$lockdown$;
