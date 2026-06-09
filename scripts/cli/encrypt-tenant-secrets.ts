#!/usr/bin/env tsx
/**
 * Phase 5.5 one-shot: re-encrypt legacy cleartext tenant secrets in place.
 *
 * Walks the tenants table, for each row checks panda_api_key_enc and
 * hotmart_basic_token_enc. If a value exists and does NOT already have
 * the enc:v1: prefix, it gets wrapped with AES-256-GCM and written back.
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   APP_ENCRYPTION_KEY=$(openssl rand -base64 32) tsx scripts/cli/encrypt-tenant-secrets.ts
 *
 * For prod: set the env var in EasyPanel FIRST, then run the script once
 * locally pointed at the same DB. After that, the env var alone is
 * enough — every read in the running server decrypts on demand.
 */

import "dotenv/config";
import { sb } from "../../src/lib/db-api.ts";
import { encryptSecret, isEncrypted } from "../../src/lib/crypto.ts";

interface TenantRow {
  id: string;
  slug: string;
  panda_api_key_enc: string | null;
  hotmart_basic_token_enc: string | null;
}

async function main() {
  // Force a getKey() probe so we fail fast on misconfigured env
  encryptSecret("probe");

  const tenants = await sb.select<TenantRow>(
    "tenants",
    "select=id,slug,panda_api_key_enc,hotmart_basic_token_enc",
  );
  console.log(`Found ${tenants.length} tenant(s). Scanning for legacy cleartext secrets...`);

  let pandaWraps = 0;
  let hotmartWraps = 0;
  let alreadyEncrypted = 0;
  for (const t of tenants) {
    const patch: Record<string, string | null> = {};

    if (t.panda_api_key_enc) {
      if (isEncrypted(t.panda_api_key_enc)) {
        alreadyEncrypted += 1;
      } else {
        patch.panda_api_key_enc = encryptSecret(t.panda_api_key_enc);
        pandaWraps += 1;
      }
    }
    if (t.hotmart_basic_token_enc) {
      if (isEncrypted(t.hotmart_basic_token_enc)) {
        alreadyEncrypted += 1;
      } else {
        patch.hotmart_basic_token_enc = encryptSecret(t.hotmart_basic_token_enc);
        hotmartWraps += 1;
      }
    }

    if (Object.keys(patch).length) {
      await sb.update("tenants", `id=eq.${t.id}`, patch);
      console.log(`  ✓ ${t.slug}: wrapped ${Object.keys(patch).join(", ")}`);
    }
  }

  console.log();
  console.log(`Done. Panda keys wrapped: ${pandaWraps}, Hotmart tokens wrapped: ${hotmartWraps}, already encrypted: ${alreadyEncrypted}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
