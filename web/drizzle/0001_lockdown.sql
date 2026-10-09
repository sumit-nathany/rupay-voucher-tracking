-- Hand-written: PostgREST lockdown (PLAN.md Security model #1).
-- Primary lock: every table lives in the non-public "app" schema, which must
-- NOT be listed under Supabase "Exposed schemas". This migration adds
-- defense in depth so the schema stays closed even if it is ever exposed by
-- mistake, and so tables created by LATER migrations stay closed too.
-- Idempotent. Roles anon/authenticated only exist on Supabase, so each is
-- guarded (plain local Postgres skips them).
DO $lockdown$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES    IN SCHEMA app FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM %I', r);
      EXECUTE format('REVOKE ALL ON SCHEMA app FROM %I', r);  -- includes USAGE

      -- Later migrations run as the current role; keep new objects locked.
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES    FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON FUNCTIONS FROM %I', r);

      -- Supabase's own default privileges are defined FOR ROLE postgres; cover
      -- that role explicitly when it is not the current one.
      IF current_user <> 'postgres' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
        BEGIN
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app REVOKE ALL ON TABLES    FROM %I', r);
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app REVOKE ALL ON SEQUENCES FROM %I', r);
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app REVOKE ALL ON FUNCTIONS FROM %I', r);
        EXCEPTION WHEN insufficient_privilege THEN
          RAISE NOTICE 'could not alter default privileges for role postgres; skipped';
        END;
      END IF;

      -- Drizzle's own migration bookkeeping schema (not exposed by default).
      IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') THEN
        EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM %I', r);
        EXECUTE format('REVOKE ALL ON SCHEMA drizzle FROM %I', r);
      END IF;
    END IF;
  END LOOP;
END
$lockdown$;
--> statement-breakpoint
-- Remove the implicit PUBLIC grant too (PUBLIC includes anon/authenticated).
REVOKE ALL ON SCHEMA app FROM PUBLIC;
