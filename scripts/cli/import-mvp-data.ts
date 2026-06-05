/**
 * CLI: import the MVP VMA Produtificação course into a tenant.
 *
 * Reads from the local data/ directory (lessons.json, transcripts/*.json,
 * vectors.db) and inserts into Postgres scoped to a target tenant.
 *
 * Idempotent: re-runs replace lessons / chunks for the same course slug.
 *
 * Usage:
 *   npx tsx scripts/cli/import-mvp-data.ts \
 *     --tenant-slug demo \
 *     [--course-slug produtificacao-vma] \
 *     [--course-name "Produtificação VMA"]
 */

import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import Database from "better-sqlite3";
import { sql, closeDb, vectorParam } from "../../src/lib/db.ts";

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

interface LessonJson {
  id: string;
  lessonNumber: number | null;
  title: string;
  rawTitle: string;
  durationSec: number;
  embedUrl: string;
  hlsUrl: string;
  thumbnailUrl: string;
  status: string;
}

interface TranscriptJson {
  lessonId: string;
  lessonNumber: number | null;
  title: string;
  language: string;
  durationSec: number;
  segments: { start: number; end: number; text: string }[];
  fullText: string;
}

interface ChunkRow {
  lesson_id: string;
  lesson_number: number | null;
  title: string;
  start_sec: number;
  end_sec: number;
  text: string;
  embedding: Buffer;
}

async function main() {
  const args = parseArgs();
  const root = process.cwd();

  // 1) Resolve tenant
  const tenants = await sql()<{ id: string; slug: string; name: string }[]>`
    SELECT id, slug, name FROM tenants WHERE slug = ${args.tenantSlug} LIMIT 1
  `;
  if (!tenants.length) {
    console.error(`Tenant "${args.tenantSlug}" not found. Run create-tenant first.`);
    process.exit(1);
  }
  const tenant = tenants[0];
  console.log(`✓ Tenant: ${tenant.slug} (${tenant.id})`);

  // 2) Upsert course — postgres-js auto-serializes plain objects to JSONB
  const courseConfig = { folder_id: "1c52c2e9-500e-4fde-b2aa-35e9f0aa5c11" };
  const courseRows = await sql()<{ id: string }[]>`
    INSERT INTO courses (tenant_id, name, slug, source_type, ingest_status, source_config)
    VALUES (
      ${tenant.id},
      ${args.courseName},
      ${args.courseSlug},
      'panda',
      'ingesting',
      ${courseConfig as unknown as string}
    )
    ON CONFLICT (tenant_id, slug) DO UPDATE
      SET name = EXCLUDED.name, ingest_status = 'ingesting', updated_at = NOW()
    RETURNING id
  `;
  const courseId = courseRows[0].id;
  console.log(`✓ Course: ${args.courseSlug} (${courseId})`);

  // 3) Wipe + reload lessons (idempotent)
  await sql()`DELETE FROM chunks WHERE course_id = ${courseId}`;
  await sql()`DELETE FROM lessons WHERE course_id = ${courseId}`;

  // 4) Read lessons.json
  const lessonsLocal: LessonJson[] = JSON.parse(
    readFileSync(resolvePath(root, "data/lessons.json"), "utf8"),
  );
  console.log(`✓ Read ${lessonsLocal.length} lessons from data/lessons.json`);

  // 5) Read transcripts by lessonId
  const transcriptsDir = resolvePath(root, "data/transcripts");
  const transcriptFiles = readdirSync(transcriptsDir);
  const transcriptsByLessonId = new Map<string, TranscriptJson>();
  for (const f of transcriptFiles) {
    if (!f.endsWith(".json")) continue;
    const t: TranscriptJson = JSON.parse(readFileSync(resolvePath(transcriptsDir, f), "utf8"));
    transcriptsByLessonId.set(t.lessonId, t);
  }
  console.log(`✓ Read ${transcriptsByLessonId.size} transcripts`);

  // 6) Insert lessons (with transcript JSONB inline) — track local-id → DB-id mapping
  const lessonIdMap = new Map<string, string>();
  for (const l of lessonsLocal) {
    const t = transcriptsByLessonId.get(l.id);
    const transcriptJsonb = t
      ? { language: t.language, segments: t.segments }
      : null;
    const rows = await sql()<{ id: string }[]>`
      INSERT INTO lessons (
        course_id, source_video_id, lesson_number, title, duration_sec,
        hls_url, embed_url, thumbnail_url, transcript, transcript_source
      ) VALUES (
        ${courseId},
        ${l.id},
        ${l.lessonNumber},
        ${l.title},
        ${l.durationSec},
        ${l.hlsUrl},
        ${l.embedUrl},
        ${l.thumbnailUrl},
        ${(transcriptJsonb as unknown as string) ?? null},
        'whisper'
      )
      RETURNING id
    `;
    lessonIdMap.set(l.id, rows[0].id);
  }
  console.log(`✓ Inserted ${lessonsLocal.length} lessons`);

  // 7) Read chunks from sqlite-vec → re-insert into Postgres with pgvector
  const sqliteDbPath = resolvePath(root, "data/vectors.db");
  const sqliteDb = new Database(sqliteDbPath, { readonly: true });
  // Local schema (from src/lib/store.ts):
  //   chunks(id, lesson_id, lesson_number, title, start_sec, end_sec, text)
  //   chunks_vec(rowid, embedding)
  const chunkRows: ChunkRow[] = sqliteDb.prepare(`
    SELECT c.lesson_id, c.lesson_number, c.title, c.start_sec, c.end_sec, c.text, v.embedding
    FROM chunks c
    JOIN chunks_vec v ON v.rowid = c.id
    ORDER BY c.id ASC
  `).all() as ChunkRow[];
  sqliteDb.close();
  console.log(`✓ Read ${chunkRows.length} chunks from sqlite-vec`);

  // 8) Insert chunks with embeddings (batches of 50 to stay under pgbouncer limits)
  const BATCH = 50;
  let inserted = 0;
  for (let i = 0; i < chunkRows.length; i += BATCH) {
    const batch = chunkRows.slice(i, i + BATCH);
    for (const c of batch) {
      const dbLessonId = lessonIdMap.get(c.lesson_id);
      if (!dbLessonId) {
        console.warn(`  skip chunk for missing lesson ${c.lesson_id}`);
        continue;
      }
      const f32 = new Float32Array(c.embedding.buffer, c.embedding.byteOffset, c.embedding.byteLength / 4);
      const vec = vectorParam(f32);
      await sql()`
        INSERT INTO chunks (course_id, source_type, lesson_id, start_sec, end_sec, text, embedding)
        VALUES (
          ${courseId},
          'lesson',
          ${dbLessonId},
          ${c.start_sec},
          ${c.end_sec},
          ${c.text},
          ${vec}::vector
        )
      `;
      inserted++;
    }
    process.stdout.write(`\r  inserted ${inserted}/${chunkRows.length}`);
  }
  console.log(`\n✓ Inserted ${inserted} chunks with embeddings`);

  // 9) Mark course ready
  await sql()`UPDATE courses SET ingest_status = 'ready', updated_at = NOW() WHERE id = ${courseId}`;
  console.log(`✓ Course marked ready`);

  console.log(`\n🎯 Done. Test with:\n   /t/${tenant.slug}/mcp → list_lessons → should return ${lessonsLocal.length} lessons.`);
  await closeDb();
}

main().catch(async (err) => {
  console.error("Failed:", err?.stack ?? err?.message ?? err);
  await closeDb();
  process.exit(1);
});
