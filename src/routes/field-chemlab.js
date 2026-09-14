/**
 * Field ChemLab Game API — Химцех
 */
const {
  generateLevel,
  recoverLevel,
  hintNextMove,
  validateSubmission,
  computeRewards,
  publicReagents,
  buildPassport,
} = require('../services/chemLabEngine');

const MSK = 'Europe/Moscow';
const DAILY_XP_CAP = 200;
const DAILY_RUNE_CAP = 30;

async function mskDate(dbOrClient) {
  const { rows: [r] } = await dbOrClient.query(
    `SELECT (NOW() AT TIME ZONE $1)::date AS d`, [MSK]
  );
  return r.d;
}

function parseJson(raw, fallback) {
  if (raw == null) return fallback;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }
  return fallback;
}

async function creditChem(client, employeeId, currency, amount, operation = 'chemlab_win') {
  if (amount <= 0) return;
  await client.query(
    `INSERT INTO gamification_wallets (employee_id, currency, balance)
     VALUES ($1, $2, $3)
     ON CONFLICT (employee_id, currency) DO UPDATE
       SET balance = gamification_wallets.balance + $3, updated_at = NOW()`,
    [employeeId, currency, amount]
  );
  const { rows: [w] } = await client.query(
    'SELECT balance FROM gamification_wallets WHERE employee_id = $1 AND currency = $2',
    [employeeId, currency]
  );
  await client.query(
    `INSERT INTO gamification_currency_ledger
       (employee_id, currency, amount, balance_after, operation, reference_id, reference_type)
     VALUES ($1, $2, $3, $4, $5, NULL, 'chemlab')`,
    [employeeId, currency, amount, w.balance, operation]
  );
}

async function ensureStats(db, eid) {
  await db.query(
    `INSERT INTO gamification_chemlab_stats (employee_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [eid]
  );
}

function computeMilestones(dailyRow, newLevelsCount, streak, isNewLevel) {
  let bonusXp = 0;
  let bonusRunes = 0;
  const milestones = [];
  const claim5 = newLevelsCount >= 5 && !dailyRow.bonus_5_claimed;
  const claim10 = newLevelsCount >= 10 && !dailyRow.bonus_10_claimed;

  if (claim5) {
    bonusXp += 15;
    bonusRunes += 5;
    milestones.push({ key: 'daily_5', label: '5 нарядов за день', xp: 15, runes: 5 });
  }
  if (claim10) {
    bonusXp += 25;
    bonusRunes += 10;
    milestones.push({ key: 'daily_10', label: '10 нарядов за день', xp: 25, runes: 10 });
  }
  if (isNewLevel && streak > 0 && streak % 5 === 0) {
    bonusXp += 10;
    bonusRunes += 5;
    milestones.push({ key: `streak_${streak}`, label: `Серия ${streak} нарядов`, xp: 10, runes: 5 });
  }
  return { bonusXp, bonusRunes, milestones, claim5, claim10 };
}

async function routes(fastify) {
  const db = fastify.db;

  fastify.get('/reagents', { preHandler: [fastify.fieldAuthenticate] }, async () => ({
    reagents: publicReagents(),
  }));

  fastify.get('/stats', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const eid = req.fieldEmployee.id;
    await ensureStats(db, eid);
    const dayDate = await mskDate(db);

    const { rows: [stats] } = await db.query(
      'SELECT * FROM gamification_chemlab_stats WHERE employee_id = $1', [eid]
    );
    const { rows: [daily] } = await db.query(
      `SELECT xp_earned, runes_earned, levels_cleared, bonus_5_claimed, bonus_10_claimed
       FROM gamification_chemlab_daily WHERE employee_id = $1 AND day_date = $2`,
      [eid, dayDate]
    );

    const { rows: weeklyTop } = await db.query(
      `SELECT e.id, e.fio, s.max_level, s.weekly_stars, s.current_streak, s.best_streak
       FROM gamification_chemlab_stats s
       JOIN employees e ON e.id = s.employee_id
       WHERE s.max_level > 0
       ORDER BY s.weekly_stars DESC, s.max_level DESC, s.total_stars DESC
       LIMIT 10`
    );

    const { rows: [myRank] } = await db.query(
      `SELECT rn FROM (
         SELECT employee_id, ROW_NUMBER() OVER (ORDER BY weekly_stars DESC, max_level DESC, total_stars DESC) AS rn
         FROM gamification_chemlab_stats WHERE max_level > 0
       ) x WHERE employee_id = $1`,
      [eid]
    );

    const d = daily || {
      xp_earned: 0, runes_earned: 0, levels_cleared: 0,
      bonus_5_claimed: false, bonus_10_claimed: false,
    };
    return {
      max_level: stats?.max_level || 0,
      next_level: Math.max(1, (stats?.max_level || 0) + 1),
      current_streak: stats?.current_streak || 0,
      best_streak: stats?.best_streak || 0,
      total_stars: stats?.total_stars || 0,
      weekly_stars: stats?.weekly_stars || 0,
      total_levels: stats?.total_levels || 0,
      daily: {
        xp_earned: d.xp_earned,
        runes_earned: d.runes_earned,
        levels_cleared: d.levels_cleared,
        xp_remaining: Math.max(0, DAILY_XP_CAP - d.xp_earned),
        runes_remaining: Math.max(0, DAILY_RUNE_CAP - d.runes_earned),
        bonus_5_claimed: !!d.bonus_5_claimed,
        bonus_10_claimed: !!d.bonus_10_claimed,
        next_bonus_at: d.levels_cleared < 5 ? 5 : d.levels_cleared < 10 ? 10 : null,
      },
      weekly_top: weeklyTop.map((r, i) => ({
        rank: i + 1,
        employee_id: r.id,
        fio: r.fio,
        max_level: r.max_level,
        weekly_stars: r.weekly_stars,
        streak: r.current_streak,
        best_streak: r.best_streak,
      })),
      my_weekly_rank: myRank?.rn || null,
    };
  });

  fastify.get('/leaderboard', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const eid = req.fieldEmployee.id;
    const { rows } = await db.query(
      `SELECT e.id AS employee_id, e.fio, s.max_level, s.weekly_stars, s.current_streak,
              s.best_streak, s.total_stars, s.total_levels
       FROM gamification_chemlab_stats s
       JOIN employees e ON e.id = s.employee_id
       WHERE s.max_level > 0
       ORDER BY s.weekly_stars DESC, s.max_level DESC, s.total_stars DESC
       LIMIT 50`
    );
    const { rows: [myRank] } = await db.query(
      `SELECT rn FROM (
         SELECT employee_id, ROW_NUMBER() OVER (ORDER BY weekly_stars DESC, max_level DESC, total_stars DESC) AS rn
         FROM gamification_chemlab_stats WHERE max_level > 0
       ) x WHERE employee_id = $1`,
      [eid]
    );
    return {
      leaderboard: rows.map((r, i) => ({ ...r, rank: i + 1 })),
      my_rank: myRank?.rn || null,
      total: rows.length,
    };
  });

  fastify.post('/start', {
    preHandler: [fastify.fieldAuthenticate],
    schema: { body: { type: 'object', properties: { level: { type: 'integer', minimum: 1 } } } },
  }, async (req) => {
    const eid = req.fieldEmployee.id;
    await ensureStats(db, eid);

    const { rows: [stats] } = await db.query(
      'SELECT max_level FROM gamification_chemlab_stats WHERE employee_id = $1', [eid]
    );
    const maxLevel = stats?.max_level || 0;
    let levelNum = req.body?.level || maxLevel + 1;
    if (levelNum > maxLevel + 1) levelNum = maxLevel + 1;
    if (levelNum < 1) levelNum = 1;

    const level = generateLevel(levelNum, eid);

    const { rows: [session] } = await db.query(
      `INSERT INTO gamification_chemlab_sessions
         (employee_id, level_num, initial_cans, goal, move_limit, min_moves)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, level_num, move_limit, min_moves, expires_at`,
      [
        eid,
        levelNum,
        JSON.stringify(level.cans),
        JSON.stringify(level.goal),
        level.moveLimit,
        level.minMoves || 0,
      ]
    );

    return {
      session_id: session.id,
      level: levelNum,
      cans: level.cans,
      goal: level.goal,
      brief: level.brief,
      teach: level.teach,
      world: level.world,
      chapter: level.chapter,
      move_limit: level.moveLimit,
      min_moves: level.minMoves,
      stars: level.stars,
      capacity: level.capacity,
      reagents: publicReagents(),
      expires_at: session.expires_at,
    };
  });

  fastify.post('/complete', {
    preHandler: [fastify.fieldAuthenticate],
    schema: {
      body: {
        type: 'object',
        required: ['session_id', 'cans', 'moves_used'],
        properties: {
          session_id: { type: 'string', format: 'uuid' },
          cans: { type: 'array' },
          moves_used: { type: 'integer', minimum: 0 },
          fail_count: { type: 'integer', minimum: 0 },
          used_hint: { type: 'boolean' },
          time_ms: { type: 'integer', minimum: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const { session_id, cans, moves_used, fail_count = 0, used_hint = false } = req.body;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [session] } = await client.query(
        `SELECT * FROM gamification_chemlab_sessions
         WHERE id = $1 AND employee_id = $2 FOR UPDATE`,
        [session_id, eid]
      );
      if (!session) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Сессия не найдена' });
      }
      if (session.completed_at) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Наряд уже засчитан' });
      }
      if (new Date(session.expires_at) < new Date()) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Сессия истекла — начни наряд заново' });
      }

      const initial = parseJson(session.initial_cans, null);
      const goal = parseJson(session.goal, { type: 'sort' });
      if (!initial?.length) {
        await client.query('ROLLBACK');
        return reply.code(500).send({ error: 'Повреждённые данные уровня' });
      }

      const result = validateSubmission(
        initial, cans, goal, session.move_limit, moves_used, fail_count, session.min_moves
      );
      if (!result.ok) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: result.error });
      }

      let stars = result.stars;
      if (used_hint && stars > 1) stars -= 1;

      const dayDate = await mskDate(client);

      await client.query(
        `INSERT INTO gamification_chemlab_daily (employee_id, day_date)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [eid, dayDate]
      );
      let { rows: [dailyRow] } = await client.query(
        `SELECT xp_earned, runes_earned, levels_cleared, bonus_5_claimed, bonus_10_claimed
         FROM gamification_chemlab_daily
         WHERE employee_id = $1 AND day_date = $2 FOR UPDATE`,
        [eid, dayDate]
      );
      if (!dailyRow) {
        dailyRow = {
          xp_earned: 0, runes_earned: 0, levels_cleared: 0,
          bonus_5_claimed: false, bonus_10_claimed: false,
        };
      }

      const rewards = computeRewards(
        session.level_num, stars, dailyRow.levels_cleared,
        dailyRow.xp_earned, dailyRow.runes_earned
      );

      await client.query(
        `UPDATE gamification_chemlab_sessions SET completed_at = NOW() WHERE id = $1`,
        [session_id]
      );

      await client.query(
        `INSERT INTO gamification_chemlab_stats (employee_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [eid]
      );
      const { rows: [prev] } = await client.query(
        'SELECT * FROM gamification_chemlab_stats WHERE employee_id = $1 FOR UPDATE',
        [eid]
      );

      const prevMax = prev.max_level || 0;
      const isNewLevel = session.level_num === prevMax + 1;
      const newMax = isNewLevel ? session.level_num : prevMax;
      const streak = isNewLevel ? (prev.current_streak || 0) + 1 : (prev.current_streak || 0);

      const { rows: [weekRow] } = await client.query(
        `SELECT (date_trunc('week', NOW() AT TIME ZONE $1)::date) AS monday`, [MSK]
      );
      const mondayStr = weekRow.monday;
      const resetWeekly = !prev.week_start || String(prev.week_start) !== String(mondayStr);
      const weeklyStars = (resetWeekly ? 0 : (prev.weekly_stars || 0)) + stars;

      const newLevelsCount = dailyRow.levels_cleared + 1;
      const ms = computeMilestones(dailyRow, newLevelsCount, streak, isNewLevel);

      let totalXp = rewards.xp + ms.bonusXp;
      let totalRunes = rewards.runes + ms.bonusRunes;
      totalXp = Math.min(totalXp, Math.max(0, DAILY_XP_CAP - dailyRow.xp_earned));
      totalRunes = Math.min(totalRunes, Math.max(0, DAILY_RUNE_CAP - dailyRow.runes_earned));

      await client.query(
        `UPDATE gamification_chemlab_stats SET
           max_level = $2,
           current_streak = $3,
           best_streak = GREATEST(best_streak, $3),
           total_stars = total_stars + $4,
           weekly_stars = $5,
           week_start = $6::date,
           total_levels = total_levels + 1,
           updated_at = NOW()
         WHERE employee_id = $1`,
        [eid, newMax, streak, stars, weeklyStars, mondayStr]
      );

      await client.query(
        `UPDATE gamification_chemlab_daily SET
           xp_earned = xp_earned + $3,
           runes_earned = runes_earned + $4,
           levels_cleared = levels_cleared + 1,
           bonus_5_claimed = bonus_5_claimed OR $5,
           bonus_10_claimed = bonus_10_claimed OR $6
         WHERE employee_id = $1 AND day_date = $2`,
        [eid, dayDate, totalXp, totalRunes, ms.claim5, ms.claim10]
      );

      await client.query(
        `INSERT INTO gamification_wallets (employee_id, currency, balance)
         VALUES ($1,'silver',0),($1,'runes',0),($1,'xp',0)
         ON CONFLICT (employee_id, currency) DO NOTHING`,
        [eid]
      );

      const baseXp = Math.min(rewards.xp, totalXp);
      const baseRunes = Math.min(rewards.runes, totalRunes);
      const bonusXpActual = totalXp - baseXp;
      const bonusRunesActual = totalRunes - baseRunes;

      if (baseXp > 0) await creditChem(client, eid, 'xp', baseXp, 'chemlab_win');
      if (baseRunes > 0) await creditChem(client, eid, 'runes', baseRunes, 'chemlab_win');
      if (bonusXpActual > 0) await creditChem(client, eid, 'xp', bonusXpActual, 'chemlab_bonus');
      if (bonusRunesActual > 0) await creditChem(client, eid, 'runes', bonusRunesActual, 'chemlab_bonus');

      await client.query('COMMIT');

      try {
        const { updateQuestProgress } = require('../services/questProgress');
        updateQuestProgress(db, eid, 'chemlab_level').catch(() => {});
        if (stars >= 3) updateQuestProgress(db, eid, 'chemlab_perfect').catch(() => {});
        if (isNewLevel && streak >= 5 && streak % 5 === 0) {
          updateQuestProgress(db, eid, 'chemlab_streak').catch(() => {});
        }
      } catch (_) { /* optional */ }

      return {
        success: true,
        stars,
        moves_used,
        min_moves: result.minMoves,
        thresholds: result.thresholds,
        xp: rewards.xp,
        runes: rewards.runes,
        bonus_xp: bonusXpActual,
        bonus_runes: bonusRunesActual,
        total_xp: totalXp,
        total_runes: totalRunes,
        milestones: ms.milestones,
        max_level: newMax,
        current_streak: streak,
        level: session.level_num,
        weekly_stars: weeklyStars,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  fastify.post('/tool', {
    preHandler: [fastify.fieldAuthenticate],
    schema: {
      body: {
        type: 'object',
        required: ['session_id', 'tool', 'cans'],
        properties: {
          session_id: { type: 'string', format: 'uuid' },
          tool: { type: 'string', enum: ['protocol', 'passport'] },
          cans: { type: 'array' },
          reagent: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const { session_id, tool, cans, reagent } = req.body;

    const { rows: [session] } = await db.query(
      `SELECT * FROM gamification_chemlab_sessions
       WHERE id = $1 AND employee_id = $2`,
      [session_id, eid]
    );
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    if (session.completed_at) return reply.code(400).send({ error: 'Наряд уже пройден' });

    const goal = parseJson(session.goal, { type: 'sort' });

    if (tool === 'passport') {
      const code = reagent || 'acid_isk';
      const card = buildPassport(code);
      if (!card) return reply.code(400).send({ error: 'Неизвестный реагент' });
      return {
        ok: true,
        tool: 'passport',
        ...card,
      };
    }

    // protocol = hint next safe move
    const hint = hintNextMove(cans, goal);
    if (!hint.ok) return reply.code(400).send({ error: hint.error || 'Протокол недоступен' });
    return { ok: true, tool: 'protocol', ...hint };
  });
}

module.exports = routes;
