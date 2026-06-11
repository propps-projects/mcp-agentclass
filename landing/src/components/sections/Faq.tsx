import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { reveal, inViewProps } from '../../lib/motion';
import PillButton from '../ui/PillButton';

const faqs = [
  { q: 'Preciso entender de tecnologia?', a: 'Não. Você conecta o PandaVideo e a Askine™ faz o resto.' },
  { q: 'Como meus alunos ganham acesso?', a: 'Quem compra na Hotmart é liberado automaticamente. Nada manual.' },
  { q: 'E quem pede reembolso ou cancela?', a: 'O acesso ao tutor é revogado sozinho, sem você precisar mexer em nada.' },
  { q: 'Meus alunos precisam pagar ChatGPT ou Claude?', a: 'Eles usam a conta que já têm — não há custo extra de IA pra você.' },
  { q: 'O ChatGPT e o Claude inventam respostas?', a: 'O tutor responde com base nas suas aulas, não em achismo.' },
  { q: 'Quanto tempo pra ativar?', a: '5 minutos pra conectar. A transcrição roda sozinha.' },
];

function Item({ q, a, defaultOpen }: { q: string; a: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        style={{ width: '100%', background: 'transparent', border: 'none', padding: '22px 0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', fontSize: 19, fontWeight: 600, color: 'var(--ink)' }}>
        {q}
        <motion.span animate={{ rotate: open ? 180 : 0 }} aria-hidden>⌄</motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}>
            <p style={{ color: 'var(--ink-soft)', paddingBottom: 22, maxWidth: '70ch' }}>{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Faq() {
  return (
    <section className="container" style={{ maxWidth: 920 }}>
      <motion.h2 variants={reveal} {...inViewProps} style={{ fontSize: 'clamp(32px,4.4vw,52px)', fontWeight: 700, textAlign: 'center', marginBottom: 40 }}>
        Perguntas Frequentes
      </motion.h2>
      <div>
        {faqs.map((f, i) => <Item key={f.q} q={f.q} a={f.a} defaultOpen={i === 0} />)}
      </div>
      <motion.div variants={reveal} {...inViewProps}
        style={{ marginTop: 48, background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-soft)', padding: 40, textAlign: 'center' }}>
        <h3 style={{ fontSize: 26, fontWeight: 600 }}>Ainda com dúvidas?</h3>
        <p style={{ color: 'var(--ink-soft)', margin: '8px 0 22px' }}>Fale com o nosso time agora mesmo.</p>
        <PillButton variant="dark" cta="falar-com-askine">Falar com Askine™</PillButton>
      </motion.div>
    </section>
  );
}
