/**
 * Per-student lesson progress. play_lesson invocations upsert a row;
 * get_my_progress reads them back joined with lesson metadata.
 *
 * Fields tracked (schema in migration 001):
 *   last_position_sec  — startSec from the most recent play_lesson call
 *   total_watched_sec  — placeholder; real watch-time tracking would
 *                        need pause/resume events from the widget, not
 *                        implemented yet
 *   completed_at       — set externally when the widget/UI signals
 *                        completion (not yet wired)
 */

import { sb } from "./db-api.ts";

export interface ProgressRow {
  studentId: string;
  lessonId: string;
  lessonNumber: number | null;
  lessonTitle: string;
  lessonDurationSec: number;
  lastPositionSec: number;
  completedAt: string | null;
  updatedAt: string;
}

/** Upsert progress for a student on a lesson. Best-effort, fire-and-forget. */
export function recordPlayLesson(args: {
  studentId: string;
  lessonId: string;
  startSec: number;
}): void {
  setImmediate(async () => {
    try {
      const existing = await sb.selectOne<{ id: string }>(
        "student_progress",
        `student_id=eq.${args.studentId}&lesson_id=eq.${args.lessonId}&select=id`,
      );
      if (existing) {
        await sb.update("student_progress", `id=eq.${existing.id}`, {
          last_position_sec: Math.max(0, Math.floor(args.startSec)),
          updated_at: new Date().toISOString(),
        });
      } else {
        await sb.insert("student_progress", {
          student_id: args.studentId,
          lesson_id: args.lessonId,
          last_position_sec: Math.max(0, Math.floor(args.startSec)),
        }, { returning: "minimal" });
      }
    } catch (err) {
      console.error("[progress] recordPlayLesson failed:", err);
    }
  });
}

/** All progress rows for a student within a course, joined with lessons. */
export async function getProgressForCourse(
  studentId: string,
  courseId: string,
): Promise<ProgressRow[]> {
  // PostgREST embedded select via lesson FK
  const rows = await sb.select<{
    student_id: string;
    lesson_id: string;
    last_position_sec: number;
    completed_at: string | null;
    updated_at: string;
    lessons: { lesson_number: number | null; title: string; duration_sec: number; course_id: string };
  }>(
    "student_progress",
    `student_id=eq.${studentId}&select=student_id,lesson_id,last_position_sec,completed_at,updated_at,lessons!inner(lesson_number,title,duration_sec,course_id)&lessons.course_id=eq.${courseId}`,
  );
  return rows.map((r) => ({
    studentId: r.student_id,
    lessonId: r.lesson_id,
    lessonNumber: r.lessons.lesson_number,
    lessonTitle: r.lessons.title,
    lessonDurationSec: r.lessons.duration_sec,
    lastPositionSec: r.last_position_sec,
    completedAt: r.completed_at,
    updatedAt: r.updated_at,
  }));
}

/** Per-tenant: aggregated student activity for the admin course detail. */
export interface StudentActivity {
  studentId: string;
  email: string;
  displayName: string | null;
  lastActiveAt: string | null;
  lessonsVisited: number;
  totalLessons: number;
}

export async function getCourseStudentActivity(
  tenantId: string,
  courseId: string,
): Promise<StudentActivity[]> {
  // Students with access to this course
  const grants = await sb.select<{
    student_id: string;
    students: { email: string; display_name: string | null; last_active_at: string | null; tenant_id: string };
  }>(
    "course_access",
    `course_id=eq.${courseId}&revoked_at=is.null&select=student_id,students!inner(email,display_name,last_active_at,tenant_id)&students.tenant_id=eq.${tenantId}`,
  );

  if (!grants.length) return [];

  // Total lessons in the course
  const lessons = await sb.select<{ id: string }>(
    "lessons",
    `course_id=eq.${courseId}&select=id`,
  );
  const totalLessons = lessons.length;
  const lessonIds = new Set(lessons.map((l) => l.id));

  // Progress rows per student for these lessons
  const progress = await sb.select<{ student_id: string; lesson_id: string }>(
    "student_progress",
    `student_id=in.(${grants.map((g) => g.student_id).join(",")})&select=student_id,lesson_id`,
  );
  const visitedByStudent: Record<string, Set<string>> = {};
  for (const p of progress) {
    if (!lessonIds.has(p.lesson_id)) continue;
    (visitedByStudent[p.student_id] ??= new Set()).add(p.lesson_id);
  }

  return grants.map((g) => ({
    studentId: g.student_id,
    email: g.students.email,
    displayName: g.students.display_name,
    lastActiveAt: g.students.last_active_at,
    lessonsVisited: visitedByStudent[g.student_id]?.size ?? 0,
    totalLessons,
  }));
}
