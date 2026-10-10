-- PNB Imperial: Kalyan Jewellers is redeemable Half-Yearly (once every 6 months: H1 and H2), not Quarterly.
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN (
    SELECT
      v.id as version_id,
      b.id as benefit_id,
      bct.display_name as card_type_name
    FROM app.benefit_catalog_versions v
    JOIN app.benefits b ON b.id = v.benefit_id
    JOIN app.bank_card_types bct ON bct.id = b.bank_card_type_id
    WHERE (v.exact_benefit ILIKE '%Kalyan%' OR v.benefit_provider ILIKE '%Kalyan%')
      AND v.frequency = 'Quarterly'
  ) LOOP
    -- 1. Update frequency in benefit_catalog_versions from 'Quarterly' to '6 months'
    UPDATE app.benefit_catalog_versions
    SET frequency = '6 months'
    WHERE id = rec.version_id;

    -- 2. Delete un-ordered 2026-Q4 instances generated erroneously by quarterly schedule
    DELETE FROM app.benefit_instances
    WHERE generated_from_version = rec.version_id
      AND period_label = '2026-Q4'
      AND rupay_booking_id IS NULL
      AND code_encrypted IS NULL
      AND order_status IN ('Not Ordered', 'Withdrawn', 'Skipped');

    -- 3. Update existing 2026-Q2 instances (representing H1) to 2026-H1
    UPDATE app.benefit_instances
    SET
      period_start = '2026-01-01',
      period_end = '2026-06-30',
      period_label = '2026-H1',
      order_deadline = '2026-06-30'
    WHERE generated_from_version = rec.version_id
      AND period_label = '2026-Q2';

    -- 4. Update existing 2026-Q3 instances (representing H2) to 2026-H2
    UPDATE app.benefit_instances
    SET
      period_start = '2026-07-01',
      period_end = '2026-12-31',
      period_label = '2026-H2',
      order_deadline = '2026-12-31'
    WHERE generated_from_version = rec.version_id
      AND period_label = '2026-Q3';

  END LOOP;
END $$;
