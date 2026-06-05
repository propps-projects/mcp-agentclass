/**
 * CLI: import the MVP VMA Produtificação course into a tenant — via PostgREST.
 *
 * Same job as import-mvp-data.ts, but talks to Supabase's REST API over HTTPS
 * (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) instead of the Postgres pooler.
 * Use this when local DATABASE_URL / pooler isn't reachable — REST goes through
 * Cloudflare and doesn't care about IPv4/IPv6 or pooler tenant registration.
 *
 * Idempotent: clears the course's existing lessons + chunks before reload.
 *
 * Usage:
 *   npx tsx scripts/cli/import-mvp-data-api.ts \
 *     --tenant-slug demo \
 *     [--course-slug produtificacao-vma] \
 *     [--course-name "Produtificação VMA"]
 */

import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

interface Args {
  tenantSlug: string;
  courseSlug: string;
  courseName: string;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const tenantSlug = get("--tenant-slug");
  if (!tenantSlug) {
    console.error("Missing --tenant-slug");
    process.exit(1);
  }
  return {
    tenantSlug,
    courseSlug: get("--course-slug") ?? "produtificacao-vma",
    courseName: get("--course-name") ?? "Produtificação VMA",
  };
}

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const BASE_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: { ...BASE_HEADERS, ...extraHeaders },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status} ${res.statusText}: ${text}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

interface LessonJson {
  id: string;
  lessonNumber: number | null;
  title: string;
  durationSec: number;
  embedUrl: string;
  hlsUrl: string;
  thumbnailUrl: string;
}

interface TranscriptJson {
  lessonId: string;
  language: string;
  segments: { start: number; end: number; text: string }[];
}

interface ChunkRow {
  lesson_id: string;
  start_sec: number;
  end_sec: number;
  text: string;
  embedding: Buffer;
}

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const args = parseArgs();
  const root = process.cwd();

  // 1) Resolve tenant
  const tenants = await api<{ id: string; slug: string; name: string }[]>(
    "GET",
    `/tenants?select=id,slug,name&slug=eq.${args.tenantSlug}`,
  );
  if (!tenants.length) {
    console.error(`Tenant "${args.tenantSlug}" not found. Create it first.`);
    process.exit(1);
  }
  const tenant = tenants[0];
  console.log(`✓ Tenant: ${tenant.slug} (${tenant.id})`);

  // 2) Upsert course — PostgREST supports upsert via Prefer: resolution=merge-duplicates
  // on a unique constraint. The (tenant_id, slug) unique constraint is named
  // courses_tenant_id_slug_key by default; resolution requires `on_conflict` param.
  const courseUpsert = await api<{ id: string; slug: string }[]>(
    "POST",
    `/courses?on_conflict=tenant_id,slug&select=id,slug`,
    [{
      tenant_id: tenant.id,
      name: args.courseName,
      slug: args.courseSlug,
      source_type: "panda",
      ingest_status: "ingesting",
      source_config: { folder_id: "1c52c2e9-500e-4fde-b2aa-35e9f0aa5c11" },
    }],
    { Prefer: "resolution=merge-duplicates,return=representation" },
  );
  const courseId = courseUpsert[0].id;
  console.log(`✓ Course: ${args.courseSlug} (${courseId})`);

  // 3) Wipe + reload — chunks first (FK to lessons)
  await api("DELETE", `/chunks?course_id=eq.${courseId}`);
  await api("DELETE", `/lessons?course_id=eq.${courseId}`);
  console.log(`✓ Cleared existing lessons + chunks for course`);

  // 4) Read local data
  const lessonsLocal: LessonJson[] = JSON.parse(
    readFileSync(resolvePath(root, "data/lessons.json"), "utf8"),
  );

  const transcriptsDir = resolvePath(root, "data/transcripts");
  const transcriptsByLessonId = new Map<string, TranscriptJson>();
  for (const f of readdirSync(transcriptsDir)) {
    if (!f.endsWith(".json")) continue;
    const t: TranscriptJson = JSON.parse(readFileSync(resolvePath(transcriptsDir, f), "utf8"));
    transcriptsByLessonId.set(t.lessonId, t);
  }
  console.log(`✓ Read ${lessonsLocal.length} lessons + ${transcriptsByLessonId.size} transcripts`);

  // 5) Insert lessons. PostgREST returns the inserted rows so we can map
  // source_video_id → DB lesson id for the chunks step.
  const lessonsBody = lessonsLocal.map((l) => {
    const t = transcriptsByLessonId.get(l.id);
    return {
      course_id: courseId,
      source_video_id: l.id,
      lesson_number: l.lessonNumber,
      title: l.title,
      duration_sec: l.durationSec,
      hls_url: l.hlsUrl,
      embed_url: l.embedUrl,
      thumbnail_url: l.thumbnailUrl,
      transcript: t ? { language: t.language, segments: t.segments } : null,
      transcript_source: "whisper",
    };
  });
  const insertedLessons = await api<{ id: string; source_video_id: string }[]>(
    "POST",
    `/lessons?select=id,source_video_id`,
    lessonsBody,
    { Prefer: "return=representation" },
  );
  const lessonIdMap = new Map(insertedLessons.map((l) => [l.source_video_id, l.id]));
  console.log(`✓ Inserted ${insertedLessons.length} lessons`);

  // 6) Read chunks from sqlite-vec, build payload with embedding as pgvector literal string
  const sqliteDb = new Database(resolvePath(root, "data/vectors.db"), { readonly: true });
  sqliteVec.load(sqliteDb);
  const chunkRows = sqliteDb.prepare(`
    SELECT c.lesson_id, c.start_sec, c.end_sec, c.text, v.embedding
    FROM chunks c
    JOIN chunks_vec v ON v.rowid = c.id
    ORDER BY c.id ASC
  `).all() as ChunkRow[];
  sqliteDb.close();

  const chunksBody = chunkRows
    .map((c) => {
      const dbLessonId = lessonIdMap.get(c.lesson_id);
      if (!dbLessonId) return null;
      const f32 = new Float32Array(c.embedding.buffer, c.embedding.byteOffset, c.embedding.byteLength / 4);
      // pgvector accepts string format "[n1,n2,...]" via PostgREST.
      const vecStr = `[${Array.from(f32).join(",")}]`;
      return {
        course_id: courseId,
        source_type: "lesson" as const,
        lesson_id: dbLessonId,
        start_sec: c.start_sec,
        end_sec: c.end_sec,
        text: c.text,
        embedding: vecStr,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  console.log(`✓ Prepared ${chunksBody.length} chunks for upload`);

  // 7) POST chunks in batches — keeps each request comfortably under HTTP limits.
  // Each chunk is ~7KB (text + 384 floats); batches of 20 ≈ 140KB per request.
  const BATCH = 20;
  let inserted = 0;
  for (const batch of chunked(chunksBody, BATCH)) {
    await api("POST", `/chunks`, batch, { Prefer: "return=minimal" });
    inserted += batch.length;
    process.stdout.write(`\r  inserted ${inserted}/${chunksBody.length}`);
  }
  console.log(`\n✓ Inserted ${inserted} chunks with embeddings`);

  // 8) Mark course ready
  await api(
    "PATCH",
    `/courses?id=eq.${courseId}`,
    { ingest_status: "ready" },
  );
  console.log(`✓ Course marked ready`);

  console.log(`\n🎯 Done. Test with:\n   /t/${tenant.slug}/mcp → list_lessons → should return ${lessonsLocal.length} lessons.`);
}

main().catch((err) => {
  console.error("Failed:", err?.message ?? err);
  process.exit(1);
});
