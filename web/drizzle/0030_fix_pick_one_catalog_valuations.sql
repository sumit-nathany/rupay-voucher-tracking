-- Restore corrupted default_cash_value on pick-one catalog versions that were mistakenly
-- overwritten by blanket exact_benefit match on generic "Any one of 2 offers" text.

-- 1. Restore Health Check Up pick-one catalog versions to 899.00
UPDATE "app"."benefit_catalog_versions"
SET "default_cash_value" = '899.00'
WHERE lower("benefit_type") LIKE '%health%'
  AND ("exact_benefit" ILIKE '%any one%' OR "exact_benefit" ILIKE '%aarogyam%')
  AND ("default_cash_value" = '3500.00' OR "default_cash_value" IS NULL);

-- 2. Restore Cab Services pick-one catalog version to 100.00
UPDATE "app"."benefit_catalog_versions"
SET "default_cash_value" = '100.00'
WHERE lower("benefit_type") LIKE '%cab%'
  AND "exact_benefit" ILIKE '%any one%'
  AND "default_cash_value" = '3500.00';

-- 3. Restore PNB Salary Imperial OTT Entertainment pick-one catalog version to 1499.00
UPDATE "app"."benefit_catalog_versions"
SET "default_cash_value" = '1499.00'
WHERE lower("benefit_type") LIKE '%ott%'
  AND "exact_benefit" ILIKE '%any one%'
  AND "default_cash_value" = '3500.00';
