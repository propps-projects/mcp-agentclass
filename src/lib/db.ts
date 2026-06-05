import postgres from "postgres";

/**
 * Postgres connection pool to Supabase.
 *
 * Use the Pooler URL (port 6543) in DATABASE_URL — direct connections on
 * 5432 don't scale across serverless / multi-worker setups.
 *
 * Lazy-initialized so the rest of the codebase keeps working without DB
 * during the migration window (Sub-phase 0.1 → 0.3).
 */

let _sql: postgres.Sql | null = null;

export function sql(): postgres.Sql {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL not set. Provision Supabase per docs/SUPABASE_SETUP.md " +
      "and set the env var before using sql().",
    );
  }
  _sql = postgres(url, {
    // Connection pool sizing — Supabase Pooler caps at ~20 server-side, keep us well under.
    max: 10,
    // Tagged-template values are parameterized; SQL injection prevented by default.
    prepare: true,
    // Treat pgvector returns as plain JS arrays of numbers; we serialize manually for inserts.
    types: {
      vector: {
        to: 0,                                  // serialize ourselves
        from: [3614],                           // oid of vector type
        parse: (raw: string) => raw.slice(1, -1).split(",").map(Number),
        serialize: (v: number[]) => `[${v.join(",")}]`,
      },
    },
  });
  return _sql;
}

/**
 * Close the pool — useful for CLI scripts that need a clean exit.
 */
export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
  }
}

/**
 * Format a Float32Array as a pgvector string literal: `[0.1,0.2,...]`.
 * The wire format accepts this in INSERTs, e.g.:
 *   INSERT INTO chunks (... embedding) VALUES (..., ${vectorParam(vec)})
 */
export function vectorParam(vec: Float32Array | number[]): string {
  return `[${Array.from(vec).join(",")}]`;
}
