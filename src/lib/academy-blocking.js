'use strict';

/**
 * Чертоги Мимира — единая логика блокировки смены.
 * Правило одной руны + enrollment cutoff + onboarding для новичков.
 */

const ACADEMY_ROLLOUT_MONDAY = process.env.ACADEMY_ROLLOUT_MONDAY || '2026-07-07';
const NEW_HIRE_LOGISTICS_GRACE_DAYS = parseInt(process.env.NEW_HIRE_LOGISTICS_GRACE_DAYS || '1', 10);
const ONBOARDING_LESSON_WEEK = parseInt(process.env.ONBOARDING_LESSON_WEEK || '1', 10);

function getCurrentMondayDate(refDate = new Date()) {
  const now = new Date(refDate);
  const dayOfWeek = now.getDay() || 7;
  const mon = new Date(now);
  mon.setDate(now.getDate() - (dayOfWeek - 1));
  mon.setHours(0, 0, 0, 0);
  return mon.toISOString().split('T')[0];
}

function toDateStr(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.split('T')[0];
  return new Date(d).toISOString().split('T')[0];
}

function mondayOfDate(d) {
  const dt = new Date(d);
  const dayOfWeek = dt.getDay() || 7;
  const mon = new Date(dt);
  mon.setDate(dt.getDate() - (dayOfWeek - 1));
  mon.setHours(0, 0, 0, 0);
  return mon.toISOString().split('T')[0];
}

function resolveEnrollmentMonday(emp) {
  if (emp.academy_enrolled_at) return toDateStr(emp.academy_enrolled_at);
  if (!emp.created_at) return ACADEMY_ROLLOUT_MONDAY;
  const hireMonday = mondayOfDate(emp.created_at);
  if (hireMonday < ACADEMY_ROLLOUT_MONDAY) return ACADEMY_ROLLOUT_MONDAY;
  return hireMonday;
}

async function loadEmployee(db, employeeId) {
  const { rows: [emp] } = await db.query(`
    SELECT id, created_at, academy_enrolled_at, academy_onboarding_passed_at
    FROM employees WHERE id = $1
  `, [employeeId]);
  return emp || null;
}

async function isLessonWaived(db, employeeId, lessonId) {
  const { rows } = await db.query(`
    SELECT 1 FROM academy_lesson_waivers
    WHERE employee_id = $1
      AND (lesson_id = $2 OR lesson_id IS NULL)
      AND (effective_until IS NULL OR effective_until >= CURRENT_DATE)
    LIMIT 1
  `, [employeeId, lessonId]);
  return rows.length > 0;
}

async function getOnboardingLesson(db, employeeId) {
  const { rows: [lesson] } = await db.query(`
    SELECT al.id, al.title, al.week_number, al.saga, al.cover_icon, al.cover_color,
           al.estimated_minutes, al.is_mandatory, al.is_onboarding, al.release_monday,
           al.tags, al.blocks,
           awp.read_started_at, awp.read_completed_at, awp.read_time_seconds,
           awp.attempts, awp.score, awp.passed, awp.passed_at
    FROM academy_lessons al
    LEFT JOIN academy_worker_progress awp
      ON awp.lesson_id = al.id AND awp.employee_id = $1
    WHERE al.status = 'published'
      AND al.is_onboarding = true
    ORDER BY al.week_number ASC
    LIMIT 1
  `, [employeeId]);

  if (lesson) return lesson;

  const { rows: [fallback] } = await db.query(`
    SELECT al.id, al.title, al.week_number, al.saga, al.cover_icon, al.cover_color,
           al.estimated_minutes, al.is_mandatory, al.is_onboarding, al.release_monday,
           al.tags, al.blocks,
           awp.read_started_at, awp.read_completed_at, awp.read_time_seconds,
           awp.attempts, awp.score, awp.passed, awp.passed_at
    FROM academy_lessons al
    LEFT JOIN academy_worker_progress awp
      ON awp.lesson_id = al.id AND awp.employee_id = $1
    WHERE al.status = 'published' AND al.week_number = $2
    LIMIT 1
  `, [employeeId, ONBOARDING_LESSON_WEEK]);

  return fallback || null;
}

/**
 * @returns {{
 *   allowed: boolean,
 *   blocking: object|null,
 *   blocking_reason: 'onboarding'|'weekly_overdue'|null,
 *   blocking_lesson_id?: number,
 *   blocking_lesson_title?: string,
 *   grace_logistics?: boolean,
 *   enrolled_monday?: string,
 *   waived?: boolean,
 * }}
 */
async function getBlockingLesson(db, employeeId) {
  const emp = await loadEmployee(db, employeeId);
  if (!emp) {
    return { allowed: true, blocking: null, blocking_reason: null };
  }

  const hireAgeDays = emp.created_at
    ? (Date.now() - new Date(emp.created_at).getTime()) / 86400000
    : 999;

  if (hireAgeDays < NEW_HIRE_LOGISTICS_GRACE_DAYS) {
    return {
      allowed: true,
      blocking: null,
      blocking_reason: null,
      grace_logistics: true,
    };
  }

  const enrolledMonday = resolveEnrollmentMonday(emp);
  const monDate = getCurrentMondayDate();

  if (!emp.academy_onboarding_passed_at) {
    const onboarding = await getOnboardingLesson(db, employeeId);
    if (onboarding && !onboarding.passed) {
      const waived = await isLessonWaived(db, employeeId, onboarding.id);
      if (!waived) {
        return {
          allowed: false,
          blocking: onboarding,
          blocking_reason: 'onboarding',
          blocking_lesson_id: onboarding.id,
          blocking_lesson_title: onboarding.title,
          enrolled_monday: enrolledMonday,
        };
      }
    }
  }

  const { rows: [lesson] } = await db.query(`
    SELECT al.id, al.title, al.week_number, al.saga, al.cover_icon, al.cover_color,
           al.estimated_minutes, al.is_mandatory, al.is_onboarding, al.release_monday,
           al.tags, al.blocks,
           awp.read_started_at, awp.read_completed_at, awp.read_time_seconds,
           awp.attempts, awp.score, awp.passed, awp.passed_at
    FROM academy_lessons al
    LEFT JOIN academy_worker_progress awp
      ON awp.lesson_id = al.id AND awp.employee_id = $1
    WHERE al.status = 'published'
      AND al.is_mandatory = true
      AND al.is_onboarding = false
      AND al.release_monday IS NOT NULL
      AND al.release_monday < $2
      AND al.release_monday >= $3
      AND (awp.passed IS NULL OR awp.passed = false)
    ORDER BY al.week_number DESC
    LIMIT 1
  `, [employeeId, monDate, enrolledMonday]);

  if (!lesson) {
    return {
      allowed: true,
      blocking: null,
      blocking_reason: null,
      enrolled_monday: enrolledMonday,
    };
  }

  const waived = await isLessonWaived(db, employeeId, lesson.id);
  if (waived) {
    return {
      allowed: true,
      blocking: null,
      blocking_reason: null,
      enrolled_monday: enrolledMonday,
      waived: true,
    };
  }

  return {
    allowed: false,
    blocking: lesson,
    blocking_reason: 'weekly_overdue',
    blocking_lesson_id: lesson.id,
    blocking_lesson_title: lesson.title,
    enrolled_monday: enrolledMonday,
  };
}

async function markOnboardingPassedIfNeeded(db, employeeId, lessonId) {
  const { rows: [lesson] } = await db.query(`
    SELECT id, is_onboarding, week_number FROM academy_lessons WHERE id = $1
  `, [lessonId]);
  if (!lesson) return;

  const isOnboarding = lesson.is_onboarding || lesson.week_number === ONBOARDING_LESSON_WEEK;
  if (!isOnboarding) return;

  await db.query(`
    UPDATE employees
    SET academy_onboarding_passed_at = COALESCE(academy_onboarding_passed_at, NOW())
    WHERE id = $1 AND academy_onboarding_passed_at IS NULL
  `, [employeeId]);
}

module.exports = {
  ACADEMY_ROLLOUT_MONDAY,
  NEW_HIRE_LOGISTICS_GRACE_DAYS,
  ONBOARDING_LESSON_WEEK,
  getCurrentMondayDate,
  resolveEnrollmentMonday,
  getBlockingLesson,
  markOnboardingPassedIfNeeded,
  isLessonWaived,
  loadEmployee,
};
