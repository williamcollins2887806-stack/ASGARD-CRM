/**
 * Field Academy API — Чертоги Мимира
 * ════════════════════════════════════════════════════════════════════════════
 * GET  /current-lesson      — Руна текущей недели
 * POST /lessons/:id/read-start   — Начал читать
 * POST /lessons/:id/read-complete — Закончил читать (разблокирует тест)
 * GET  /lessons/:id/quiz    — Вопросы испытания
 * POST /lessons/:id/quiz    — Сдать испытание
 * GET  /lessons             — Летопись (все уроки + прогресс)
 * GET  /daily-fact          — Факт дня
 * POST /daily-fact/:id/view — Отметить просмотр
 * GET  /stats               — Статистика рабочего
 * GET  /shift-allowed       — Можно ли выйти на смену (проверка теста)
 * GET  /updates             — Непросмотренные changelog записи
 * POST /updates/seen        — Отметить версию как просмотренную
 */

'use strict';

const RUNES_FOR_PASS       = 50;   // Руны за прохождение теста
const RUNES_PERFECT        = 100;  // Бонус за 100% результат
const XP_FOR_PASS          = 30;
const XP_PERFECT           = 60;
const RUNES_STREAK_BONUS   = 25;   // Бонус за непрерывный стрик 4+ недель
const MAX_ATTEMPTS         = 2;
const REREAD_COOLDOWN_MINS = 60;   // После 2 провалов — час ожидания + перечитай
const MIN_READ_SECONDS     = 60;   // Минимум 60 сек на чтение

async function routes(fastify) {
  const db = fastify.db;
  const auth = { preHandler: [fastify.fieldAuthenticate] };

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  // Начало и конец текущей недели (Mon–Sun)
  function currentWeekRange() {
    const now = new Date();
    const day = now.getDay() || 7; // 1=Mon, 7=Sun
    const mon = new Date(now);
    mon.setDate(now.getDate() - day + 1);
    mon.setHours(0, 0, 0, 0);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    sun.setHours(23, 59, 59, 999);
    return { mon, sun };
  }

  // Стрик (сколько последовательных недель рабочий сдавал тест)
  async function getStreak(employeeId) {
    const { rows } = await db.query(`
      SELECT al.week_number, awp.passed
      FROM academy_worker_progress awp
      JOIN academy_lessons al ON al.id = awp.lesson_id
      WHERE awp.employee_id = $1 AND awp.passed = true
      ORDER BY al.week_number DESC
    `, [employeeId]);

    if (!rows.length) return 0;
    let streak = 1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i - 1].week_number - rows[i].week_number === 1) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  // Зачислить руны и XP
  async function creditReward(employeeId, runes, xp) {
    if (runes > 0) {
      await db.query(`
        INSERT INTO gamification_wallets (employee_id, currency, balance)
        VALUES ($1,'runes',$2)
        ON CONFLICT (employee_id, currency) DO UPDATE
        SET balance = gamification_wallets.balance + $2
      `, [employeeId, runes]);

      await db.query(`
        INSERT INTO gamification_wallets (employee_id, currency, balance)
        VALUES ($1,'xp',$2)
        ON CONFLICT (employee_id, currency) DO UPDATE
        SET balance = gamification_wallets.balance + $2
      `, [employeeId, xp]);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /current-lesson
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/current-lesson', auth, async (req) => {
    const eid = req.fieldEmployee.id;
    const { sun } = currentWeekRange();

    const monDate = mon.toISOString().split('T')[0];

    // Приоритет: урок текущей недели (release_monday = сегодняшний пн)
    // Запасной: самый свежий урок с release_monday <= сегодня
    const { rows: [lesson] } = await db.query(`
      SELECT al.*,
             awp.read_started_at, awp.read_completed_at, awp.read_time_seconds,
             awp.attempts, awp.score, awp.passed, awp.passed_at,
             awp.blocked_until, awp.runes_earned, awp.xp_earned
      FROM academy_lessons al
      LEFT JOIN academy_worker_progress awp
        ON awp.lesson_id = al.id AND awp.employee_id = $1
      WHERE al.status = 'published'
        AND (al.release_monday IS NULL OR al.release_monday <= $2)
      ORDER BY
        CASE WHEN al.release_monday = $2 THEN 0 ELSE 1 END,
        al.week_number DESC
      LIMIT 1
    `, [eid, monDate]);

    if (!lesson) return { lesson: null };

    const deadline = sun.toISOString();
    const canTakeQuiz = !!lesson.read_completed_at &&
                        (!lesson.blocked_until || new Date(lesson.blocked_until) < new Date());
    const attemptsLeft = MAX_ATTEMPTS - (lesson.attempts || 0);

    return {
      lesson: {
        ...lesson,
        deadline,
        can_take_quiz: canTakeQuiz,
        attempts_left: Math.max(0, attemptsLeft),
        is_blocked: !!(lesson.blocked_until && new Date(lesson.blocked_until) > new Date()),
      }
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /lessons/:id/read-start
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/lessons/:id/read-start', auth, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const lessonId = parseInt(req.params.id);

    const { rows: [lesson] } = await db.query(
      `SELECT id FROM academy_lessons WHERE id = $1 AND status = 'published'`, [lessonId]
    );
    if (!lesson) return reply.code(404).send({ error: 'Руна не найдена' });

    await db.query(`
      INSERT INTO academy_worker_progress (employee_id, lesson_id, read_started_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (employee_id, lesson_id) DO UPDATE
        SET read_started_at = COALESCE(academy_worker_progress.read_started_at, NOW())
    `, [eid, lessonId]);

    return { ok: true };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /lessons/:id/read-complete
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/lessons/:id/read-complete', auth, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const lessonId = parseInt(req.params.id);
    const { time_spent_seconds = 0 } = req.body || {};

    const { rows: [lesson] } = await db.query(
      `SELECT id, estimated_minutes FROM academy_lessons WHERE id = $1 AND status = 'published'`, [lessonId]
    );
    if (!lesson) return reply.code(404).send({ error: 'Руна не найдена' });

    if (time_spent_seconds < MIN_READ_SECONDS) {
      return reply.code(400).send({ error: `Читай внимательно — нужно минимум ${MIN_READ_SECONDS} секунд` });
    }

    await db.query(`
      INSERT INTO academy_worker_progress
        (employee_id, lesson_id, read_started_at, read_completed_at, read_time_seconds)
      VALUES ($1, $2, NOW(), NOW(), $3)
      ON CONFLICT (employee_id, lesson_id) DO UPDATE
        SET read_completed_at = COALESCE(academy_worker_progress.read_completed_at, NOW()),
            read_time_seconds = GREATEST(COALESCE(academy_worker_progress.read_time_seconds, 0), $3),
            attempts = CASE
              WHEN academy_worker_progress.read_completed_at IS NULL
               AND academy_worker_progress.blocked_until IS NOT NULL
               AND academy_worker_progress.blocked_until < NOW()
              THEN 0
              ELSE academy_worker_progress.attempts
            END,
            blocked_until = CASE
              WHEN academy_worker_progress.read_completed_at IS NULL
               AND academy_worker_progress.blocked_until IS NOT NULL
               AND academy_worker_progress.blocked_until < NOW()
              THEN NULL
              ELSE academy_worker_progress.blocked_until
            END
    `, [eid, lessonId, time_spent_seconds]);

    return { ok: true, can_take_quiz: true };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /lessons/:id/quiz
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/lessons/:id/quiz', auth, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const lessonId = parseInt(req.params.id);

    // Проверить что урок прочитан
    const { rows: [progress] } = await db.query(`
      SELECT read_completed_at, attempts, blocked_until, passed
      FROM academy_worker_progress
      WHERE employee_id = $1 AND lesson_id = $2
    `, [eid, lessonId]);

    if (!progress?.read_completed_at) {
      return reply.code(403).send({ error: 'Сначала прочитай Руну' });
    }
    if (progress.passed) {
      return reply.code(400).send({ error: 'Испытание уже пройдено' });
    }
    if (progress.blocked_until && new Date(progress.blocked_until) > new Date()) {
      return reply.code(403).send({
        error: 'Перечитай Руну и возвращайся',
        blocked_until: progress.blocked_until
      });
    }
    if (progress.attempts >= MAX_ATTEMPTS) {
      return reply.code(403).send({ error: 'Попытки исчерпаны. Перечитай Руну' });
    }

    const { rows: questions } = await db.query(`
      SELECT id, sort_order, question_type, question_text, options, image_url
      FROM academy_quiz_questions
      WHERE lesson_id = $1
      ORDER BY sort_order ASC
    `, [lessonId]);

    // Убираем is_correct из вариантов (клиент не должен знать ответ)
    const sanitized = questions.map(q => ({
      ...q,
      options: (q.options || []).map(o => ({ text: o.text, id: o.id }))
    }));

    return {
      questions: sanitized,
      attempt_number: (progress.attempts || 0) + 1,
      max_attempts: MAX_ATTEMPTS,
      time_limit_minutes: 20
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /lessons/:id/quiz  — сдать испытание
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/lessons/:id/quiz', auth, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const lessonId = parseInt(req.params.id);
    const { answers = [] } = req.body || {}; // [{question_id, selected_option_id}]

    // Проверить доступность
    const { rows: [progress] } = await db.query(`
      SELECT read_completed_at, attempts, blocked_until, passed
      FROM academy_worker_progress
      WHERE employee_id = $1 AND lesson_id = $2
    `, [eid, lessonId]);

    if (!progress?.read_completed_at) {
      return reply.code(403).send({ error: 'Сначала прочитай Руну' });
    }
    if (progress.passed) {
      return reply.code(400).send({ error: 'Испытание уже пройдено' });
    }
    if (progress.blocked_until && new Date(progress.blocked_until) > new Date()) {
      return reply.code(403).send({ error: 'Ещё рано. Перечитай Руну', blocked_until: progress.blocked_until });
    }
    if ((progress.attempts || 0) >= MAX_ATTEMPTS) {
      return reply.code(403).send({ error: 'Попытки исчерпаны' });
    }

    // Загрузить вопросы с правильными ответами
    const { rows: questions } = await db.query(`
      SELECT id, options, correct_explanation
      FROM academy_quiz_questions WHERE lesson_id = $1
    `, [lessonId]);

    // Проверить ответы
    let correct = 0;
    const resultAnswers = answers.map(ans => {
      const q = questions.find(q => q.id === ans.question_id);
      if (!q) return { question_id: ans.question_id, is_correct: false };
      const correctOpt = (q.options || []).find(o => o.is_correct);
      const isCorrect = correctOpt && correctOpt.id === ans.selected_option_id;
      if (isCorrect) correct++;
      return {
        question_id: ans.question_id,
        selected_option_id: ans.selected_option_id,
        correct_option_id: correctOpt?.id,
        is_correct: isCorrect,
        explanation: q.correct_explanation
      };
    });

    const total = questions.length;
    const score = total > 0 ? Math.round((correct / total) * 100) : 0;
    const passed = score >= 80;
    const attemptNum = (progress.attempts || 0) + 1;

    // Записать попытку
    await db.query(`
      INSERT INTO academy_quiz_attempts
        (employee_id, lesson_id, attempt_number, answers, score, passed, finished_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
    `, [eid, lessonId, attemptNum, JSON.stringify(resultAnswers), score, passed]);

    let blockedUntil = null;
    let runesEarned = 0;
    let xpEarned = 0;
    let streakBonus = false;

    if (passed) {
      const streak = await getStreak(eid);
      const isStreak = streak >= 3;

      runesEarned = score === 100 ? RUNES_PERFECT : RUNES_FOR_PASS;
      xpEarned    = score === 100 ? XP_PERFECT    : XP_FOR_PASS;
      if (isStreak) {
        runesEarned += RUNES_STREAK_BONUS;
        streakBonus = true;
      }

      await creditReward(eid, runesEarned, xpEarned);

      await db.query(`
        UPDATE academy_worker_progress SET
          attempts    = $3,
          score       = $4,
          passed      = true,
          passed_at   = NOW(),
          last_attempt_at = NOW(),
          runes_earned = $5,
          xp_earned    = $6
        WHERE employee_id = $1 AND lesson_id = $2
      `, [eid, lessonId, attemptNum, score, runesEarned, xpEarned]);

    } else {
      // Провалил
      if (attemptNum >= MAX_ATTEMPTS) {
        // Заблокировать на REREAD_COOLDOWN_MINS
        const until = new Date(Date.now() + REREAD_COOLDOWN_MINS * 60 * 1000);
        blockedUntil = until.toISOString();

        await db.query(`
          UPDATE academy_worker_progress SET
            attempts = $3, score = GREATEST(COALESCE(score,0),$4),
            last_attempt_at = NOW(), blocked_until = $5,
            read_completed_at = NULL
          WHERE employee_id = $1 AND lesson_id = $2
        `, [eid, lessonId, attemptNum, score, blockedUntil]);
      } else {
        await db.query(`
          UPDATE academy_worker_progress SET
            attempts = $3, score = GREATEST(COALESCE(score,0),$4),
            last_attempt_at = NOW()
          WHERE employee_id = $1 AND lesson_id = $2
        `, [eid, lessonId, attemptNum, score]);
      }
    }

    return {
      passed,
      score,
      correct,
      total,
      attempt_number: attemptNum,
      attempts_left: passed ? 0 : Math.max(0, MAX_ATTEMPTS - attemptNum),
      blocked_until: blockedUntil,
      answers: resultAnswers,
      reward: passed ? { runes: runesEarned, xp: xpEarned, streak_bonus: streakBonus } : null
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /lessons  — Летопись (все уроки + прогресс)
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/lessons', auth, async (req) => {
    const eid = req.fieldEmployee.id;

    const { rows } = await db.query(`
      SELECT al.id, al.week_number, al.saga, al.title, al.cover_icon, al.cover_color,
             al.estimated_minutes, al.tags, al.published_at, al.blocks,
             awp.read_completed_at, awp.passed, awp.score, awp.attempts,
             awp.runes_earned, awp.passed_at
      FROM academy_lessons al
      LEFT JOIN academy_worker_progress awp
        ON awp.lesson_id = al.id AND awp.employee_id = $1
      WHERE al.status = 'published'
      ORDER BY al.week_number DESC
    `, [eid]);

    return { lessons: rows };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /daily-fact
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/daily-fact', auth, async (req) => {
    const eid = req.fieldEmployee.id;
    const today = new Date().toISOString().split('T')[0];

    const { rows: [fact] } = await db.query(`
      SELECT adf.*,
             EXISTS(
               SELECT 1 FROM academy_fact_views afv
               WHERE afv.fact_id = adf.id AND afv.employee_id = $1
             ) AS viewed
      FROM academy_daily_facts adf
      WHERE adf.fact_date = $2 AND adf.status = 'published'
    `, [eid, today]);

    return { fact: fact || null };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /daily-fact/:id/view
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/daily-fact/:id/view', auth, async (req) => {
    const eid = req.fieldEmployee.id;
    const factId = parseInt(req.params.id);

    await db.query(`
      INSERT INTO academy_fact_views (employee_id, fact_id)
      VALUES ($1, $2) ON CONFLICT DO NOTHING
    `, [eid, factId]);

    return { ok: true };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /stats
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/stats', auth, async (req) => {
    const eid = req.fieldEmployee.id;

    const { rows: [stats] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE awp.passed)                          AS lessons_passed,
        COUNT(*) FILTER (WHERE al.status = 'published')             AS lessons_total,
        COALESCE(SUM(awp.runes_earned),0)                           AS runes_total,
        COALESCE(SUM(awp.xp_earned),0)                             AS xp_total,
        COALESCE(AVG(awp.score) FILTER (WHERE awp.score IS NOT NULL),0) AS avg_score
      FROM academy_lessons al
      LEFT JOIN academy_worker_progress awp ON awp.lesson_id = al.id AND awp.employee_id = $1
      WHERE al.status = 'published'
    `, [eid]);

    const streak = await getStreak(eid);

    // Ранг по количеству пройденных уроков
    const passed = parseInt(stats.lessons_passed || 0);
    let rank, rankIcon;
    if (passed >= 25)     { rank = 'Ярл';         rankIcon = '👑'; }
    else if (passed >= 13) { rank = 'Хирдман';     rankIcon = '⚔️'; }
    else if (passed >= 5)  { rank = 'Дружинник';   rankIcon = '🛡️'; }
    else                   { rank = 'Новобранец';  rankIcon = '🪖'; }

    return {
      lessons_passed: passed,
      lessons_total: parseInt(stats.lessons_total || 0),
      runes_total: parseInt(stats.runes_total || 0),
      xp_total: parseInt(stats.xp_total || 0),
      avg_score: Math.round(parseFloat(stats.avg_score || 0)),
      streak,
      rank,
      rank_icon: rankIcon
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /shift-allowed  — проверка для чекина
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/shift-allowed', auth, async (req) => {
    const eid = req.fieldEmployee.id;

    const now = new Date();
    const dayOfWeek = now.getDay() || 7; // 1=Mon...7=Sun
    const mon = new Date(now);
    mon.setDate(now.getDate() - (dayOfWeek - 1));
    mon.setHours(0, 0, 0, 0);

    // Урок чья release_monday была НА ПРОШЛОЙ неделе (уже обязателен, дедлайн прошёл)
    // Рабочий не может "забежать вперёд" — каждая неделя независима
    const prevMon = new Date(mon);
    prevMon.setDate(mon.getDate() - 7);
    const prevMonDate = prevMon.toISOString().split('T')[0];
    const monDate = mon.toISOString().split('T')[0];

    const { rows: [lesson] } = await db.query(`
      SELECT al.id, al.title, awp.passed
      FROM academy_lessons al
      LEFT JOIN academy_worker_progress awp
        ON awp.lesson_id = al.id AND awp.employee_id = $1
      WHERE al.status = 'published'
        AND al.release_monday >= $2
        AND al.release_monday < $3
      ORDER BY al.week_number DESC
      LIMIT 1
    `, [eid, prevMonDate, monDate]);

    if (!lesson) return { allowed: true, reason: null };

    if (!lesson.passed) {
      return {
        allowed: false,
        reason: `Пройди Испытание «${lesson.title}» чтобы выйти на смену`,
        lesson_id: lesson.id,
        lesson_title: lesson.title
      };
    }

    return { allowed: true, reason: null };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /updates — непросмотренные changelog записи
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/updates', auth, async (req) => {
    const eid = req.fieldEmployee.id;

    const { rows: [seen] } = await db.query(`
      SELECT last_seen_version FROM app_update_seen
      WHERE user_id = $1 AND user_type = 'field'
    `, [eid]);

    const lastSeen = seen?.last_seen_version || '0.0.0';

    const { rows: updates } = await db.query(`
      SELECT id, version, title, changes, published_at
      FROM app_updates
      WHERE target IN ('field','all','both')
        AND version > $1
      ORDER BY published_at ASC
    `, [lastSeen]);

    return { updates, has_updates: updates.length > 0 };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /updates/seen
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/updates/seen', auth, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const { version } = req.body || {};
    if (!version) return reply.code(400).send({ error: 'Укажи version' });

    await db.query(`
      INSERT INTO app_update_seen (user_id, user_type, last_seen_version, seen_at)
      VALUES ($1, 'field', $2, NOW())
      ON CONFLICT (user_id, user_type) DO UPDATE
        SET last_seen_version = $2, seen_at = NOW()
    `, [eid, version]);

    return { ok: true };
  });
}

module.exports = routes;
