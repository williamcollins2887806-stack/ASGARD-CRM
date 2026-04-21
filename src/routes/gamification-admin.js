/**
 * Gamification Admin API — Fulfillment (PM) + Dashboard (Director)
 * ═══════════════════════════════════════════════════════════════════
 * GET  /pending-deliveries   — prizes ready for delivery (PM's works)
 * PUT  /inventory/:id/deliver — mark prize as delivered
 * GET  /dashboard            — KPI + stats for director
 */

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
               gf.delivery_note, gf.delivered_at, gf.created_at,
               e.name AS employee_name, e.phone AS employee_phone,
               w.object_name AS work_name
        FROM gamification_fulfillment gf
        JOIN employees e ON e.id = gf.employee_id
        LEFT JOIN employee_assignments fa ON fa.employee_id = gf.employee_id
        LEFT JOIN works w ON w.id = fa.work_id
        WHERE gf.status IN ('pending', 'ready')
        ORDER BY CASE gf.status WHEN 'ready' THEN 0 WHEN 'pending' THEN 1 END, gf.created_at DESC
      `;
      params = [];
    } else {
      query = `
        SELECT gf.id, gf.inventory_id, gf.employee_id, gf.item_name, gf.status,
               gf.delivery_note, gf.delivered_at, gf.created_at,
               e.name AS employee_name, e.phone AS employee_phone,
               w.object_name AS work_name
        FROM gamification_fulfillment gf
        JOIN employees e ON e.id = gf.employee_id
        LEFT JOIN employee_assignments fa ON fa.employee_id = gf.employee_id
        LEFT JOIN works w ON w.id = fa.work_id
        WHERE gf.status IN ('pending', 'ready')
          AND w.pm_id = $1
        ORDER BY CASE gf.status WHEN 'ready' THEN 0 WHEN 'pending' THEN 1 END, gf.created_at DESC
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
             e.name AS employee_name, u.name AS delivered_by_name
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

    // Check that fulfillment exists and is ready
    const { rows: [item] } = await db.query(
      'SELECT * FROM gamification_fulfillment WHERE id = $1 AND status IN ($2, $3)',
      [fulfillmentId, 'pending', 'ready']
    );
    if (!item) return reply.code(404).send({ error: 'Запись не найдена или уже выдана' });

    // Update status
    await db.query(
      `UPDATE gamification_fulfillment
       SET status = 'delivered', delivered_at = NOW(), delivered_by = $1, delivery_note = $2, updated_at = NOW()
       WHERE id = $3`,
      [user.id, delivery_note || null, fulfillmentId]
    );

    // Update inventory
    await db.query(
      'UPDATE gamification_inventory SET is_delivered = true WHERE id = $1',
      [item.inventory_id]
    );

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

    return { ok: true, fulfillment_id: fulfillmentId, status: 'ready' };
  });

  // ── GET /dashboard — director dashboard KPIs ──
  fastify.get('/dashboard', { preHandler: [fastify.authenticate] }, async (req) => {
    const allowedRoles = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HR', 'ADMIN'];
    if (!allowedRoles.includes(req.user.role)) {
      return { error: 'Нет доступа' };
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
      SELECT e.name, COUNT(*) AS spins
      FROM gamification_spins gs
      JOIN employees e ON e.id = gs.employee_id
      GROUP BY e.id, e.name ORDER BY spins DESC LIMIT 10
    `);

    // Recent operations
    const { rows: recentOps } = await db.query(`
      SELECT gcl.created_at, e.name AS employee_name, gcl.currency, gcl.amount, gcl.operation, gcl.note
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
}

module.exports = routes;
