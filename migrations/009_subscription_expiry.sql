-- Phase 3.3: auto-suspend tenants when their paid subscription window expires.
--
-- No grace period — subscription_active_until is the absolute deadline.
-- Payment.success extends it by +31d; if no renewal arrives before it
-- passes, the daily cron flips status to 'suspended'.
--
-- Tenant can re-activate by paying — payment.success / subscription.renewed
-- webhook will set status='active' again (billing.ts already does this).
--
-- Idempotent — safe to re-run.

CREATE OR REPLACE FUNCTION suspend_expired_tenants()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  n INT;
BEGIN
  WITH suspended AS (
    UPDATE tenants
       SET status = 'suspended'
     WHERE status = 'active'
       AND subscription_active_until IS NOT NULL
       AND subscription_active_until < NOW()
    RETURNING id
  )
  SELECT count(*) INTO n FROM suspended;
  RETURN n;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Drop any prior schedule (in case migration is re-applied with a different
-- function name), then re-create.
DO $$
BEGIN
  PERFORM cron.unschedule('askine-suspend-overdue');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('askine-suspend-expired');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'askine-suspend-expired',
  '0 3 * * *',                                  -- daily at 03:00 UTC = 00:00 BRT
  $$ SELECT suspend_expired_tenants(); $$
);
