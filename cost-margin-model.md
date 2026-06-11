# Askine — Modelo de Custo × Preço × Margem

> Custos de Whisper/storage/NF vêm do código; **taxas ValidaPay são as reais do painel**; **Supabase é free hoje** → infra ~R$ 0 por tenant. Hospedagem é overhead fixo (⚠️ valor a confirmar).
>
> **Data:** 2026-06-10 · **Câmbio embutido:** 6 BRL/USD

---

## 1. Inputs de custo

| Variável | Valor | Tipo | Status |
|---|---|---|---|
| Whisper (transcrição) | **R$ 2,16 / hora** | variável (one-time) | ✅ código |
| Storage | R$ 0,10 / GB·mês | variável | ✅ código (dentro do free tier ≈ R$ 0) |
| Nota Fiscal (Simples) | **6% do preço** | variável | ✅ código |
| ValidaPay — PIX | **R$ 0,47 fixo** | variável | ✅ real |
| ValidaPay — Boleto | R$ 1,47 fixo | variável | ✅ real |
| ValidaPay — Cartão D+30 | **% por parcela + R$ 0,17** (tabela abaixo) | variável | ✅ real |
| **Supabase** | **R$ 0 (free tier)** → ~R$ 150/mês (Pro) ao escalar | **fixo do projeto** | ✅ confirmado |
| **Hospedagem (EasyPanel/VPS)** | ⚠️ a confirmar | **fixo do projeto** | ⚠️ falta valor |

### Tabela de cartão (recebimento em 30 dias)
| Parcelas | Taxa | Parcelas | Taxa |
|---|---|---|---|
| 1x | 3,97% | 7x | 9,39% |
| 2x | 5,19% | 8x | 10,19% |
| 3x | 5,99% | 9x | 10,99% |
| 4x | 6,79% | 10x | 11,79% |
| 5x | 7,49% | 11x | 12,49% |
| 6x | 8,29% | **12x** | **13,19%** |

> Todas + R$ 0,17. **A virada do modelo:** sem infra por tenant, o custo variável de um assinante em regime é só **NF (6%) + taxa de pagamento**. Tudo o mais é one-time (transcrição) ou fixo (hospedagem).

---

## 2. Planos — preço, limites e custos

| | Starter | Pro | Scale | Enterprise |
|---|---|---|---|---|
| **Preço/mês** | R$ 99 | R$ 299 | R$ 999 | sob proposta |
| Cursos | 1 | 3 | 5 | ilimitado |
| Transcrição/mês | 15h | 60h | 200h | sob medida |
| Alunos ativos | 100 | 500 | 2.000 | ilimitado |
| Storage | 100 MB | 500 MB | 2 GB | ilimitado |

### Custo da cota cheia de transcrição (one-time, mês de carga)
| Plano | Cálculo | Custo |
|---|---|---|
| Starter | 15h × 2,16 | **R$ 32,40** |
| Pro | 60h × 2,16 | **R$ 129,60** |
| Scale | 200h × 2,16 | **R$ 432,00** |

### Custo variável mensal por assinante (NF + pagamento; infra ≈ 0)
| Plano | NF 6% | PIX | Cartão 1x | **Variável PIX** | **Variável Cartão** |
|---|---|---|---|---|---|
| Starter | 5,94 | 0,47 | 4,10 | **6,41** | 10,04 |
| Pro | 17,94 | 0,47 | 12,04 | **18,41** | 29,98 |
| Scale | 59,94 | 0,47 | 39,83 | **60,41** | 99,77 |

---

## 3. Margem por plano — cenários

> **Mês 1:** transcreve 100% da cota (custo one-time). **Regime:** transcrição ≈ 0. Infra por tenant ≈ 0 (Supabase free).
> *Estas margens são de contribuição — ainda não descontam o overhead fixo de hospedagem (ver §5).*

### Via PIX (recomendado)
| Plano | Preço | Margem mês 1 | Margem regime |
|---|---|---|---|
| Starter | R$ 99 | R$ 60,19 · **61%** | R$ 92,59 · **94%** |
| Pro | R$ 299 | R$ 150,99 · **51%** | R$ 280,59 · **94%** |
| Scale | R$ 999 | R$ 506,59 · **51%** | R$ 938,59 · **94%** |

### Via Cartão 1x
| Plano | Preço | Margem mês 1 | Margem regime |
|---|---|---|---|
| Starter | R$ 99 | R$ 56,56 · **57%** | R$ 88,96 · **90%** |
| Pro | R$ 299 | R$ 139,42 · **47%** | R$ 269,02 · **90%** |
| Scale | R$ 999 | R$ 467,23 · **47%** | R$ 899,23 · **90%** |

**Leitura:** com Supabase free, em regime cada assinante rende ~**94% via PIX** / ~90% via cartão. Mesmo no mês de carga total da transcrição, nenhum plano cai abaixo de ~47%.

---

## 4. Add-ons — margem unitária (via PIX)

| Add-on | Preço | Custo (uso pleno) | **Margem** |
|---|---|---|---|
| +1 curso | R$ 30 | NF 1,80 + PIX 0,47 | **~R$ 27,73 · 92%** |
| +500 alunos | R$ 80 | NF 4,80 + PIX 0,47 | **~R$ 74,73 · 93%** |
| +500 MB | R$ 25 | NF 1,50 + PIX 0,47 | **~R$ 23,03 · 92%** |
| **+20h transcrição** | R$ 60 | **20h × 2,16 = 43,20** + NF 3,60 + PIX 0,47 | **~R$ 12,73 · 21%** ⚠️ |

> ⚠️ **+20h é o único item apertado:** ~21%. Custo direto R$ 43,20 (transcrição). **Piso pra 50%: R$ 86.** Subir pra R$ 79–89.

---

## 5. Overhead fixo e ponto de equilíbrio

Sem custo por tenant, o jogo vira **cobrir o overhead fixo** (hospedagem + Supabase Pro quando escalar). Depois disso, quase tudo é lucro.

**Quantos assinantes pagam o overhead** (margem de contribuição PIX em regime):
| Overhead fixo/mês | Starter (R$ 92,59) | Pro (R$ 280,59) | Scale (R$ 938,59) |
|---|---|---|---|
| R$ 150 (só Supabase Pro) | 2 assinantes | 1 | 1 |
| R$ 300 (Supabase + VPS) | 4 | 2 | 1 |
| R$ 500 | 6 | 2 | 1 |

> ⚠️ **Falta só o custo da hospedagem (EasyPanel)** pra fechar o overhead. Hoje no free de tudo, o break-even é praticamente o primeiro assinante.

---

## 6. Projeção de desconto anual

Anual = 12 × mensal. Transcrição segue one-time. **Custo operacional anual Pro** ≈ transcrição 1× (R$ 129,60) — infra ≈ 0. Arredondado: **~R$ 130**.

### PRO — tabela R$ 3.588/ano · margem de contribuição por desconto × pagamento
| Desconto | Preço anual | **Margem PIX** | **Margem Cartão 12x** |
|---|---|---|---|
| 0% | R$ 3.588 | R$ 3.242 · **90%** | R$ 2.769 · **77%** |
| **17% (2 meses grátis)** | R$ 2.990 | R$ 2.680 · **90%** | R$ 2.286 · **76%** |
| 25% | R$ 2.691 | R$ 2.399 · **89%** | R$ 2.044 · **76%** |
| 30% | R$ 2.512 | R$ 2.231 · **89%** | R$ 1.900 · **76%** |

*(PIX R$ 0,47 · Cartão 12x 13,19% + 0,17 · NF 6% sobre preço recebido · custo op ~R$ 130.)*

**Conclusão:** com Supabase free, o anual via PIX mantém ~**90% mesmo a 30% de desconto**. O único redutor relevante é o **cartão 12x** (cai pra ~76%). Recomendações:
1. **Mensalidade → PIX recorrente** (padrão). Cartão 1x como alternativa (~90%).
2. **Anual → PIX à vista** como oferta principal. Se oferecer parcelado: **repassar a taxa** (`passFeesToCustomer` no checkout) ou **limitar a 3–6x** (5,99%–8,29%) em vez de 12x (13,19%).
3. Sem risco de prejuízo em nenhum cenário — é só otimização de quanto lucro capturar.

---

## 7. Pendência única

1. ⚠️ **Custo mensal da hospedagem (EasyPanel/VPS)** — último número pra fechar o overhead e o break-even real.
2. **Decisão comercial:** % do desconto anual + política de parcelamento.
3. **Rever add-on +20h** (margem 21%).
4. *Resolvido:* taxas ValidaPay reais · Supabase free (infra por tenant ≈ 0).

---

### Fórmulas (pra planilha)

```
custo_transcricao   = horas × 2,16
custo_nf            = preco_recebido × 0,06
fee_pix             = 0,47                                   (fixo)
fee_cartao(n)       = preco_recebido × taxa(n)% + 0,17       (1x 3,97% … 12x 13,19%)
custo_infra_tenant  = 0                                      (Supabase free)

margem_contrib_regime = preco − (nf + fee)
margem_contrib_mes1   = preco − (transcricao_cheia + nf + fee)
lucro_mensal          = Σ(margem_contrib) − overhead_fixo   (hospedagem + Supabase Pro)
```
