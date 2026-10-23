-- Grant permissions on benefit_value_overrides to postgres and service_role
-- Tables created by rupay_worker migrations are owned by rupay_worker, so
-- the application role (postgres) on Vercel needs explicit grants.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT ALL ON TABLE "app"."benefit_value_overrides" TO postgres;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE "app"."benefit_value_overrides" TO service_role;
  END IF;
END $$;
