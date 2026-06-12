import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

/**
 * Demo animado no Hero: recria a UI do ChatGPT e roteia, em loop, um aluno
 * consumindo um curso pelo conector @askine. 100% HTML/CSS/SVG + Framer Motion,
 * sem vídeo real (player mockado). Vive dentro da caixa branca do Hero.
 *
 * Fonte: força um stack sans-serif (ChatGPT não usa serifa) — sobrescreve a
 * Aleo global só aqui dentro.
 */

const SANS =
  "'Söhne', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
// Claude usa uma fonte mais serifada (proxy: Tiempos/Georgia).
const SERIF = "'Tiempos Text', Georgia, 'Times New Roman', Times, serif";

// ---- Ícones ----------------------------------------------------------------
function GptMark({ size = 20, color = '#000' }: { size?: number; color?: string }) {
  // Marca da OpenAI (knot). Reconhecível; desenhada em path único.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.99 5.99 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07zM13.26 22.43a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.8.8 0 0 0 .4-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.5 4.5zM3.6 18.3a4.47 4.47 0 0 1-.53-3.01l.14.08 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.49 4.49 0 0 1 2.37-1.98v5.69a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.87zm16.6 3.85-5.84-3.39 2.02-1.16a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.67a.79.79 0 0 0-.4-.67zm2.01-3.02-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.3 12.86l-2.02-1.16a.08.08 0 0 1-.04-.06V6.07a4.5 4.5 0 0 1 7.38-3.45l-.14.08-4.78 2.76a.8.8 0 0 0-.4.68zm1.1-2.37 2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5z"
        fill={color}
      />
    </svg>
  );
}
function ClaudeMark({ size = 20, color = '#d97757' }: { size?: number; color?: string }) {
  // Marca oficial do Claude.
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden style={{ fill: color, flex: 'none' }}>
      <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z" />
    </svg>
  );
}
function AskineMark({ size = 14 }: { size?: number }) {
  return (
    <img src="/askine-icon.svg" alt="" width={size} height={size}
      style={{ display: 'inline-block', flex: 'none' }} />
  );
}

// ---- Providers (GPT / Claude) ----------------------------------------------
type Provider = 'gpt' | 'claude';
const PROVIDERS: Record<Provider, {
  name: string; sub: string; font: string; bg: string; surface: string; bubble: string;
  border: string; accent: string; send: string; placeholder: string; connector: boolean;
  Logo: (p: { size?: number; color?: string }) => React.ReactElement;
}> = {
  gpt: {
    name: 'ChatGPT', sub: '5', font: SANS, bg: '#ffffff', surface: '#ffffff', bubble: '#f4f4f4',
    border: 'rgba(0,0,0,.14)', accent: 'linear-gradient(135deg,#10a37f,#0b6b53)', send: '#0d0d0d',
    placeholder: 'Pergunte alguma coisa', connector: true, Logo: GptMark,
  },
  claude: {
    // Paleta Claude: papel quente (#f0eee6), composer claro, clay (#d97757).
    name: 'Claude', sub: 'Sonnet 4.5', font: SERIF, bg: '#f0eee6', surface: '#faf9f5', bubble: '#ffffff',
    border: 'rgba(60,50,40,.16)', accent: 'linear-gradient(135deg,#d97757,#bf5b3c)', send: '#d97757',
    placeholder: 'Como posso te ajudar hoje?', connector: false, Logo: ClaudeMark,
  },
};
function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 19V5M5 12l7-7 7 7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function PlayIcon({ s = 13, c = '#fff' }: { s?: number; c?: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={c} aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

// ---- Player mockado (inline ↔ PIP via layoutId) ----------------------------
function VideoPlayer({ progress, pip = false }: { progress: number; pip?: boolean }) {
  return (
    <motion.div
      style={{
        position: 'relative', width: '100%', aspectRatio: '16 / 9',
        borderRadius: pip ? 10 : 12, overflow: 'hidden',
        background: 'linear-gradient(135deg,#1f2937 0%,#0b1220 60%,#111827 100%)',
        boxShadow: pip ? '0 12px 30px rgba(0,0,0,.35)' : '0 2px 10px rgba(0,0,0,.18)',
        border: '1px solid rgba(255,255,255,.08)',
      }}
    >
      {/* "thumbnail" decorativa */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.5,
        background: 'radial-gradient(120% 80% at 80% 10%, rgba(124,58,237,.45), transparent 60%), radial-gradient(90% 70% at 0% 100%, rgba(34,197,94,.30), transparent 55%)' }} />
      {/* play */}
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <div style={{ width: pip ? 30 : 46, height: pip ? 30 : 46, borderRadius: '50%',
          background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(2px)', display: 'grid', placeItems: 'center',
          border: '1px solid rgba(255,255,255,.25)' }}>
          <PlayIcon s={pip ? 11 : 16} />
        </div>
      </div>
      {/* título */}
      {!pip && (
        <div style={{ position: 'absolute', left: 12, top: 10, right: 12, color: '#e5e7eb', fontFamily: SANS }}>
          <div style={{ fontSize: 11, opacity: 0.7 }}>Tráfego para SaaS</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Aula 03 — Topo de funil que converte</div>
        </div>
      )}
      {/* badge AO VIVO/PIP */}
      {pip && (
        <div style={{ position: 'absolute', top: 6, left: 6, fontSize: 9, fontWeight: 700, color: '#fff',
          background: 'rgba(0,0,0,.5)', padding: '2px 6px', borderRadius: 999, fontFamily: SANS,
          display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
          tocando
        </div>
      )}
      {/* barra de progresso */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: pip ? 3 : 5, background: 'rgba(255,255,255,.18)' }}>
        <div style={{ width: `${progress}%`, height: '100%', background: '#10a37f', transition: 'width .2s linear' }} />
      </div>
      {!pip && (
        <div style={{ position: 'absolute', right: 10, bottom: 10, fontSize: 10, color: '#cbd5e1', fontFamily: SANS }}>
          {fmtTime(progress)} / 12:30
        </div>
      )}
    </motion.div>
  );
}
function fmtTime(p: number) {
  const total = 750; // 12:30 em seg
  const s = Math.floor((p / 100) * total);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ---- Tipos de mensagem -----------------------------------------------------
type Msg =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; kind: 'courses' }
  | { id: number; role: 'assistant'; kind: 'video'; ready: boolean }
  | { id: number; role: 'assistant'; kind: 'summary'; bullets: number };

const SUMMARY = [
  'Defina o ICP antes de escalar investimento.',
  'Topo de funil educa — não tenta vender direto.',
  'Acompanhe CAC e LTV desde o primeiro real.',
  'Não esqueça: criativo vence canal, teste sempre.',
];

export default function HeroChatDemo({ onProvider }: { onProvider?: (p: Provider) => void }) {
  const reduced = useReducedMotion();
  const [provider, setProvider] = useState<Provider>('gpt');
  const [composer, setComposer] = useState('');
  const [connector, setConnector] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [typing, setTyping] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(18);
  const [pip, setPip] = useState(false);
  const [swapping, setSwapping] = useState(false); // dissolve na troca GPT↔Claude
  const threadRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  // espelho do composer pra usar dentro do runner sem stale closure
  const composerRef = useRef('');
  composerRef.current = composer;

  // avisa o provider atual (a moldura cinza do Hero vira branca no Claude)
  useEffect(() => { onProvider?.(provider); }, [provider, onProvider]);

  // auto-scroll do thread
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [msgs, loading, pip]);

  // progresso "tocando" do player
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setProgress((p) => (p >= 96 ? 18 : p + 0.6)), 200);
    return () => clearInterval(t);
  }, [reduced]);

  // timeline
  useEffect(() => {
    if (reduced) {
      // estado final estático, sem animação
      setMsgs([
        { id: 1, role: 'user', text: 'Liste os meus cursos' },
        { id: 2, role: 'assistant', kind: 'courses' },
        { id: 3, role: 'user', text: 'Coloque a aula de tráfego para SaaS para assistir' },
        { id: 4, role: 'assistant', kind: 'video', ready: true },
      ]);
      setConnector(true);
      return;
    }
    let cancelled = false;
    const timeouts: number[] = [];
    const sleep = (ms: number) =>
      new Promise<void>((res) => { timeouts.push(window.setTimeout(res, ms)); });
    const nextId = () => ++idRef.current;

    async function typeInto(text: string, perChar = 38) {
      setTyping(true);
      for (let i = 1; i <= text.length; i++) {
        if (cancelled) return;
        setComposer(text.slice(0, i));
        await sleep(perChar + Math.random() * 34);
      }
      setTyping(false);
    }
    async function send(make: () => Msg) {
      setMsgs((m) => [...m, { id: nextId(), role: 'user', text: composerRef.current }]);
      setComposer('');
      await sleep(450);
      setLoading(true);
      await sleep(1100);
      if (cancelled) return;
      setLoading(false);
      setMsgs((m) => [...m, make()]);
    }

    async function run() {
      let prov: Provider = 'gpt';
      while (!cancelled) {
        const usesConnector = PROVIDERS[prov].connector;
        // reset + tema do provider da vez
        setProvider(prov);
        setMsgs([]); setComposer(''); setConnector(false); setZoom(false);
        setPip(false); setLoading(false);
        setSwapping(false); // fade-in do painel novo
        await sleep(900); if (cancelled) return;

        // 1→2: zoom in, (no GPT marca @askine; no Claude só escreve) e digita
        setZoom(true); await sleep(550);
        if (usesConnector) { setConnector(true); await sleep(450); }
        await typeInto('Liste os meus cursos'); if (cancelled) return;
        await sleep(350);
        // 3: zoom out + envia + resposta (cursos)
        setZoom(false); await sleep(450);
        await send(() => ({ id: nextId(), role: 'assistant', kind: 'courses' }));
        if (cancelled) return; await sleep(1500);

        // 5: zoom in + digita
        setZoom(true); await sleep(500);
        await typeInto('Quero continuar aprendendo sobre tráfego para SaaS, coloque a aula para assistir');
        if (cancelled) return; await sleep(350);
        // 6→7: zoom out + envia + skeleton + player
        setZoom(false); await sleep(450);
        setMsgs((m) => [...m, { id: nextId(), role: 'user', text: composerRef.current }]);
        setComposer(''); await sleep(450);
        setLoading(true); await sleep(1100); if (cancelled) return;
        setLoading(false);
        const vidId = nextId();
        setMsgs((m) => [...m, { id: vidId, role: 'assistant', kind: 'video', ready: false }]);
        await sleep(1300); if (cancelled) return; // skeleton enquanto "carrega" o vídeo
        setMsgs((m) => m.map((x) => (x.id === vidId && x.role === 'assistant' && x.kind === 'video' ? { ...x, ready: true } : x)));
        await sleep(6900); // segura o player ~5s a mais

        // 8: zoom in + digita
        setZoom(true); await sleep(500);
        await typeInto('Resuma em tópicos os pontos importantes e o que não devo esquecer');
        if (cancelled) return; await sleep(350);
        // 9: zoom out, player vira PIP, envia + resumo streaming
        setZoom(false); await sleep(350);
        setPip(true); await sleep(650);
        setMsgs((m) => [...m, { id: nextId(), role: 'user', text: composerRef.current }]);
        setComposer(''); await sleep(450);
        setLoading(true); await sleep(1100); if (cancelled) return;
        setLoading(false);
        const sumId = nextId();
        setMsgs((m) => [...m, { id: sumId, role: 'assistant', kind: 'summary', bullets: 0 }]);
        for (let b = 1; b <= SUMMARY.length; b++) {
          await sleep(650); if (cancelled) return;
          setMsgs((m) => m.map((x) => (x.id === sumId && x.role === 'assistant' && x.kind === 'summary' ? { ...x, bullets: b } : x)));
        }
        await sleep(3200); if (cancelled) return; // respiro antes do loop

        setSwapping(true); await sleep(480); if (cancelled) return; // dissolve out
        prov = prov === 'gpt' ? 'claude' : 'gpt'; // alterna GPT > Claude > GPT...
      }
    }
    run();
    return () => { cancelled = true; timeouts.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const cfg = PROVIDERS[provider];
  const Logo = cfg.Logo;

  return (
    <div
      style={{
        position: 'relative', width: '100%', height: 'clamp(460px, 58vw, 580px)',
        borderRadius: 18, overflow: 'hidden', fontFamily: cfg.font, background: 'transparent',
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.06)', color: '#0d0d0d', textAlign: 'left',
      }}
    >
      {/* Plataforma do provider sobre o palco branco. Na troca: a saindo desce e
          some (slide down + fade out); a entrando sobe e aparece (slide up + fade in). */}
      <motion.div
        animate={{ y: swapping ? '14%' : '0%', opacity: swapping ? 0 : 1 }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
        style={{ position: 'relative', height: '100%', background: cfg.bg }}
      >
      <motion.div
        animate={{ scale: zoom ? 1.1 : 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        style={{ transformOrigin: 'bottom center', height: '100%', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header — tema do provider */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '13px 18px', borderBottom: '1px solid rgba(0,0,0,.06)', flex: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600 }}>
            <Logo size={22} />
            <span>{cfg.name}</span>
            <span style={{ color: 'rgba(0,0,0,.35)', fontSize: 13 }}>{cfg.sub}</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ marginTop: 1 }}><path d="M6 9l6 6 6-6" stroke="rgba(0,0,0,.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: cfg.accent }} />
        </div>

        {/* Thread (scroller) — conteúdo numa coluna central como no ChatGPT */}
        <div ref={threadRef} style={{ flex: 1, overflow: 'hidden', padding: '24px 0 12px' }}>
          <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
            <AnimatePresence initial={false}>
              {msgs.map((m) =>
                m.role === 'user' ? (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    style={{ alignSelf: 'flex-end', display: 'flex', gap: 10, alignItems: 'flex-start', maxWidth: '86%' }}>
                    <div style={{ background: cfg.bubble, color: '#0d0d0d', padding: '11px 16px', borderRadius: 20, fontSize: 15, lineHeight: 1.5 }}>
                      {m.text}
                    </div>
                    <div style={{ flex: 'none', width: 28, height: 28, borderRadius: '50%', background: '#2d2d2d', color: '#fff',
                      display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600, marginTop: 1 }}>A</div>
                  </motion.div>
                ) : (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    style={{ display: 'flex', gap: 12, alignItems: 'flex-start', alignSelf: 'flex-start', width: '100%' }}>
                    <div style={{ flex: 'none', marginTop: 1 }}><Logo size={22} /></div>
                    <div style={{ fontSize: 15, lineHeight: 1.6, width: '100%' }}>
                      {m.kind === 'courses' && <CoursesAnswer />}
                      {m.kind === 'video' && <VideoAnswer progress={progress} pip={pip} ready={m.ready} />}
                      {m.kind === 'summary' && <SummaryAnswer n={m.bullets} />}
                    </div>
                  </motion.div>
                ),
              )}
            </AnimatePresence>

            {loading && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <Logo size={22} />
                <Dots />
              </div>
            )}
          </div>
        </div>

        {/* Composer — também na coluna central */}
        <div style={{ padding: '12px 0 18px', flex: 'none' }}>
          <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: cfg.surface,
              border: `1px solid ${cfg.border}`, borderRadius: 28, padding: '10px 10px 10px 16px',
              boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
              <div style={{ fontSize: 20, color: 'rgba(0,0,0,.4)', lineHeight: 1 }}>+</div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 7, minHeight: 24, fontSize: 15, flexWrap: 'wrap' }}>
                {connector && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(16,163,127,.12)',
                    color: '#0b6b53', border: '1px solid rgba(16,163,127,.3)', padding: '3px 9px', borderRadius: 8, fontWeight: 600, fontSize: 13.5 }}>
                    <AskineMark size={12} />@askine
                  </span>
                )}
                {composer
                  ? <span>{composer}{typing && <Caret />}</span>
                  : !connector && <span style={{ color: 'rgba(0,0,0,.4)' }}>{cfg.placeholder}</span>}
                {connector && !composer && typing && <Caret />}
              </div>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: composer ? cfg.send : 'rgba(0,0,0,.18)',
                display: 'grid', placeItems: 'center', transition: 'background .2s', flex: 'none' }}>
                <SendIcon />
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Player em PIP — fora da cena (não sofre o zoom) */}
      <AnimatePresence>
        {pip && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'absolute', right: 16, bottom: 100, width: '32%', maxWidth: 200, zIndex: 5 }}
          >
            <VideoPlayer progress={progress} pip />
          </motion.div>
        )}
      </AnimatePresence>
      </motion.div>
    </div>
  );
}

// ---- Respostas -------------------------------------------------------------
function CoursesAnswer() {
  const courses: [string, string][] = [
    ['Marketing para Startups', 'do zero ao primeiro cliente'],
    ['Inglês Facilitado', 'conversação para o dia a dia'],
  ];
  return (
    <div>
      <div style={{ marginBottom: 8 }}>Você tem acesso a 2 cursos:</div>
      <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
        {courses.map(([name, desc]) => (
          <li key={name} style={{ lineHeight: 1.5 }}>
            <strong>{name}</strong> — {desc}
          </li>
        ))}
      </ul>
    </div>
  );
}
function VideoAnswer({ progress, pip, ready }: { progress: number; pip: boolean; ready: boolean }) {
  return (
    <div>
      <div style={{ marginBottom: 8 }}>Perfeito! Aqui está a aula para você assistir:</div>
      {pip ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(0,0,0,.55)', fontSize: 13 }}>
          <PlayIcon s={11} c="#10a37f" /> tocando em janela flutuante
        </div>
      ) : ready ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ width: '100%' }}>
          <VideoPlayer progress={progress} />
        </motion.div>
      ) : (
        <div style={{ width: '100%' }}><VideoSkeleton /></div>
      )}
    </div>
  );
}

function VideoSkeleton() {
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 12, overflow: 'hidden', background: '#ececec' }}>
      {/* shimmer */}
      <motion.div
        animate={{ x: ['-120%', '120%'] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
        style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.65), transparent)' }}
      />
      {/* circulo de play "fantasma" */}
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,.06)' }} />
      </div>
    </div>
  );
}
function SummaryAnswer({ n }: { n: number }) {
  return (
    <div>
      <div style={{ marginBottom: 8 }}>Aqui vão os pontos que você não pode esquecer:</div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
        {SUMMARY.slice(0, n).map((b, i) => (
          <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} style={{ lineHeight: 1.45 }}>
            {b}
          </motion.li>
        ))}
        {n < SUMMARY.length && <Caret />}
      </ul>
    </div>
  );
}

// ---- Microelementos --------------------------------------------------------
function Caret() {
  return (
    <motion.span
      animate={{ opacity: [1, 0.15, 1] }} transition={{ duration: 0.9, repeat: Infinity }}
      style={{ display: 'inline-block', width: 2, height: '1em', background: '#0d0d0d', verticalAlign: 'text-bottom', marginLeft: 1 }}
    />
  );
}
function Dots() {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[0, 1, 2].map((i) => (
        <motion.span key={i} animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }}
          style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(0,0,0,.55)', display: 'inline-block' }} />
      ))}
    </div>
  );
}
