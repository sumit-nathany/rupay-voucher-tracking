-- Clear stale portal_account_id references on ordering_queue_items where the
-- referenced account is no longer in 'connected' status. These accounts should
-- never have been selected for ordering; the application code now handles the
-- fallback, but cleaning up the stored reference prevents confusion in the UI
-- and ensures the queue doesn't resurrect stale selections.
UPDATE "app"."ordering_queue_items"
SET "portal_account_id" = NULL
WHERE "portal_account_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "app"."portal_accounts" pa
    WHERE pa."id" = "app"."ordering_queue_items"."portal_account_id"
      AND pa."status" != 'connected'
  );
