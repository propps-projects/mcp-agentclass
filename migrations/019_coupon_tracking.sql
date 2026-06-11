-- Phase 11.3: local mirror of ValidaPay coupons + redemption tracking.
-- ValidaPay holds the canonical state (status, discount calc, redemption
-- counter); we cache the metadata for fast listing in the super-admin UI
-- and to capture which coupon a tenant used at signup. The validate flow
-- always calls ValidaPay live — we never trust our cache for pricing.

CREATE TABLE IF NOT EXISTS coupons (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  validapay_coupon_id TEXT UNIQUE NOT NULL,
  code                TEXT UNIQUE NOT NULL,
  name                TEXT,
  discount_type       TEXT NOT NULL CHECK (discount_type IN ('PERCENTAGE', 'FIXED')),
  discount_value      NUMERIC(12, 2) NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'INACTIVE')),
  max_redemptions     INTEGER,
  max_cycles          INTEGER,
  min_amount          NUMERIC(12, 2),
  applies_to          TEXT,
  first_time_only     BOOLEAN DEFAULT FALSE,
  valid_from          TIMESTAMPTZ,
  valid_until         TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coupons_status_idx ON coupons(status);
CREATE INDEX IF NOT EXISTS coupons_code_idx ON coupons(code);

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_anon ON coupons AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY deny_authenticated ON coupons AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS coupon_code_at_signup TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS coupon_id_at_signup UUID REFERENCES coupons(id) ON DELETE SET NULL;
