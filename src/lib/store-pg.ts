import { sql, vectorParam } from "./db.ts";

export interface SearchHitPg {
  chunkId: number;
  courseId: string;
  lessonId: string | null;
  materialId: string | null;
  sourceType: "lesson" | "material";
  lessonNumber: number | null;
  lessonTitle: string | null;
  materialName: string | null;
  startSec: number | null;
  endSec: number | null;
  text: string;
  distance: number;
}

interface SearchRow {
  chunk_id: number;
  course_id: string;
  lesson_id: string | null;
  material_id: string | null;
  source_type: "lesson" | "material";
  lesson_number: number | null;
  lesson_title: string | null;
  material_name: string | null;
  start_sec: number | null;
  end_sec: number | null;
  text: string;
  distance: number;
}

/**
 * Cosine-similarity search over chunks scoped to a single course.
 * Uses pgvector's `<=>` operator backed by the HNSW index from migration 001.
 *
 * The optional `lessonNumber` filter narrows to chunks within a specific lesson —
 * useful when the agent already knows which lesson to dig into.
 */
export async function searchChunksForCourse(
  courseId: string,
  queryEmbedding: Float32Array,
  opts: { limit?: number; lessonNumber?: number } = {},
): Promise<SearchHitPg[]> {
  const limit = opts.limit ?? 5;
  const vec = vectorParam(queryEmbedding);

  // Two query shapes — the `lesson_number` filter requires the join to lessons
  // to be present in the WHERE clause. Postgres prepared statements differ, so
  // we branch explicitly rather than building dynamic SQL.
  if (opts.lessonNumber !== undefined) {
    const rows = await sql()<SearchRow[]>`
      SELECT
        c.id            AS chunk_id,
        c.course_id     AS course_id,
        c.lesson_id     AS lesson_id,
        c.material_id   AS material_id,
        c.source_type   AS source_type,
        l.lesson_number AS lesson_number,
        l.title         AS lesson_title,
        m.name          AS material_name,
        c.start_sec     AS start_sec,
        c.end_sec       AS end_sec,
        c.text          AS text,
        (c.embedding <=> ${vec}::vector) AS distance
      FROM chunks c
      LEFT JOIN lessons   l ON l.id = c.lesson_id
      LEFT JOIN materials m ON m.id = c.material_id
      WHERE c.course_id = ${courseId}
        AND l.lesson_number = ${opts.lessonNumber}
      ORDER BY c.embedding <=> ${vec}::vector
      LIMIT ${limit}
    `;
    return rows.map(mapHit);
  }

  const rows = await sql()<SearchRow[]>`
    SELECT
      c.id            AS chunk_id,
      c.course_id     AS course_id,
      c.lesson_id     AS lesson_id,
      c.material_id   AS material_id,
      c.source_type   AS source_type,
      l.lesson_number AS lesson_number,
      l.title         AS lesson_title,
      m.name          AS material_name,
      c.start_sec     AS start_sec,
      c.end_sec       AS end_sec,
      c.text          AS text,
      (c.embedding <=> ${vec}::vector) AS distance
    FROM chunks c
    LEFT JOIN lessons   l ON l.id = c.lesson_id
    LEFT JOIN materials m ON m.id = c.material_id
    WHERE c.course_id = ${courseId}
    ORDER BY c.embedding <=> ${vec}::vector
    LIMIT ${limit}
  `;
  return rows.map(mapHit);
}

function mapHit(r: SearchRow): SearchHitPg {
  return {
    chunkId: r.chunk_id,
    courseId: r.course_id,
    lessonId: r.lesson_id,
    materialId: r.material_id,
    sourceType: r.source_type,
    lessonNumber: r.lesson_number,
    lessonTitle: r.lesson_title,
    materialName: r.material_name,
    startSec: r.start_sec,
    endSec: r.end_sec,
    text: r.text,
    distance: r.distance,
  };
}
