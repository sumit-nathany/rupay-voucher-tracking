-- Health Check Up: Merge Thyrocare + SRL Diagnostics into one pick-one benefit across catalog.
DO $$
DECLARE
  rec RECORD;
  thyrocare_opt_id uuid;
  srl_opt_id uuid;
BEGIN
  FOR rec IN (
    SELECT
      bct.id as bank_card_type_id,
      bct.display_name,
      b_thy.id as thyrocare_benefit_id,
      v_thy.id as thyrocare_version_id,
      v_thy.exact_benefit as thyrocare_exact,
      COALESCE(v_thy.default_cash_value, 899.00) as thyrocare_val,
      b_srl.id as srl_benefit_id,
      v_srl.id as srl_version_id,
      v_srl.exact_benefit as srl_exact,
      COALESCE(v_srl.default_cash_value, 999.00) as srl_val
    FROM app.bank_card_types bct
    JOIN app.benefits b_thy ON b_thy.bank_card_type_id = bct.id
    JOIN app.benefit_catalog_versions v_thy ON v_thy.benefit_id = b_thy.id AND v_thy.benefit_provider = 'Thyrocare' AND lower(v_thy.benefit_type) LIKE '%health%'
    JOIN app.benefits b_srl ON b_srl.bank_card_type_id = bct.id
    JOIN app.benefit_catalog_versions v_srl ON v_srl.benefit_id = b_srl.id AND v_srl.benefit_provider = 'SRL Diagnostics' AND lower(v_srl.benefit_type) LIKE '%health%'
  ) LOOP
    -- 1. Update Thyrocare version to be the pick-one Health Check Up version
    UPDATE app.benefit_catalog_versions
    SET
      benefit_provider = NULL,
      exact_benefit = 'Any one of 2 offers',
      default_cash_value = rec.thyrocare_val
    WHERE id = rec.thyrocare_version_id;

    -- 2. Insert or get option for Thyrocare
    INSERT INTO app.benefit_options (id, version_id, provider, offer_name, cash_value, sort_order)
    VALUES (gen_random_uuid(), rec.thyrocare_version_id, 'Thyrocare', rec.thyrocare_exact, rec.thyrocare_val, 0)
    ON CONFLICT (version_id, provider, offer_name) DO NOTHING;

    SELECT id INTO thyrocare_opt_id
    FROM app.benefit_options
    WHERE version_id = rec.thyrocare_version_id AND provider = 'Thyrocare';

    -- 3. Insert or get option for SRL Diagnostics
    INSERT INTO app.benefit_options (id, version_id, provider, offer_name, cash_value, sort_order)
    VALUES (gen_random_uuid(), rec.thyrocare_version_id, 'SRL Diagnostics', rec.srl_exact, rec.srl_val, 1)
    ON CONFLICT (version_id, provider, offer_name) DO NOTHING;

    SELECT id INTO srl_opt_id
    FROM app.benefit_options
    WHERE version_id = rec.thyrocare_version_id AND provider = 'SRL Diagnostics';

    -- 4. Retire SRL version so it never generates
    UPDATE app.benefit_catalog_versions
    SET effective_to = '2025-12-31'
    WHERE id = rec.srl_version_id;

    -- 5. Delete all un-ordered SRL instances
    DELETE FROM app.benefit_instances
    WHERE benefit_id = rec.srl_benefit_id
      AND rupay_booking_id IS NULL
      AND (order_status IN ('Not Ordered', 'Withdrawn', 'Skipped') OR code_encrypted IS NULL);

    -- 6. If any ordered SRL instances exist, repoint to combined benefit and set option
    UPDATE app.benefit_instances
    SET
      benefit_id = rec.thyrocare_benefit_id,
      generated_from_version = rec.thyrocare_version_id,
      chosen_option_id = srl_opt_id
    WHERE benefit_id = rec.srl_benefit_id;

    -- 7. Update ordered Thyrocare instances to have chosen_option_id = Thyrocare option
    UPDATE app.benefit_instances
    SET chosen_option_id = thyrocare_opt_id
    WHERE benefit_id = rec.thyrocare_benefit_id
      AND (rupay_booking_id IS NOT NULL OR order_status NOT IN ('Not Ordered', 'Withdrawn', 'Skipped'));

    -- 8. Ensure un-ordered instances of the combined benefit have chosen_option_id = NULL
    UPDATE app.benefit_instances
    SET chosen_option_id = NULL
    WHERE benefit_id = rec.thyrocare_benefit_id
      AND rupay_booking_id IS NULL
      AND order_status IN ('Not Ordered', 'Withdrawn', 'Skipped');

  END LOOP;
END $$;
