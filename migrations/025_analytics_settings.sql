-- Analytics/pixel settings (LGPD opt-in). Operator sets the IDs in /super-admin;
-- the landing only loads these scripts AFTER the visitor accepts cookies. Empty
-- value = that pixel is disabled. Served to the landing via GET /site-config.json.
--
-- Idempotent.

INSERT INTO app_settings (key, value) VALUES
  ('analytics_ga4_id',        ''),
  ('analytics_meta_pixel_id', '')
ON CONFLICT (key) DO NOTHING;
