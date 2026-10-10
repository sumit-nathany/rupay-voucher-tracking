ALTER TABLE "app"."portal_accounts" ADD COLUMN IF NOT EXISTS "cooldown_until" timestamp with time zone;
