/**
 * Office Corporate Academy API v2
 * ═══════════════════════════════════════════════════════════════
 * GET  /lessons              — lessons for current user's track(s) + stats
 * GET  /lessons/:id          — full lesson content (correct_explanation hidden until passed)
 * POST /lessons/:id/start    — mark reading started (desktop compat)
 * POST /lessons/:id/complete — mark reading completed (requires MIN_READ_SECONDS)
 * POST /lessons/:id/heartbeat — reading time tracker (every 30s)
 * POST /lessons/:id/quiz     — submit quiz answers (retry logic: 2 attempts → re-read)
 * GET  /leaderboard          — department leaderboard with ranks
 * GET  /stats                — personal stats (rank, streak, xp)
 * GET  /articles             — short facts/tips feed
 *
 * ADMIN:
 * GET    /admin/drafts          — all lessons
 * PATCH  /admin/lessons/:id     — update lesson metadata
 * POST   /admin/bulk-publish    — publish all drafts for a month
 * GET    /admin/lessons/:id/preview — full lesson preview for admin
 *
 * Auth: fastify.authenticate (session JWT, req.user)
 */

'use strict';

// ── Constants ────────────────────────────────────────────────────
const MAX_ATTEMPTS      = 2;
const MIN_READ_SECONDS  = 60;
const PASS_THRESHOLD    = 80; // % to pass
const XP_FOR_PASS       = 30;
const XP_PERFECT        = 60;
const ADMIN_ROLES       = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];

// Role → track mapping
const ROLE_TRACKS = {
  PM:             ['pm', 'all'],
  TO:             ['pm', 'all'],
  HEAD_PM:        ['pm', 'management', 'all'],
  HEAD_TO:        ['pm', 'management', 'all'],
  CHIEF_ENGINEER: ['pm', 'all'],
  HR:             ['hr', 'all'],
  HR_MANAGER:     ['hr', 'all'],
  BUH:            ['finance', 'all'],
  PROC:           ['procurement', 'all'],
  WAREHOUSE:      ['procurement', 'all'],
  DIRECTOR_GEN:   ['management', 'all'],
  DIRECTOR_COMM:  ['management', 'all'],
  DIRECTOR_DEV:   ['management', 'all'],
  OFFICE_MANAGER: ['management', 'all'],
  ADMIN:          ['pm', 'hr', 'finance', 'procurement', 'management', 'all'],
};

// Rank thresholds (like Mimir but office-themed)
const RANKS = [
  { min: 25, icon: '👑', name: 'Мастер',  color: '#c8a84b' },
  { min: 13, icon: '⚔️', name: 'Воин',    color: '#7b61ff' },
  { min: 5,  icon: '🛡️', name: 'Страж',   color: '#3b82f6' },
  { min: 0,  icon: '📜', name: 'Ученик',  color: '#6b7280' },
];

function getUserTracks(role) {
  return ROLE_TRACKS[role] || ['all'];
}

function getRank(lessonsPassed) {
  return RANKS.find(r => lessonsPassed >= r.min) || RANKS[RANKS.length - 1];
}

async function routes(fastify) {
  const db = fastify.db;
  const auth = { preHandler: [fastify.authenticate] };

  // ── GET /lessons — list for current user ──────────────────────
  fastify.get('/lessons', auth, async (req) => {
    const userId = req.user.id;
    const tracks = getUserTracks(req.user.role);
    const now = new Date();

    const { rows } = await db.query(`
      SELECT l.id, l.month_number, l.track, l.title, l.saga,
             l.cover_icon, l.cover_color, l.estimated_minutes,
             l.is_mandatory, l.release_date, l.published_at, l.tags,
             p.read_started_at, p.read_completed_at, p.read_time_seconds,
             p.passed, p.score, p.attempts, p.passed_at, p.xp_earned
      FROM office_academy_lessons l
      LEFT JOIN office_academy_user_progress p ON p.lesson_id = l.id AND p.user_id = $1
      WHERE l.status = 'published'
        AND l.track = ANY($2::text[])
        AND (l.release_date IS NULL OR l.release_date <= $3)
      ORDER BY l.is_mandatory DESC, l.release_date DESC, l.month_number DESC
    `, [userId, tracks, now]);

    // Stats
    const total = rows.length;
    const passed = rows.filter(r => r.passed).length;
    const mandatory_pending = rows.filter(r => r.is_mandatory && !r.passed).length;
    const total_xp = rows.reduce((s, r) => s + (r.xp_earned || 0), 0);
    const rank = getRank(passed);

    return {
      lessons: rows, total, passed, mandatory_pending, total_xp, rank,
      max_attempts: MAX_ATTEMPTS, pass_threshold: PASS_THRESHOLD,
    };
  });

  // ── GET /lessons/:id — full lesson with blocks and quiz ───────
  fastify.get('/lessons/:id', auth, async (req, reply) => {
    const userId = req.user.id;
    const lessonId = parseInt(req.params.id, 10);

    const { rows: [lesson] } = await db.query(
      `SELECT l.*,
              p.read_started_at, p.read_completed_at, p.read_time_seconds,
              p.passed, p.score, p.attempts, p.passed_at, p.xp_earned,
              p.last_attempt_at
       FROM office_academy_lessons l
       LEFT JOIN office_academy_user_progress p ON p.lesson_id = l.id AND p.user_id = $2
       WHERE l.id = $1 AND l.status = 'published'`,
      [lessonId, userId]
    );
    if (!lesson) return reply.code(404).send({ error: 'Урок не найден' });

    // Auto-start reading
    if (!lesson.read_started_at) {
      await db.query(`
        INSERT INTO office_academy_user_progress (user_id, lesson_id, read_started_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (user_id, lesson_id) DO UPDATE SET
          read_started_at = COALESCE(office_academy_user_progress.read_started_at, NOW()),
          updated_at = NOW()
      `, [userId, lessonId]);
      lesson.read_started_at = new Date();
    }

    // Questions — hide correct_explanation until passed
    const { rows: questions } = await db.query(
      `SELECT id, sort_order, question_type, question_text, options, correct_explanation, image_url
       FROM office_academy_quiz_questions WHERE lesson_id = $1 ORDER BY sort_order`,
      [lessonId]
    );

    // Sanitize: strip is_correct and correct_explanation if not passed
    const sanitizedQuestions = questions.map(q => {
      if (lesson.passed) return q;
      const opts = (q.options || []).map(o => ({ text: o.text })); // strip is_correct
      return { ...q, options: opts, correct_explanation: null };
    });

    // Retry state
    const needsReread = lesson.attempts >= MAX_ATTEMPTS && !lesson.passed && !lesson.read_completed_at;
    const attemptsLeft = lesson.passed ? 0 : Math.max(0, MAX_ATTEMPTS - (lesson.attempts || 0));

    return {
      lesson, questions: sanitizedQuestions,
      retry: { needs_reread: needsReread, attempts_left: attemptsLeft, max_attempts: MAX_ATTEMPTS, min_read_seconds: MIN_READ_SECONDS },
      pass_threshold: PASS_THRESHOLD,
    };
  });

  // ── POST /lessons/:id/start — mark reading started (desktop compat) ──
  fastify.post('/lessons/:id/start', auth, async (req) => {
    const userId = req.user.id;
    const lessonId = parseInt(req.params.id, 10);
    await db.query(`
      INSERT INTO office_academy_user_progress (user_id, lesson_id, read_started_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (user_id, lesson_id) DO UPDATE SET
        read_started_at = COALESCE(office_academy_user_progress.read_started_at, NOW()),
        updated_at = NOW()
    `, [userId, lessonId]);
    return { ok: true };
  });

  // ── POST /lessons/:id/heartbeat — reading time tracker ────────
  fastify.post('/lessons/:id/heartbeat', auth, async (req) => {
    const userId = req.user.id;
    const lessonId = parseInt(req.params.id, 10);
    const seconds = parseInt(req.body?.seconds, 10) || 30;

    await db.query(`
      INSERT INTO office_academy_user_progress (user_id, lesson_id, read_started_at, read_time_seconds, updated_at)
      VALUES ($1, $2, NOW(), $3, NOW())
      ON CONFLICT (user_id, lesson_id) DO UPDATE SET
        read_time_seconds = office_academy_user_progress.read_time_seconds + $3,
        updated_at = NOW()
    `, [userId, lessonId, Math.min(seconds, 60)]);
    return { ok: true };
  });

  // ── POST /lessons/:id/complete — mark reading done ────────────
  fastify.post('/lessons/:id/complete', auth, async (req) => {
    const userId = req.user.id;
    const lessonId = parseInt(req.params.id, 10);

    // Check minimum read time
    const { rows: [progress] } = await db.query(
      `SELECT read_time_seconds, attempts, passed FROM office_academy_user_progress
       WHERE user_id = $1 AND lesson_id = $2`,
      [userId, lessonId]
    );

    const readTime = progress?.read_time_seconds || 0;

    // If re-reading after failed attempts, require MIN_READ_SECONDS
    if (progress && progress.attempts >= MAX_ATTEMPTS && !progress.passed) {
      if (readTime < MIN_READ_SECONDS) {
        return { ok: false, error: 'read_more', read_time: readTime, min_required: MIN_READ_SECONDS };
      }
      // Reset attempts after re-read
      await db.query(`
        UPDATE office_academy_user_progress
        SET read_completed_at = NOW(), attempts = 0, read_time_seconds = 0, updated_at = NOW()
        WHERE user_id = $1 AND lesson_id = $2
      `, [userId, lessonId]);
      return { ok: true, attempts_reset: true };
    }

    await db.query(`
      INSERT INTO office_academy_user_progress (user_id, lesson_id, read_started_at, read_completed_at, updated_at)
      VALUES ($1, $2, NOW(), NOW(), NOW())
      ON CONFLICT (user_id, lesson_id) DO UPDATE SET read_completed_at = NOW(), updated_at = NOW()
    `, [userId, lessonId]);
    return { ok: true };
  });

  // ── POST /lessons/:id/quiz — submit answers, compute score ────
  fastify.post('/lessons/:id/quiz', auth, async (req, reply) => {
    const userId = req.user.id;
    const lessonId = parseInt(req.params.id, 10);
    const { answers } = req.body || {};

    if (!answers || typeof answers !== 'object') {
      return reply.code(400).send({ error: 'answers required' });
    }

    // Check progress — enforce retry logic
    const { rows: [progress] } = await db.query(
      `SELECT attempts, passed, read_completed_at FROM office_academy_user_progress
       WHERE user_id = $1 AND lesson_id = $2`,
      [userId, lessonId]
    );

    if (progress && progress.passed) {
      // Already passed — allow retake but don't downgrade
    } else if (progress && progress.attempts >= MAX_ATTEMPTS && !progress.read_completed_at) {
      return reply.code(400).send({
        error: 'needs_reread',
        message: 'Перечитай свиток внимательно, чтобы получить новые попытки',
      });
    }

    const { rows: questions } = await db.query(
      `SELECT id, options, correct_explanation FROM office_academy_quiz_questions WHERE lesson_id = $1`,
      [lessonId]
    );
    if (!questions.length) return reply.code(404).send({ error: 'Вопросы не найдены' });

    let correct = 0;
    const feedback = [];
    const attemptAnswers = [];

    for (const q of questions) {
      const selected = answers[q.id];
      const opts = Array.isArray(q.options) ? q.options : [];
      const correctIdx = opts.findIndex(o => o.is_correct);
      const isCorrect = selected !== undefined && parseInt(selected) === correctIdx;
      if (isCorrect) correct++;
      feedback.push({
        question_id: q.id,
        is_correct: isCorrect,
        correct_index: correctIdx,
        explanation: q.correct_explanation || null,
      });
      attemptAnswers.push({
        question_id: q.id,
        selected_option: selected !== undefined ? parseInt(selected) : -1,
        is_correct: isCorrect,
      });
    }

    const score = Math.round((correct / questions.length) * 100);
    const passed = score >= PASS_THRESHOLD;
    const currentAttempts = (progress?.attempts || 0) + 1;

    // Calculate XP
    let xp = 0;
    if (passed && !(progress?.passed)) {
      xp = score === 100 ? XP_PERFECT : XP_FOR_PASS;
    }

    // Record attempt in history
    await db.query(`
      INSERT INTO office_academy_quiz_attempts (user_id, lesson_id, attempt_number, answers, score, passed, finished_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [userId, lessonId, currentAttempts, JSON.stringify(attemptAnswers), score, passed]);

    // Update progress
    if (passed) {
      await db.query(`
        INSERT INTO office_academy_user_progress
          (user_id, lesson_id, read_started_at, read_completed_at, passed, score, attempts, passed_at, xp_earned, last_attempt_at, updated_at)
        VALUES ($1, $2, NOW(), NOW(), true, $3, $4, NOW(), $5, NOW(), NOW())
        ON CONFLICT (user_id, lesson_id) DO UPDATE SET
          passed = GREATEST(office_academy_user_progress.passed::int, 1)::boolean,
          score = GREATEST(office_academy_user_progress.score, $3),
          attempts = office_academy_user_progress.attempts + 1,
          passed_at = CASE WHEN office_academy_user_progress.passed_at IS NULL THEN NOW() ELSE office_academy_user_progress.passed_at END,
          xp_earned = GREATEST(office_academy_user_progress.xp_earned, $5),
          last_attempt_at = NOW(),
          read_completed_at = NOW(), updated_at = NOW()
      `, [userId, lessonId, score, currentAttempts, xp]);
    } else {
      // Failed — check if needs re-read (use CASE in SQL, not template interpolation)
      const needsReread = currentAttempts >= MAX_ATTEMPTS;

      await db.query(`
        INSERT INTO office_academy_user_progress
          (user_id, lesson_id, read_started_at, read_completed_at, passed, score, attempts, last_attempt_at, updated_at)
        VALUES ($1, $2, NOW(), CASE WHEN $5 THEN NULL ELSE NOW() END, false, $3, $4, NOW(), NOW())
        ON CONFLICT (user_id, lesson_id) DO UPDATE SET
          score = GREATEST(office_academy_user_progress.score, $3),
          attempts = office_academy_user_progress.attempts + 1,
          last_attempt_at = NOW(),
          read_completed_at = CASE WHEN $5 THEN NULL ELSE office_academy_user_progress.read_completed_at END,
          read_time_seconds = CASE WHEN $5 THEN 0 ELSE office_academy_user_progress.read_time_seconds END,
          updated_at = NOW()
      `, [userId, lessonId, score, currentAttempts, needsReread]);

      // Notify manager after 5+ total failures
      if (currentAttempts >= 5) {
        try {
          await notifyManagerAboutStruggle(db, userId, lessonId, currentAttempts);
        } catch (e) {
          fastify.log.error('[OfficeAcademy] Notification error:', e.message);
        }
      }
    }

    const attemptsLeft = passed ? 0 : Math.max(0, MAX_ATTEMPTS - currentAttempts);
    const needsReread = !passed && currentAttempts >= MAX_ATTEMPTS;

    return {
      score, passed, correct, total: questions.length, feedback, xp,
      pass_threshold: PASS_THRESHOLD,
      retry: {
        attempts_left: attemptsLeft,
        needs_reread: needsReread,
        max_attempts: MAX_ATTEMPTS,
        min_read_seconds: MIN_READ_SECONDS,
        pass_threshold: PASS_THRESHOLD,
      },
    };
  });

  // ── GET /leaderboard — top users by passed lessons + avg score ─
  fastify.get('/leaderboard', auth, async () => {
    const { rows } = await db.query(`
      SELECT u.id, u.name as fio, u.role,
             COUNT(p.id)::int as lessons_passed,
             ROUND(AVG(p.score) FILTER (WHERE p.passed))::int as avg_score,
             COALESCE(SUM(p.xp_earned), 0)::int as total_xp
      FROM office_academy_user_progress p
      JOIN users u ON u.id = p.user_id
      WHERE p.passed = true
      GROUP BY u.id, u.name, u.role
      ORDER BY lessons_passed DESC, avg_score DESC
      LIMIT 20
    `);

    // Add rank to each user
    const leaderboard = rows.map(u => ({
      ...u,
      rank: getRank(u.lessons_passed),
    }));

    return { leaderboard };
  });

  // ── GET /stats — personal stats ───────────────────────────────
  fastify.get('/stats', auth, async (req) => {
    const userId = req.user.id;

    const { rows: [stats] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE passed)::int as lessons_passed,
        COUNT(*)::int as lessons_started,
        ROUND(AVG(score) FILTER (WHERE passed))::int as avg_score,
        COALESCE(SUM(xp_earned), 0)::int as total_xp,
        MAX(passed_at) as last_passed_at
      FROM office_academy_user_progress
      WHERE user_id = $1
    `, [userId]);

    const lessonsPassed = stats?.lessons_passed || 0;
    const rank = getRank(lessonsPassed);

    // Calculate streak (consecutive months with at least 1 passed lesson)
    const { rows: monthlyPasses } = await db.query(`
      SELECT DISTINCT DATE_TRUNC('month', passed_at)::date as month
      FROM office_academy_user_progress
      WHERE user_id = $1 AND passed = true AND passed_at IS NOT NULL
      ORDER BY month DESC
    `, [userId]);

    let streak = 0;
    const now = new Date();
    let checkYear = now.getFullYear();
    let checkMon = now.getMonth(); // 0-based
    for (const row of monthlyPasses) {
      const passMonth = new Date(row.month);
      // Compare year+month only (avoids UTC vs local timezone mismatch)
      if (passMonth.getUTCFullYear() === checkYear && passMonth.getUTCMonth() === checkMon) {
        streak++;
        checkMon--;
        if (checkMon < 0) { checkMon = 11; checkYear--; }
      } else {
        break;
      }
    }

    return {
      ...stats,
      rank,
      streak,
      ranks: RANKS,
    };
  });

  // ── GET /articles — short facts/tips feed ─────────────────────
  fastify.get('/articles', auth, async (req) => {
    const tracks = getUserTracks(req.user.role);
    const { rows } = await db.query(`
      SELECT id, title, saga, cover_icon, cover_color, tags, estimated_minutes, published_at
      FROM office_academy_lessons
      WHERE status = 'published' AND track = ANY($1::text[])
      ORDER BY published_at DESC LIMIT 20
    `, [tracks]);
    return { articles: rows };
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN ROUTES
  // ═══════════════════════════════════════════════════════════════

  // ── GET /admin/drafts — all lessons ───────────────────────────
  fastify.get('/admin/drafts', auth, async (req, reply) => {
    if (!ADMIN_ROLES.includes(req.user.role)) return reply.code(403).send({ error: 'Нет доступа' });

    const { rows } = await db.query(`
      SELECT l.id, l.month_number, l.track, l.title, l.saga, l.status, l.is_mandatory,
             l.cover_icon, l.cover_color, l.release_date, l.generated_by, l.created_at,
             l.estimated_minutes,
             (SELECT COUNT(*) FROM office_academy_quiz_questions WHERE lesson_id = l.id)::int as questions_count,
             (SELECT COUNT(*) FROM office_academy_user_progress WHERE lesson_id = l.id AND passed = true)::int as passed_count
      FROM office_academy_lessons l
      ORDER BY l.status, l.month_number DESC, l.track
    `);
    return { lessons: rows };
  });

  // ── GET /admin/lessons/:id/preview — full lesson for admin ────
  fastify.get('/admin/lessons/:id/preview', auth, async (req, reply) => {
    if (!ADMIN_ROLES.includes(req.user.role)) return reply.code(403).send({ error: 'Нет доступа' });

    const lessonId = parseInt(req.params.id, 10);
    const { rows: [lesson] } = await db.query(
      `SELECT * FROM office_academy_lessons WHERE id = $1`, [lessonId]
    );
    if (!lesson) return reply.code(404).send({ error: 'Урок не найден' });

    const { rows: questions } = await db.query(
      `SELECT * FROM office_academy_quiz_questions WHERE lesson_id = $1 ORDER BY sort_order`,
      [lessonId]
    );

    return { lesson, questions };
  });

  // ── PATCH /admin/lessons/:id — update lesson metadata ─────────
  fastify.patch('/admin/lessons/:id', auth, async (req, reply) => {
    if (!ADMIN_ROLES.includes(req.user.role)) return reply.code(403).send({ error: 'Нет доступа' });

    const lessonId = parseInt(req.params.id, 10);
    const { status, is_mandatory, release_date } = req.body || {};

    const updates = [];
    const vals = [];
    let i = 1;

    if (status) { updates.push(`status = $${i++}`); vals.push(status); }
    if (status === 'published') { updates.push(`published_at = $${i++}`); vals.push(new Date()); }
    if (is_mandatory !== undefined) { updates.push(`is_mandatory = $${i++}`); vals.push(Boolean(is_mandatory)); }
    if (release_date) { updates.push(`release_date = $${i++}`); vals.push(release_date); }

    if (!updates.length) return reply.code(400).send({ error: 'Нет данных для обновления' });

    vals.push(lessonId);
    await db.query(`UPDATE office_academy_lessons SET ${updates.join(',')} WHERE id = $${i}`, vals);
    return { ok: true };
  });

  // ── POST /admin/bulk-publish — publish all drafts for a month ─
  fastify.post('/admin/bulk-publish', auth, async (req, reply) => {
    if (!ADMIN_ROLES.includes(req.user.role)) return reply.code(403).send({ error: 'Нет доступа' });

    const { month_number } = req.body || {};
    if (!month_number) return reply.code(400).send({ error: 'month_number required' });

    const { rowCount } = await db.query(`
      UPDATE office_academy_lessons
      SET status = 'published', published_at = NOW(),
          release_date = COALESCE(release_date, CURRENT_DATE)
      WHERE month_number = $1 AND status = 'draft'
    `, [month_number]);

    return { ok: true, published: rowCount };
  });
}

// ── Helper: notify manager about struggling user ────────────────
async function notifyManagerAboutStruggle(db, userId, lessonId, attempts) {
  // Get user info
  const { rows: [user] } = await db.query(
    `SELECT name, role FROM users WHERE id = $1`, [userId]
  );
  if (!user) return;

  // Get lesson info
  const { rows: [lesson] } = await db.query(
    `SELECT title FROM office_academy_lessons WHERE id = $1`, [lessonId]
  );
  if (!lesson) return;

  // Find managers to notify
  const managerRoles = ['HEAD_PM', 'HEAD_TO', 'HR_MANAGER', 'DIRECTOR_GEN'];
  const { rows: managers } = await db.query(
    `SELECT id FROM users WHERE role = ANY($1::text[]) AND is_active = true`,
    [managerRoles]
  );

  // Check dedup — don't spam within 7 days
  const { rows: recent } = await db.query(`
    SELECT id FROM notifications
    WHERE user_id = ANY($1::int[])
      AND type = 'academy_office_struggle'
      AND metadata->>'target_user_id' = $2
      AND metadata->>'lesson_id' = $3
      AND created_at > NOW() - INTERVAL '7 days'
    LIMIT 1
  `, [managers.map(m => m.id), String(userId), String(lessonId)]);

  if (recent.length > 0) return;

  for (const mgr of managers) {
    await db.query(`
      INSERT INTO notifications (user_id, type, title, message, metadata, created_at)
      VALUES ($1, 'academy_office_struggle', $2, $3, $4, NOW())
    `, [
      mgr.id,
      '🏛️ Сотрудник застрял в Академии',
      `${user.name} (${user.role}) не может сдать «${lesson.title}» — ${attempts} попыток`,
      JSON.stringify({ target_user_id: userId, lesson_id: lessonId, attempts }),
    ]);
  }
}

module.exports = routes;
