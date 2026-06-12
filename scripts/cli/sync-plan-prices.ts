/**
 * CLI: sincroniza TODOS os preços ativos (planos × recorrência + add-ons) com o
 * ValidaPay do ambiente atual (VALIDA_ENV) e grava os validapay_price_id no banco.
 *
 * Use no cutover de produção: os IDs gerados em sandbox não existem em prod, então
 * é preciso recriar os produtos/preços lá. Idempotente no sentido de "recria e
 * regrava" — rode quantas vezes precisar.
 *
 * Uso:
 *   npx tsx scripts/cli/sync-plan-prices.ts            # ambiente do .env (sandbox por padrão)
 *   npx tsx scripts/cli/sync-plan-prices.ts --yes      # obrigatório quando VALIDA_ENV=prod
 *   npx tsx scripts/cli/sync-plan-prices.ts --dry-run  # só lista o que faria, sem chamar a API
 */

import "dotenv/config";
import { listPlans } from "../../src/lib/plans.ts";
import { listPlanPrices, updatePlanPriceValidapay } from "../../src/lib/plan-prices.ts";
import { listAddons } from "../../src/lib/addons.ts";
import { listAddonPrices, updateAddonPriceValidapay } from "../../src/lib/addon-prices.ts";
import { createProductWithPrice } from "../../src/lib/validapay.ts";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const YES = args.includes("--yes");
const ENV = process.env.VALIDA_ENV ?? "sandbox";

const sd = (s: string) => `ASKINE ${s.toUpperCase()}`.slice(0, 22);
const ext = (id: string, rec: string) => `${id}_${rec.toLowerCase()}`;

let ok = 0;
let fail = 0;

async function main() {
  if (ENV === "prod" && !YES && !DRY) {
    console.error("⚠  VALIDA_ENV=prod. Isso cria produtos REAIS no ValidaPay.");
    console.error("   Rode com --yes pra confirmar (ou --dry-run pra simular).");
    process.exit(1);
  }
  console.log(`\n=== Sync de preços → ValidaPay (env=${ENV})${DRY ? " [DRY-RUN]" : ""} ===\n`);

  // ----- Planos -----
  const plans = await listPlans();
  for (const plan of plans) {
    const prices = await listPlanPrices(plan.id);
    for (const p of prices.filter((x) => x.isActive)) {
      const label = `plano ${plan.id} ${p.recurrence} (R$ ${p.amountBrl})`;
      if (DRY) { console.log(`[dry] ${label}`); continue; }
      try {
        const product = await createProductWithPrice({
          name: plan.name,
          description: `Askine ${plan.name}`,
          statementDescriptor: sd(plan.id),
          recurrence: p.recurrence,
          amountBrl: p.amountBrl,
          externalId: ext(plan.id, p.recurrence),
        });
        const priceId = product.prices[0]?.priceId ?? null;
        await updatePlanPriceValidapay({
          planId: plan.id, recurrence: p.recurrence,
          validapayProductId: product.productId, validapayPriceId: priceId,
        });
        ok++; console.log(`[ok]  ${label} → ${priceId}`);
      } catch (e) {
        fail++; console.error(`[FAIL] ${label}: ${(e as Error).message}`);
      }
    }
  }

  // ----- Add-ons -----
  const addons = await listAddons();
  for (const addon of addons) {
    const prices = await listAddonPrices(addon.id);
    for (const p of prices.filter((x) => x.isActive)) {
      const label = `addon ${addon.id} ${p.recurrence} (R$ ${p.amountBrl})`;
      if (DRY) { console.log(`[dry] ${label}`); continue; }
      try {
        const product = await createProductWithPrice({
          name: `Askine — ${addon.name}`,
          description: addon.description ?? addon.name,
          statementDescriptor: sd(addon.id),
          recurrence: p.recurrence,
          amountBrl: p.amountBrl,
          externalId: ext(addon.id, p.recurrence),
        });
        const priceId = product.prices[0]?.priceId ?? null;
        await updateAddonPriceValidapay({
          addonId: addon.id, recurrence: p.recurrence,
          validapayProductId: product.productId, validapayPriceId: priceId,
        });
        ok++; console.log(`[ok]  ${label} → ${priceId}`);
      } catch (e) {
        fail++; console.error(`[FAIL] ${label}: ${(e as Error).message}`);
      }
    }
  }

  console.log(`\n=== Concluído: ${ok} ok, ${fail} falhas ===\n`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Falhou:", err?.message ?? err);
  process.exit(1);
});
