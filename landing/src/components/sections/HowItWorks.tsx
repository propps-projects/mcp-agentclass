import { motion } from 'framer-motion';
import { reveal, stagger, staggerItem, inViewProps } from '../../lib/motion';
import Badge from '../ui/Badge';
import ArrowLink from '../ui/ArrowLink';
import Card from '../ui/Card';

const steps = [
  {
    title: '1- Conecte a hospedagem de vídeos das suas aulas e os materiais do seu curso',
    body: 'Temos integração com o Panda Video que em poucos cliques, conseguimos transcrever todo o conteúdo do seu curso, além de, campos para você anexar materiais complementares.',
  },
  {
    title: '2- A Askine™ trabalha para criar a base de conhecimento com seu tom de voz',
    body: 'Com o conteúdo inserido na plataforma, criamos todas as instruções necessárias para o ChatGPT e Claude responder, orientar, conduzir e ensinar seus alunos exatamente como você faz.',
  },
  {
    title: '3- Importe seus alunos e integra a plataforma de vendas do seu curso',
    body: 'Dentro da plataforma, você consegue importar alunos por turmas e/ou cursos para ceder acesso manual ao tutor ou integrar a Hotmart para continuar vendendo e ceder acesso automático aos alunos.',
  },
  {
    title: '4- Ative o curso dentro da Askine™ e libere o conector para seus alunos utilizarem',
    body: 'Quando a base de conhecimento estiver pronta, ative o curso dentro da Askine™ e automaticamente seus alunos poderão consumir seu conteúdo e o tutor dentro do GPT e do Claude.',
  },
];

export default function HowItWorks() {
  return (
    <section className="container lp-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 'clamp(32px,6vw,80px)', alignItems: 'start' }}>
      <motion.div variants={reveal} {...inViewProps} style={{ position: 'sticky', top: 80, display: 'grid', gap: 18 }}>
        <div><Badge>Como Funciona</Badge></div>
        <h2 style={{ fontSize: 'clamp(30px,3.6vw,44px)', fontWeight: 600, maxWidth: '12ch' }}>
          Em 05 minutos seu curso está integrado
        </h2>
        <p style={{ color: 'var(--ink-soft)', maxWidth: '40ch' }}>
          Conecte sua hospedagem de vídeos, suba os materiais do seu curso e integre sua
          plataforma de vendas. Só isso!
        </p>
        <div><ArrowLink cta="integrar-meu-curso">Integrar meu curso</ArrowLink></div>
      </motion.div>
      <motion.div variants={stagger} {...inViewProps} style={{ display: 'grid', gap: 24 }}>
        {steps.map((s) => (
          <motion.div key={s.title} variants={staggerItem}>
            <Card>
              <h3 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>{s.title}</h3>
              <p style={{ color: 'var(--ink-soft)' }}>{s.body}</p>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
