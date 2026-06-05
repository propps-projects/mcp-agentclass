import { sql } from "./db.ts";

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface LessonPg {
  id: string;
  courseId: string;
  sourceVideoId: string;
  lessonNumber: number | null;
  title: string;
  durationSec: number;
  hlsUrl: string | null;
  embedUrl: string | null;
  thumbnailUrl: string | null;
  transcript: { language: string; segments: Segment[] } | null;
}

interface LessonRow {
  id: string;
  course_id: string;
  source_video_id: string;
  lesson_number: number | null;
  title: string;
  duration_sec: number;
  hls_url: string | null;
  embed_url: string | null;
  thumbnail_url: string | null;
  transcript: { language: string; segments: Segment[] } | null;
}

function mapLesson(r: LessonRow): LessonPg {
  return {
    id: r.id,
    courseId: r.course_id,
    sourceVideoId: r.source_video_id,
    lessonNumber: r.lesson_number,
    title: r.title,
    durationSec: r.duration_sec,
    hlsUrl: r.hls_url,
    embedUrl: r.embed_url,
    thumbnailUrl: r.thumbnail_url,
    transcript: r.transcript,
  };
}

export async function listLessonsForCourse(courseId: string): Promise<LessonPg[]> {
  const rows = await sql()<LessonRow[]>`
    SELECT id, course_id, source_video_id, lesson_number, title, duration_sec,
           hls_url, embed_url, thumbnail_url, transcript
    FROM lessons
    WHERE course_id = ${courseId}
    ORDER BY lesson_number ASC NULLS LAST
  `;
  return rows.map(mapLesson);
}

export async function findLessonInCourse(
  courseId: string,
  ref: { lessonNumber?: number; lessonId?: string },
): Promise<LessonPg | null> {
  if (ref.lessonId) {
    const rows = await sql()<LessonRow[]>`
      SELECT id, course_id, source_video_id, lesson_number, title, duration_sec,
             hls_url, embed_url, thumbnail_url, transcript
      FROM lessons
      WHERE course_id = ${courseId} AND id = ${ref.lessonId}
      LIMIT 1
    `;
    return rows[0] ? mapLesson(rows[0]) : null;
  }
  if (ref.lessonNumber !== undefined) {
    const rows = await sql()<LessonRow[]>`
      SELECT id, course_id, source_video_id, lesson_number, title, duration_sec,
             hls_url, embed_url, thumbnail_url, transcript
      FROM lessons
      WHERE course_id = ${courseId} AND lesson_number = ${ref.lessonNumber}
      LIMIT 1
    `;
    return rows[0] ? mapLesson(rows[0]) : null;
  }
  return null;
}

/**
 * Segments within a [startSec, endSec] window of a lesson's transcript.
 * Returns empty array when transcript not yet generated.
 */
export function excerptFromTranscript(
  lesson: LessonPg,
  startSec: number,
  endSec: number,
): Segment[] {
  if (!lesson.transcript) return [];
  return lesson.transcript.segments.filter((s) => s.end >= startSec && s.start <= endSec);
}
