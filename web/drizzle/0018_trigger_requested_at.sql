ALTER TABLE app.automation_settings ADD COLUMN IF NOT EXISTS trigger_requested_at timestamp with time zone;
