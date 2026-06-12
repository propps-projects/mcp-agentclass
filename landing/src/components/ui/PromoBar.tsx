import { useEffect, useState } from 'react';

// Faixa de oferta no topo. Config vem do super-admin via /site-config.json
// (promo). Só renderiza se promo.enabled e tiver texto.
type Promo = {
  enabled: boolean; text: string; bgColor: string; fontColor: string;
  ctaText: string; ctaUrl: string;
};

export default function PromoBar() {
  const [promo, setPromo] = useState<Promo | null>(null);

  useEffect(() => {
    const url = (import.meta.env.PUBLIC_SITE_CONFIG_URL as string | undefined) ?? '/site-config.json';
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((cfg: { promo?: Promo }) => {
        if (cfg.promo?.enabled && cfg.promo.text) setPromo(cfg.promo);
      })
      .catch(() => {/* sem faixa */});
  }, []);

  if (!promo) return null;
  return (
    <div
      role="banner"
      style={{
        background: promo.bgColor, color: promo.fontColor,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 16, flexWrap: 'wrap', padding: '10px 20px',
        fontSize: 14.5, fontWeight: 600, lineHeight: 1.3, textAlign: 'center',
      }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden>🎉</span>{promo.text}
      </span>
      {promo.ctaText && (
        <a
          href={promo.ctaUrl}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: promo.fontColor, color: promo.bgColor,
            fontWeight: 700, fontSize: 13.5, padding: '7px 16px', borderRadius: 999,
            whiteSpace: 'nowrap',
          }}>
          {promo.ctaText} →
        </a>
      )}
    </div>
  );
}
