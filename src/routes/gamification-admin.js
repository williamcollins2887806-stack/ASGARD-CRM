/**
 * Gamification Admin API — Fulfillment (PM) + Dashboard (Director)
 * ═══════════════════════════════════════════════════════════════════
 * GET  /pending-deliveries   — prizes ready for delivery (PM's works)
 * PUT  /inventory/:id/deliver — mark prize as delivered
 * GET  /dashboard            — KPI + stats for director
 */

const notificationDispatcher = require('../services/notificationDispatcher'); // D-1

async function routes(fastify) {
  const db = fastify.db;

  // ── GET /pending-deliveries — for PM / Director ──
  fastify.get('/pending-deliveries', { preHandler: [fastify.authenticate] }, async (req) => {
    const user = req.user;
    const allowedRoles = ['PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'];
    if (!allowedRoles.includes(user.role)) {
      return { deliveries: [] };
    }

    // PM sees only their works, directors see all
    const isDirector = user.role.startsWith('DIRECTOR') || user.role === 'ADMIN';
    let query, params;

    if (isDirector) {
      query = `
        SELECT gf.id, gf.inventory_id, gf.employee_id, gf.item_name, gf.status,
               gf.delivery_note, gf.delivered_at, gf.requested_at, gf.created_at,
               e.fio AS employee_name, e.phone AS employee_phone,
               w.object_name AS work_name
        FROM gamification_fulfillment gf
        JOIN employees e ON e.id = gf.employee_id
        LEFT JOIN employee_assignments fa ON fa.employee_id = gf.employee_id
        LEFT JOIN works w ON w.id = fa.work_id
        WHERE gf.status IN ('pending', 'requested', 'ready')
        ORDER BY CASE gf.status WHEN 'requested' THEN 0 WHEN 'ready' THEN 1 WHEN 'pending' THEN 2 END, gf.created_at DESC
      `;
      params = [];
    } else {
      query = `
        SELECT gf.id, gf.inventory_id, gf.employee_id, gf.item_name, gf.status,
               gf.delivery_note, gf.delivered_at, gf.requested_at, gf.created_at,
               e.fio AS employee_name, e.phone AS employee_phone,
               w.object_name AS work_name
        FROM gamification_fulfillment gf
        JOIN employees e ON e.id = gf.employee_id
        LEFT JOIN employee_assignments fa ON fa.employee_id = gf.employee_id
        LEFT JOIN works w ON w.id = fa.work_id
        WHERE gf.status IN ('pending', 'requested', 'ready')
          AND w.pm_id = $1
        ORDER BY CASE gf.status WHEN 'requested' THEN 0 WHEN 'ready' THEN 1 WHEN 'pending' THEN 2 END, gf.created_at DESC
      `;
      params = [user.id];
    }

    const { rows } = await db.query(query, params);
    return { deliveries: rows };
  });

  // ── GET /delivered-history — recent deliveries ──
  fastify.get('/delivered-history', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const allowedRoles = ['PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'];
    if (!allowedRoles.includes(req.user?.role)) return reply.code(403).send({ error: 'Нет доступа' });
    const { rows } = await db.query(`
      SELECT gf.id, gf.item_name, gf.status, gf.delivered_at, gf.delivery_note,
             e.fio AS employee_name, u.name AS delivered_by_name
      FROM gamification_fulfillment gf
      JOIN employees e ON e.id = gf.employee_id
      LEFT JOIN users u ON u.id = gf.delivered_by
      WHERE gf.status = 'delivered'
      ORDER BY gf.delivered_at DESC LIMIT 50
    `);
    return { history: rows };
  });

  // ── PUT /inventory/:id/deliver — mark as delivered ──
  fastify.put('/inventory/:id/deliver', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: { delivery_note: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const allowedRoles = ['PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'];
    if (!allowedRoles.includes(req.user?.role)) return reply.code(403).send({ error: 'Нет доступа' });
    const user = req.user;
    const fulfillmentId = parseInt(req.params.id, 10);
    const { delivery_note } = req.body || {};

    // R4 fix: atomic UPDATE with status check (prevents double-delivery)
    const { rows: [item] } = await db.query(
      `UPDATE gamification_fulfillment
       SET status = 'delivered', delivered_at = NOW(), delivered_by = $1, delivery_note = $2, updated_at = NOW()
       WHERE id = $3 AND status IN ('pending', 'requested', 'ready')
       RETURNING *`,
      [user.id, delivery_note || null, fulfillmentId]
    );
    if (!item) return reply.code(404).send({ error: 'Запись не найдена или уже выдана' });

    // Update inventory
    await db.query(
      'UPDATE gamification_inventory SET is_delivered = true WHERE id = $1',
      [item.inventory_id]
    );

    // Notify worker that prize has been delivered
    const { rows: [empInfo] } = await db.query(
      'SELECT user_id FROM employees WHERE id = $1', [item.employee_id]
    );
    if (empInfo?.user_id) {
      notificationDispatcher.send(db, empInfo.user_id, 'FULFILLMENT_READY', {
        item: item.item_name,
        message: `Ваш приз "${item.item_name}" выдан! Нажмите "Получил" в приложении.`,
      }).catch(() => {});
    }

    // Audit log
    await db.query(
      `INSERT INTO gamification_audit_log (employee_id, action, details, performed_by)
       VALUES ($1, 'prize_delivered', $2, $3)`,
      [item.employee_id, JSON.stringify({ fulfillment_id: fulfillmentId, item_name: item.item_name, note: delivery_note }), user.id]
    );

    return { ok: true, fulfillment_id: fulfillmentId, status: 'delivered' };
  });

  // ── PUT /inventory/:id/ready — mark as ready for pickup ──
  fastify.put('/inventory/:id/ready', {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    const allowedRoles = ['PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'];
    if (!allowedRoles.includes(req.user?.role)) return reply.code(403).send({ error: 'Нет доступа' });
    const fulfillmentId = parseInt(req.params.id, 10);

    const { rows: [item] } = await db.query(
      'SELECT * FROM gamification_fulfillment WHERE id = $1 AND status = $2',
      [fulfillmentId, 'pending']
    );
    if (!item) return reply.code(404).send({ error: 'Запись не найдена' });

    await db.query(
      `UPDATE gamification_fulfillment SET status = 'ready', updated_at = NOW() WHERE id = $1`,
      [fulfillmentId]
    );

    // D-1: Notify worker that prize is ready for pickup
    const { rows: [emp] } = await db.query(
      'SELECT user_id FROM employees WHERE id = $1', [item.employee_id]
    );
    if (emp?.user_id) {
      notificationDispatcher.send(db, emp.user_id, 'FULFILLMENT_READY', {
        item: item.item_name, message: `Приз "${item.item_name}" готов! Заберите у РП.`
      }).catch(() => {});
    }

    return { ok: true, fulfillment_id: fulfillmentId, status: 'ready' };
  });

  // ── GET /dashboard — director dashboard KPIs ──
  fastify.get('/dashboard', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const allowedRoles = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HR', 'HR_MANAGER', 'ADMIN', 'HEAD_PM'];
    if (!allowedRoles.includes(req.user.role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    // KPI cards
    const [
      { rows: [walletSum] },
      { rows: [spinsToday] },
      { rows: [prizesMonth] },
      { rows: [activeWorkers] },
    ] = await Promise.all([
      db.query("SELECT COALESCE(SUM(balance), 0) AS total FROM gamification_wallets WHERE currency = 'runes'"),
      db.query("SELECT COUNT(*) AS cnt FROM gamification_spins WHERE spin_at::date = CURRENT_DATE"),
      db.query("SELECT COUNT(*) AS cnt FROM gamification_fulfillment WHERE status = 'delivered' AND delivered_at >= NOW() - INTERVAL '30 days'"),
      db.query("SELECT COUNT(DISTINCT employee_id) AS cnt FROM gamification_spins WHERE spin_at >= NOW() - INTERVAL '7 days'"),
    ]);

    // Top prizes
    const { rows: topPrizes } = await db.query(`
      SELECT prize_name, COUNT(*) AS cnt
      FROM gamification_spins
      WHERE prize_tier IN ('rare', 'epic', 'legendary')
      GROUP BY prize_name ORDER BY cnt DESC LIMIT 10
    `);

    // Top workers
    const { rows: topWorkers } = await db.query(`
      SELECT e.fio AS name, COUNT(*) AS spins
      FROM gamification_spins gs
      JOIN employees e ON e.id = gs.employee_id
      GROUP BY e.id, e.fio ORDER BY spins DESC LIMIT 10
    `);

    // Recent operations
    const { rows: recentOps } = await db.query(`
      SELECT gcl.created_at, e.fio AS employee_name, gcl.currency, gcl.amount, gcl.operation, gcl.note
      FROM gamification_currency_ledger gcl
      JOIN employees e ON e.id = gcl.employee_id
      ORDER BY gcl.created_at DESC LIMIT 20
    `);

    return {
      kpi: {
        runes_in_circulation: parseInt(walletSum.total),
        spins_today: parseInt(spinsToday.cnt),
        prizes_delivered_month: parseInt(prizesMonth.cnt),
        active_workers_7d: parseInt(activeWorkers.cnt),
      },
      top_prizes: topPrizes,
      top_workers: topWorkers,
      recent_operations: recentOps,
    };
  });
  // ── GET /leaderboard — full worker leaderboard for PM/Director desktop view ──
  fastify.get('/leaderboard', { preHandler: [fastify.authenticate] }, async (req) => {
    const allowedRoles = ['PM','HEAD_PM','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','ADMIN','HR','HR_MANAGER'];
    if (!allowedRoles.includes(req.user.role)) return { leaderboard: [], tournament: null };

    const RANK_TITLES = [
      { min: 1,  title: 'Трэль',     icon: '⛓️',  color: '#9ca3af' },
      { min: 3,  title: 'Карл',      icon: '⚒️',  color: '#a78bfa' },
      { min: 5,  title: 'Хускарл',   icon: '🛡️',  color: '#60a5fa' },
      { min: 8,  title: 'Дружинник', icon: '⚔️',  color: '#34d399' },
      { min: 12, title: 'Витязь',    icon: '🏹',  color: '#f97316' },
      { min: 16, title: 'Ярл',       icon: '👑',  color: '#D4A843' },
      { min: 20, title: 'Конунг',    icon: '⚡',  color: '#ef4444' },
    ];
    function getRankTitle(level) {
      const lvl = parseInt(level) || 1;
      let r = RANK_TITLES[0];
      for (const t of RANK_TITLES) { if (lvl >= t.min) r = t; }
      return r;
    }

    // warrior_power = total_shifts*300 + earned_xp*8 + earned_runes*1
    const { rows } = await db.query(`
      WITH earned AS (
        SELECT employee_id,
          SUM(CASE WHEN currency='runes' AND amount>0 THEN amount ELSE 0 END)::int AS earned_runes,
          SUM(CASE WHEN currency='xp'    AND amount>0 THEN amount ELSE 0 END)::int AS earned_xp
        FROM gamification_currency_ledger GROUP BY employee_id
      ),
      ranked AS (
        SELECT
          e.id AS employee_id, e.fio, e.active_avatar,
          COALESCE(ea.earned_runes,0)  AS earned_runes,
          COALESCE(ea.earned_xp,0)     AS earned_xp,
          COALESCE(gw_r.balance,0)::int AS runes,
          COALESCE(gw_x.balance,0)::int AS xp,
          COALESCE(sh.shift_count,0)::int AS total_shifts,
          COALESCE(gs.current_streak,0)::int AS streak,
          GREATEST(1, FLOOR(COALESCE(gw_x.balance,0)/100)+1)::int AS level,
          (COALESCE(sh.shift_count,0)*300 + COALESCE(ea.earned_xp,0)*8 + COALESCE(ea.earned_runes,0))::int AS warrior_power,
          ROW_NUMBER() OVER (
            ORDER BY (COALESCE(sh.shift_count,0)*300 + COALESCE(ea.earned_xp,0)*8 + COALESCE(ea.earned_runes,0)) DESC
          )::int AS rank
        FROM employees e
        LEFT JOIN gamification_wallets gw_r ON gw_r.employee_id=e.id AND gw_r.currency='runes'
        LEFT JOIN gamification_wallets gw_x ON gw_x.employee_id=e.id AND gw_x.currency='xp'
        LEFT JOIN earned ea ON ea.employee_id=e.id
        LEFT JOIN (SELECT employee_id, COUNT(*)::int AS shift_count FROM field_checkins WHERE status='completed' GROUP BY employee_id) sh ON sh.employee_id=e.id
        LEFT JOIN gamification_streaks gs ON gs.employee_id=e.id
        WHERE e.is_active = true
      )
      SELECT * FROM ranked ORDER BY rank
    `);

    const leaderboard = rows.map(r => ({ ...r, rank_title: getRankTitle(r.level) }));

    // ── Real DB tournament bracket ──
    let tournament = null;
    try {
      const { rows: [dbT] } = await db.query(
        `SELECT * FROM gamification_tournaments ORDER BY week_start DESC LIMIT 1`
      );
      if (dbT && Array.isArray(dbT.seeding) && dbT.seeding.length >= 2) {
        const seeding = dbT.seeding;
        const playerIds = seeding.map(s => s.employee_id);

        const { rows: weeklyRows } = await db.query(`
          WITH wc AS (
            SELECT employee_id,
              SUM(CASE WHEN currency='runes' AND amount>0 THEN amount ELSE 0 END)::int AS weekly_runes,
              SUM(CASE WHEN currency='xp'    AND amount>0 THEN amount ELSE 0 END)::int AS weekly_xp
            FROM gamification_currency_ledger
            WHERE employee_id = ANY($1)
              AND (created_at AT TIME ZONE 'Europe/Moscow')::date >= $2::date
              AND (created_at AT TIME ZONE 'Europe/Moscow')::date <= $3::date
            GROUP BY employee_id
          ),
          ws AS (
            SELECT employee_id, COUNT(*)::int AS weekly_shifts
            FROM field_checkins
            WHERE status='completed' AND employee_id = ANY($1)
              AND (checkin_at AT TIME ZONE 'Europe/Moscow')::date >= $2::date
              AND (checkin_at AT TIME ZONE 'Europe/Moscow')::date <= $3::date
            GROUP BY employee_id
          )
          SELECT e.id AS employee_id,
            (COALESCE(ws.weekly_shifts,0)*300 + COALESCE(wc.weekly_xp,0)*8 + COALESCE(wc.weekly_runes,0))::int AS weekly_warrior_power
          FROM employees e
          LEFT JOIN wc ON wc.employee_id = e.id
          LEFT JOIN ws ON ws.employee_id = e.id
          WHERE e.id = ANY($1)
        `, [playerIds, dbT.week_start, dbT.week_end]);

        const wmap = {};
        for (const r of weeklyRows) wmap[r.employee_id] = parseInt(r.weekly_warrior_power) || 0;

        function mkCard(s) {
          if (!s) return null;
          return { employee_id: s.employee_id, name: (s.fio||'').split(' ')[0], seed: s.seed, seeded_power: s.warrior_power||0, warrior_power: wmap[s.employee_id]||0 };
        }
        function winnerCard(c1, c2) {
          if (!c1) return c2; if (!c2) return c1;
          if (c1.warrior_power !== c2.warrior_power) return c1.warrior_power > c2.warrior_power ? c1 : c2;
          return c1.seed < c2.seed ? c1 : c2;
        }
        function makeMatch(c1, c2) { const w = winnerCard(c1, c2); return { p1: c1||null, p2: c2||null, winner_id: w?.employee_id??null }; }
        function getWinner(m) { return m ? (m.winner_id === m.p1?.employee_id ? m.p1 : m.p2) : null; }

        const seeds = seeding.slice(0, 16);
        while (seeds.length < 16) seeds.push(null);
        const r1 = Array.from({length:8},(_,i) => makeMatch(mkCard(seeds[i]), mkCard(seeds[15-i])));
        const r2 = Array.from({length:4},(_,i) => makeMatch(getWinner(r1[i*2]), getWinner(r1[i*2+1])));
        const r3 = Array.from({length:2},(_,i) => makeMatch(getWinner(r2[i*2]), getWinner(r2[i*2+1])));
        const rfinal = makeMatch(getWinner(r3[0]), getWinner(r3[1]));

        tournament = {
          week_start: dbT.week_start, week_end: dbT.week_end, status: dbT.status,
          rounds: [r1, r2, r3, [rfinal]], champion: getWinner(rfinal),
        };
      }
    } catch (tErr) {
      /* tournament is optional — non-fatal */
    }

    return { leaderboard, tournament };
  });
}

module.exports = routes;
