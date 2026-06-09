/**
 * App-level AES-256-GCM secret encryption (Phase 5.5).
 *
 * Used for tenant credentials that live in the DB and would otherwise be
 * read by anyone with read access to Postgres or Supabase Studio:
 *   - tenants.panda_api_key_enc       (Panda Video API key)
 *   - tenants.hotmart_basic_token_enc (Hotmart Hottok)
 *
 * Stored format: `enc:v1:${iv}.${ciphertext}.${tag}` (all base64url).
 * Values lacking the `enc:v1:` prefix are treated as legacy cleartext
 * and returned untouched — this lets the migration roll out without a
 * coordinated re-encryption of every row. The one-shot
 * `scripts/cli/encrypt-tenant-secrets.ts` re-writes them in place; after
 * it runs in prod the legacy branch becomes dead code.
 *
 * Key sourcing: APP_ENCRYPTION_KEY env var, 32 bytes base64-encoded.
 * Generate with:  openssl rand -base64 32
 *
 * If the key is unset, encrypt() throws. decrypt() of legacy-format
 * cleartext does NOT need the key — so reads keep working in dev with
 * no key configured, and writes fail loudly.
 */

import crypto from "node:crypto";

const PREFIX = "enc:v1:";

function getKey(): Buffer {
  const b64 = process.env.APP_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error(
      "APP_ENCRYPTION_KEY not set. Generate with: openssl rand -base64 32",
    );
  }
  const buf = Buffer.from(b64, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `APP_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}). Regenerate with: openssl rand -base64 32`,
    );
  }
  return buf;
}

/** True iff the value is already in the enc:v1 envelope. */
export function isEncrypted(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(PREFIX);
}

/** Encrypt a UTF-8 string for at-rest storage. Returns null for null/empty input.
 *  Throws if APP_ENCRYPTION_KEY is missing or wrong length. */
export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${ct.toString("base64url")}.${tag.toString("base64url")}`;
}

/** Decrypt an at-rest secret. Legacy cleartext (no `enc:v1:` prefix) is
 *  returned untouched. Returns null for null/empty/malformed input. */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined || stored === "") return null;
  if (!stored.startsWith(PREFIX)) {
    return stored;
  }
  const body = stored.slice(PREFIX.length);
  const parts = body.split(".");
  if (parts.length !== 3) return null;
  const [ivB64, ctB64, tagB64] = parts;
  try {
    const iv = Buffer.from(ivB64, "base64url");
    const ct = Buffer.from(ctB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const key = getKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (err) {
    // GCM auth tag mismatch → likely wrong APP_ENCRYPTION_KEY. Don't
    // silently fall through to "looks empty"; surface so ops notices.
    console.error("[crypto] decryptSecret failed (wrong key or corrupted ciphertext):", err instanceof Error ? err.message : err);
    return null;
  }
}
