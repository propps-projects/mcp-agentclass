-- Faixa de oferta (promo bar) fixa no topo da landing — editável no super-admin.
-- promo_enabled = '1' liga; vazio = desliga. Servida via GET /site-config.json.
--
-- Idempotent.

INSERT INTO app_settings (key, value) VALUES
  ('promo_enabled',     ''),
  ('promo_text',        '50% OFF vitalício no Plano Anual'),
  ('promo_bg_color',    '#4338ca'),
  ('promo_font_color',  '#ffffff'),
  ('promo_cta_text',    'Aproveitar agora'),
  ('promo_cta_url',     '/signup?plan=pro&rec=ANNUAL')
ON CONFLICT (key) DO NOTHING;
