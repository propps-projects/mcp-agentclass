/**
 * One-off: cria uma sessão de checkout no ValidaPay (env do .env) e imprime a URL
 * pra abrir no navegador e conferir a descrição do item.
 *
 * Uso:
 *   npx tsx scripts/cli/test-checkout.ts                 # plano starter mensal
 *   npx tsx scripts/cli/test-checkout.ts <priceId>       # priceId específico
 */
import "dotenv/config";
import { createCheckoutSession } from "../../src/lib/validapay.ts";
import { getActivePlanPrice } from "../../src/lib/plan-prices.ts";

async function main() {
  let priceId = process.argv[2];
  if (!priceId) {
    const active = await getActivePlanPrice("starter"); // recorrência ativa padrão
    priceId = active?.validapayPriceId ?? "";
    if (!priceId) throw new Error("Plano starter sem validapay_price_id — rode o sync antes.");
  }
  const doc = process.env.VALIDA_DOC;
  if (!doc) throw new Error("VALIDA_DOC não setado no .env");

  const session = await createCheckoutSession({
    priceId,
    customer: { email: "teste-checkout@askine.com.br", documentNumber: doc },
    companyName: "Askine",
  });

  console.log("\n=== Checkout criado ===");
  console.log("priceId:", priceId);
  console.log("session:", session.id);
  console.log("\nAbra no navegador:\n" + session.url + "\n");
}

main().catch((e) => { console.error("Falhou:", e?.message ?? e); process.exit(1); });
