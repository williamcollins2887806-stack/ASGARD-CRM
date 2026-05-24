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
const MIN_READ_SECONDS     = 60;   // Минимум 60 сек на чтение
const NEW_HIRE_GRACE_DAYS  = 7;    // Новичкам не блокируем смены первые 7 дней
const RP_ALERT_THRESHOLD   = 5;    // Уведомить РП после 5 провалов подряд на одной руне

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
  // Возвращает:
  //   lesson           — приоритетный урок (что читать ПРЯМО СЕЙЧАС):
  //                      1) первый несданный обязательный из прошлых недель
  //                      2) если нет — урок текущей недели
  //   pending_mandatory — все несданные обязательные с прошедшим release_monday
  //   current_week     — урок текущей недели (если есть и не входит в pending)
  //   optional         — необязательные доступные руны
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/current-lesson', auth, async (req) => {
    const eid = req.fieldEmployee.id;
    const { mon, sun } = currentWeekRange();
    const monDate = mon.toISOString().split('T')[0];
    const deadline = sun.toISOString();

    // Все опубликованные доступные уроки + прогресс
    const { rows: allRows } = await db.query(`
      SELECT al.*,
             awp.read_started_at, awp.read_completed_at, awp.read_time_seconds,
             awp.attempts, awp.score, awp.passed, awp.passed_at,
             awp.runes_earned, awp.xp_earned
      FROM academy_lessons al
      LEFT JOIN academy_worker_progress awp
        ON awp.lesson_id = al.id AND awp.employee_id = $1
      WHERE al.status = 'published'
        AND (al.release_monday IS NULL OR al.release_monday <= $2)
      ORDER BY al.week_number ASC
    `, [eid, monDate]);

    function decorate(l) {
      const attemptsLeft = MAX_ATTEMPTS - (l.attempts || 0);
      const needReread = !l.passed && (l.attempts || 0) >= MAX_ATTEMPTS;
      const canTakeQuiz = !!l.read_completed_at && !l.passed && !needReread;
      return {
        ...l,
        deadline,
        can_take_quiz: canTakeQuiz,
        attempts_left: Math.max(0, attemptsLeft),
        need_reread: needReread,
        is_blocked: needReread, // legacy alias для совместимости
      };
    }

    // pending_mandatory: обязательные из прошлых недель (release_monday < this Monday), не сданные
    const pendingMandatory = allRows
      .filter(l => l.is_mandatory && l.release_monday && l.release_monday < monDate && !l.passed)
      .map(decorate);

    // current_week: урок этой недели (release_monday == this Monday)
    const currentWeek = allRows.find(l => l.release_monday === monDate);
    const currentWeekDecorated = currentWeek ? decorate(currentWeek) : null;

    // optional: необязательные, доступные, не входят в текущую (для отображения «Для опытных»)
    const optional = allRows
      .filter(l => !l.is_mandatory && (!currentWeek || l.id !== currentWeek.id))
      .map(decorate);

    // Приоритетный урок (что показать на главной как «читай прямо сейчас»):
    // 1. Первый pending_mandatory (по возрастанию week_number)
    // 2. Иначе current_week
    // 3. Иначе самый свежий вообще
    let primary = pendingMandatory[0]
      || currentWeekDecorated
      || (allRows.length ? decorate(allRows[allRows.length - 1]) : null);

    return {
      lesson: primary,          // совместимость со старым клиентом
      primary,                  // явное имя
      pending_mandatory: pendingMandatory,
      current_week: currentWeekDecorated,
      optional,
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

    // ВАЖНО: если рабочий провалил все попытки и read_completed_at был сброшен —
    // повторная перечитка БЕЗУСЛОВНО обнуляет attempts и снимает блокировку.
    // Логика: «прочитал внимательно (мин. 60 сек) → получи 2 новые попытки».
    await db.query(`
      INSERT INTO academy_worker_progress
        (employee_id, lesson_id, read_started_at, read_completed_at, read_time_seconds)
      VALUES ($1, $2, NOW(), NOW(), $3)
      ON CONFLICT (employee_id, lesson_id) DO UPDATE
        SET read_completed_at = NOW(),
            read_time_seconds = GREATEST(COALESCE(academy_worker_progress.read_time_seconds, 0), $3),
            -- Если урок ещё не сдан и был сброс прогресса (read_completed_at = NULL),
            -- значит это «перечитка после провала» → даём ещё 2 попытки.
            attempts = CASE
              WHEN academy_worker_progress.passed = false
               AND academy_worker_progress.read_completed_at IS NULL
              THEN 0
              ELSE academy_worker_progress.attempts
            END,
            blocked_until = CASE
              WHEN academy_worker_progress.passed = false
               AND academy_worker_progress.read_completed_at IS NULL
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
    // Попытки исчерпаны → нужно перечитать руну, после read-complete
    // attempts будет обнулён и квиз снова откроется. Никаких таймеров.
    if (progress.attempts >= MAX_ATTEMPTS) {
      return reply.code(403).send({
        error: 'Попытки исчерпаны. Перечитай Руну — получишь 2 новые попытки',
        code: 'NEED_REREAD'
      });
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
    if ((progress.attempts || 0) >= MAX_ATTEMPTS) {
      return reply.code(403).send({
        error: 'Попытки исчерпаны. Перечитай Руну',
        code: 'NEED_REREAD'
      });
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
        // Сбрасываем read_completed_at → рабочий должен перечитать руну.
        // После повторного read-complete (минимум 60 сек) attempts обнулится,
        // и он получит ещё 2 попытки. Никаких таймеров — это были user-hostile часы.
        await db.query(`
          UPDATE academy_worker_progress SET
            attempts = $3, score = GREATEST(COALESCE(score,0),$4),
            last_attempt_at = NOW(),
            blocked_until = NULL,
            read_completed_at = NULL
          WHERE employee_id = $1 AND lesson_id = $2
        `, [eid, lessonId, attemptNum, score]);
      } else {
        await db.query(`
          UPDATE academy_worker_progress SET
            attempts = $3, score = GREATEST(COALESCE(score,0),$4),
            last_attempt_at = NOW()
          WHERE employee_id = $1 AND lesson_id = $2
        `, [eid, lessonId, attemptNum, score]);
      }

      // Проверка «5 провалов подряд на одной руне» → уведомить РП
      try {
        const { rows: [{ fails_count }] } = await db.query(`
          SELECT COUNT(*)::int AS fails_count
          FROM academy_quiz_attempts
          WHERE employee_id = $1 AND lesson_id = $2 AND passed = false
        `, [eid, lessonId]);

        if (fails_count >= RP_ALERT_THRESHOLD) {
          // Проверяем, не отправляли ли уже уведомление по этой паре
          const { rows: [alreadyNotified] } = await db.query(`
            SELECT 1 FROM notifications
            WHERE type = 'academy_struggle'
              AND link = $1
              AND created_at > NOW() - INTERVAL '7 days'
            LIMIT 1
          `, [`/field/employee/${eid}/academy`]);

          if (!alreadyNotified) {
            // Находим РП рабочего: ищем активное назначение → work.pm_id → users.id
            const { rows: pms } = await db.query(`
              SELECT DISTINCT u.id AS pm_user_id, e.fio AS worker_fio, al.title AS lesson_title
              FROM employee_assignments ea
              JOIN works w ON w.id = ea.work_id
              JOIN users u ON u.id = w.pm_id AND u.is_active = true
              CROSS JOIN employees e
              CROSS JOIN academy_lessons al
              WHERE ea.employee_id = $1 AND ea.is_active = true
                AND e.id = $1 AND al.id = $2
            `, [eid, lessonId]);

            if (pms.length > 0) {
              const { createNotification } = require('../services/notify');
              for (const row of pms) {
                await createNotification(db, {
                  user_id: row.pm_user_id,
                  title: 'Рабочий застрял в Чертогах Мимира',
                  message: `${row.worker_fio} провалил Испытание «${row.lesson_title}» ${fails_count} раз подряд. Помоги ему разобраться.`,
                  type: 'academy_struggle',
                  link: `/field/employee/${eid}/academy`
                });
              }
              fastify.log.info(`[academy] Sent struggle alert to ${pms.length} PMs for emp=${eid} lesson=${lessonId} fails=${fails_count}`);
            }
          }
        }
      } catch (notifyErr) {
        fastify.log.warn('[academy] PM notification failed (non-fatal):', notifyErr.message);
      }
    }

    return {
      passed,
      score,
      correct,
      total,
      attempt_number: attemptNum,
      attempts_left: passed ? 0 : Math.max(0, MAX_ATTEMPTS - attemptNum),
      // need_reread = провалил последнюю попытку, нужно перечитать
      need_reread: !passed && attemptNum >= MAX_ATTEMPTS,
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
             al.is_mandatory, al.release_monday,
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

    // Grace для новичков: первые 7 дней с момента создания записи не блокируем
    const { rows: [emp] } = await db.query(
      `SELECT created_at FROM employees WHERE id = $1`, [eid]
    );
    const hireAgeDays = emp?.created_at
      ? (Date.now() - new Date(emp.created_at).getTime()) / 86400000
      : 999;
    if (hireAgeDays < NEW_HIRE_GRACE_DAYS) {
      return { allowed: true, reason: null, grace_new_hire: true };
    }

    const now = new Date();
    const dayOfWeek = now.getDay() || 7; // 1=Mon...7=Sun
    const mon = new Date(now);
    mon.setDate(now.getDate() - (dayOfWeek - 1));
    mon.setHours(0, 0, 0, 0);
    const monDate = mon.toISOString().split('T')[0];

    // Самый свежий ОБЯЗАТЕЛЬНЫЙ урок, чья release_monday уже прошла (< текущего пн)
    // и который ещё не сдан — блокирует смену.
    const { rows: [lesson] } = await db.query(`
      SELECT al.id, al.title, awp.passed
      FROM academy_lessons al
      LEFT JOIN academy_worker_progress awp
        ON awp.lesson_id = al.id AND awp.employee_id = $1
      WHERE al.status = 'published'
        AND al.is_mandatory = true
        AND al.release_monday IS NOT NULL
        AND al.release_monday < $2
      ORDER BY al.week_number DESC
      LIMIT 1
    `, [eid, monDate]);

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
