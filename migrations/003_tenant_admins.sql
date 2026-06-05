-- =============================================================================
-- Askine — tenant_admins table (Phase 2)
-- =============================================================================
-- Infoprodutores who own (or manage) a tenant. Separate from `students`
-- because they have admin permissions over the tenant's tools, not just
-- consumer chat access.
--
-- Auth flow:
--   1. Admin enters email at /t/:slug/admin/login
--   2. Magic link sent (intent='admin_login') if (tenant_id, email) exists
--   3. Click → /t/:slug/admin/verify consumes link, sets HMAC-signed session
--      cookie, redirects to /t/:slug/admin
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS tenant_admins (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  display_name     TEXT,
  role             TEXT NOT NULL DEFAULT 'owner',     -- 'owner' | 'manager' | 'viewer'
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_tenant_admins_tenant ON tenant_admins(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_admins_email  ON tenant_admins(email);
