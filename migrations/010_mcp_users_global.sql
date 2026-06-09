-- Phase 5.1: global student identity for the unified MCP.
--
-- Up to here, students were tenant-scoped: alice@foo.com bought from
-- VMA → row in students with tenant_id=VMA. Buying from another
-- infoprodutor created a SEPARATE student row.
--
-- For the global /mcp connector, identity must be by email regardless
-- of tenant. mcp_users is the canonical identity; per-tenant students
-- rows remain as "memberships" linking that user to tenants/courses.
--
-- OAuth tokens now reference mcp_user_id instead of student_id, so the
-- same token unlocks every course the user has access to across all
-- tenants in a single tool call.

CREATE TABLE IF NOT EXISTS mcp_users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT NOT NULL UNIQUE,
  display_name    TEXT,
  last_active_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_users_email ON mcp_users(email);

-- Make student_id nullable on OAuth tables, add mcp_user_id column
ALTER TABLE oauth_authorization_codes
  ADD COLUMN IF NOT EXISTS mcp_user_id UUID REFERENCES mcp_users(id) ON DELETE CASCADE;
ALTER TABLE oauth_authorization_codes ALTER COLUMN student_id DROP NOT NULL;

ALTER TABLE oauth_access_tokens
  ADD COLUMN IF NOT EXISTS mcp_user_id UUID REFERENCES mcp_users(id) ON DELETE CASCADE;
ALTER TABLE oauth_access_tokens ALTER COLUMN student_id DROP NOT NULL;

ALTER TABLE oauth_refresh_tokens
  ADD COLUMN IF NOT EXISTS mcp_user_id UUID REFERENCES mcp_users(id) ON DELETE CASCADE;
ALTER TABLE oauth_refresh_tokens ALTER COLUMN student_id DROP NOT NULL;

ALTER TABLE magic_links
  ADD COLUMN IF NOT EXISTS mcp_user_id UUID REFERENCES mcp_users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_access_tokens_mcp_user
  ON oauth_access_tokens(mcp_user_id) WHERE mcp_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_mcp_user
  ON oauth_refresh_tokens(mcp_user_id) WHERE mcp_user_id IS NOT NULL;

-- Backfill: for every email in students, create one mcp_users row.
INSERT INTO mcp_users (email, display_name)
SELECT email, MAX(display_name)
  FROM students
  GROUP BY email
ON CONFLICT (email) DO NOTHING;
