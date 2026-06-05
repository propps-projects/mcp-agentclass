-- Phase 3.1.5: allow tenant_id NULL on magic_links so super-admin login
-- (platform-scoped, not tenant-scoped) can reuse the same table.

ALTER TABLE magic_links ALTER COLUMN tenant_id DROP NOT NULL;
