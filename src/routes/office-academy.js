/**
 * Office Corporate Academy API
 * ═══════════════════════════════════════════════════════════════
 * GET  /lessons              — lessons for current user's track(s)
 * GET  /lessons/:id          — full lesson content
 * POST /lessons/:id/start    — mark reading started
 * POST /lessons/:id/complete — mark reading completed
 * POST /lessons/:id/quiz     — submit quiz answers
 * GET  /leaderboard          — department leaderboard
 * GET  /articles             — short facts/tips feed
 *
 * Auth: fastify.authenticate (session JWT, req.user)
 */

// Role → track mapping
const ROLE_TRACKS = {
  PM: ['pm', 'all'],
  TO: ['pm', 'all'],
  HEAD_PM: ['pm', 'management', 'all'],
  HEAD_TO: ['pm', 'management', 'all'],
  CHIEF_ENGINEER: ['pm', 'all'],
  HR: ['hr', 'all'],
  HR_MANAGER: ['hr', 'all'],
  BUH: ['finance', 'all'],
  PROC: ['procurement', 'all'],
  WAREHOUSE: ['procurement', 'all'],
  DIRECTOR_GEN: ['management', 'all'],
  DIRECTOR_COMM: ['management', 'all'],
  DIRECTOR_DEV: ['management', 'all'],
  OFFICE_MANAGER: ['management', 'all'],
  ADMIN: ['pm', 'hr', 'finance', 'procurement', 'management', 'all'],
};

function getUserTracks(role) {
  return ROLE_TRACKS[role] || ['all'];
}

async function routes(fastify) {
  const db = fastify.db;
  const auth = { preHandler: [fastify.authenticate] };

  // GET /lessons — list for current user
  fastify.get('/lessons', auth, async (req) => {
    const userId = req.user.id;
    const tracks = getUserTracks(req.user.role);
    const now = new Date();

    const { rows } = await db.query(`
      SELECT l.id, l.month_number, l.track, l.title, l.saga,
             l.cover_icon, l.cover_color, l.estimated_minutes,
             l.is_mandatory, l.release_date, l.published_at, l.tags,
             p.read_completed_at, p.passed, p.score, p.attempts, p.passed_at
      FROM office_academy_lessons l
      LEFT JOIN office_academy_user_progress p ON p.lesson_id = l.id AND p.user_id = $1
      WHERE l.status = 'published'
        AND l.track = ANY($2::text[])
        AND (l.release_date IS NULL OR l.release_date <= $3)
      ORDER BY l.release_date DESC, l.month_number DESC
    `, [userId, tracks, now]);

    // Stats
    const total = rows.length;
    const passed = rows.filter((r) => r.passed).length;
    const mandatory_pending = rows.filter((r) => r.is_mandatory && !r.passed).length;

    return { lessons: rows, total, passed, mandatory_pending };
  });

  // GET /lessons/:id — full lesson with blocks and quiz
  fastify.get('/lessons/:id', auth, async (req, reply) => {
    const userId = req.user.id;
    const lessonId = parseInt(req.params.id, 10);

    const { rows: [lesson] } = await db.query(
      `SELECT l.*, p.read_started_at, p.read_completed_at, p.passed, p.score, p.attempts, p.passed_at
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
    }

    const { rows: questions } = await db.query(
      `SELECT id, sort_order, question_type, question_text, options, correct_explanation, image_url
       FROM office_academy_quiz_questions WHERE lesson_id = $1 ORDER BY sort_order`,
      [lessonId]
    );

    return { lesson, questions };
  });

  // POST /lessons/:id/complete — mark reading done
  fastify.post('/lessons/:id/complete', auth, async (req) => {
    const userId = req.user.id;
    const lessonId = parseInt(req.params.id, 10);
    await db.query(`
      INSERT INTO office_academy_user_progress (user_id, lesson_id, read_started_at, read_completed_at, updated_at)
      VALUES ($1, $2, NOW(), NOW(), NOW())
      ON CONFLICT (user_id, lesson_id) DO UPDATE SET read_completed_at = NOW(), updated_at = NOW()
    `, [userId, lessonId]);
    return { ok: true };
  });

  // POST /lessons/:id/quiz — submit answers, compute score
  fastify.post('/lessons/:id/quiz', auth, async (req, reply) => {
    const userId = req.user.id;
    const lessonId = parseInt(req.params.id, 10);
    const { answers } = req.body || {}; // { [questionId]: selectedOptionIndex }

    if (!answers || typeof answers !== 'object') {
      return reply.code(400).send({ error: 'answers required' });
    }

    const { rows: questions } = await db.query(
      `SELECT id, options FROM office_academy_quiz_questions WHERE lesson_id = $1`,
      [lessonId]
    );
    if (!questions.length) return reply.code(404).send({ error: 'Вопросы не найдены' });

    let correct = 0;
    const feedback = [];
    for (const q of questions) {
      const selected = answers[q.id];
      const opts = Array.isArray(q.options) ? q.options : [];
      const correctIdx = opts.findIndex((o) => o.is_correct);
      const isCorrect = selected !== undefined && parseInt(selected) === correctIdx;
      if (isCorrect) correct++;
      feedback.push({ question_id: q.id, is_correct: isCorrect, correct_index: correctIdx });
    }

    const score = Math.round((correct / questions.length) * 100);
    const passed = score >= 70;

    await db.query(`
      INSERT INTO office_academy_user_progress (user_id, lesson_id, read_started_at, read_completed_at, passed, score, attempts, passed_at, updated_at)
      VALUES ($1, $2, NOW(), NOW(), $3, $4, 1, $5, NOW())
      ON CONFLICT (user_id, lesson_id) DO UPDATE SET
        passed = GREATEST(office_academy_user_progress.passed::int, $3::int)::boolean,
        score = GREATEST(office_academy_user_progress.score, $4),
        attempts = office_academy_user_progress.attempts + 1,
        passed_at = CASE WHEN $3 AND office_academy_user_progress.passed_at IS NULL THEN NOW() ELSE office_academy_user_progress.passed_at END,
        read_completed_at = NOW(), updated_at = NOW()
    `, [userId, lessonId, passed, score, passed ? new Date() : null]);

    return { score, passed, correct, total: questions.length, feedback };
  });

  // GET /leaderboard — top users by passed lessons count + avg score
  fastify.get('/leaderboard', auth, async (req) => {
    const { rows } = await db.query(`
      SELECT u.id, u.name as fio, u.role,
             COUNT(p.id)::int as lessons_passed,
             ROUND(AVG(p.score))::int as avg_score
      FROM office_academy_user_progress p
      JOIN users u ON u.id = p.user_id
      WHERE p.passed = true
      GROUP BY u.id, u.name, u.role
      ORDER BY lessons_passed DESC, avg_score DESC
      LIMIT 20
    `);
    return { leaderboard: rows };
  });

  // GET /articles — short facts/tips (from published lessons' cover + tags)
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

  // ── ADMIN: list drafts ──
  fastify.get('/admin/drafts', auth, async (req, reply) => {
    const adminRoles = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];
    if (!adminRoles.includes(req.user.role)) return reply.code(403).send({ error: 'Нет доступа' });

    const { rows } = await db.query(`
      SELECT l.id, l.month_number, l.track, l.title, l.status, l.is_mandatory,
             l.cover_icon, l.release_date, l.generated_by, l.created_at,
             (SELECT COUNT(*) FROM office_academy_quiz_questions WHERE lesson_id = l.id)::int as questions_count,
             (SELECT COUNT(*) FROM office_academy_user_progress WHERE lesson_id = l.id AND passed = true)::int as passed_count
      FROM office_academy_lessons l
      ORDER BY l.month_number DESC, l.track
    `);
    return { lessons: rows };
  });

  // ── ADMIN: approve/update lesson ──
  fastify.patch('/admin/lessons/:id', auth, async (req, reply) => {
    const adminRoles = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];
    if (!adminRoles.includes(req.user.role)) return reply.code(403).send({ error: 'Нет доступа' });

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
}

module.exports = routes;
