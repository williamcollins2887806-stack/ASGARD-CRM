/**
 * Gamification CRUD — Shop Items, Prizes, Quests management
 * ═══════════════════════════════════════════════════════════════════
 * Roles: ADMIN, DIRECTOR_GEN, HR
 *
 * Shop Items:  GET/POST/PUT/DELETE /shop-items
 * Prizes:      GET/POST/PUT/DELETE /prizes
 * Quests:      GET/POST/PUT/DELETE /quests
 */

const CRUD_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HR', 'HR_MANAGER'];

async function routes(fastify) {
  const db = fastify.db;

  function checkRole(req, reply) {
    if (!CRUD_ROLES.includes(req.user?.role)) {
      reply.code(403).send({ error: 'Нет доступа' });
      return false;
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // SHOP ITEMS
  // ═══════════════════════════════════════════════════════════════

  fastify.get('/shop-items', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    if (!checkRole(req, reply)) return;
    const { rows } = await db.query(
      'SELECT * FROM gamification_shop_items ORDER BY category, price_runes'
    );
    return { items: rows };
  });

  fastify.post('/shop-items', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name', 'price_runes', 'category'],
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          price_runes: { type: 'integer', minimum: 1 },
          category: { type: 'string', enum: ['merch', 'digital', 'privilege', 'cosmetic'] },
          icon: { type: 'string' },
          image_url: { type: 'string' },
          is_active: { type: 'boolean' },
          max_stock: { type: 'integer' },
          requires_delivery: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    if (!checkRole(req, reply)) return;
    const b = req.body;
    const { rows: [item] } = await db.query(
      `INSERT INTO gamification_shop_items (name, description, price_runes, category, icon, image_url, is_active, max_stock, current_stock, requires_delivery)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) RETURNING *`,
      [b.name, b.description || null, b.price_runes, b.category, b.icon || null, b.image_url || null,
       b.is_active !== false, b.max_stock || null, b.requires_delivery || false]
    );
    await db.query(
      `INSERT INTO gamification_audit_log (action, details, performed_by) VALUES ('shop_item_created', $1, $2)`,
      [JSON.stringify({ item_id: item.id, name: b.name }), req.user.id]
    );
    return { ok: true, item };
  });

  fastify.put('/shop-items/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          price_runes: { type: 'integer', minimum: 1 },
          category: { type: 'string', enum: ['merch', 'digital', 'privilege', 'cosmetic'] },
          icon: { type: 'string' },
          is_active: { type: 'boolean' },
          max_stock: { type: 'integer' },
          current_stock: { type: 'integer' },
          requires_delivery: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    if (!checkRole(req, reply)) return;
    const id = parseInt(req.params.id, 10);
    const b = req.body;
    const sets = []; const vals = []; let idx = 1;
    for (const [k, v] of Object.entries(b)) {
      if (v !== undefined) { sets.push(`${k} = $${idx}`); vals.push(v); idx++; }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'Нечего обновлять' });
    vals.push(id);
    const { rows: [item] } = await db.query(
      `UPDATE gamification_shop_items SET ${sets.join(',')} WHERE id = $${idx} RETURNING *`, vals
    );
    if (!item) return reply.code(404).send({ error: 'Товар не найден' });
    await db.query(
      `INSERT INTO gamification_audit_log (action, details, performed_by) VALUES ('shop_item_updated', $1, $2)`,
      [JSON.stringify({ item_id: id, changes: Object.keys(b) }), req.user.id]
    );
    return { ok: true, item };
  });

  fastify.delete('/shop-items/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    if (!checkRole(req, reply)) return;
    const id = parseInt(req.params.id, 10);
    await db.query('UPDATE gamification_shop_items SET is_active = false WHERE id = $1', [id]);
    await db.query(
      `INSERT INTO gamification_audit_log (action, details, performed_by) VALUES ('shop_item_deactivated', $1, $2)`,
      [JSON.stringify({ item_id: id }), req.user.id]
    );
    return { ok: true };
  });

  // ═══════════════════════════════════════════════════════════════
  // PRIZES (Wheel of Norns)
  // ═══════════════════════════════════════════════════════════════

  fastify.get('/prizes', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    if (!checkRole(req, reply)) return;
    const { rows } = await db.query('SELECT * FROM gamification_prizes ORDER BY tier, weight DESC');
    return { prizes: rows };
  });

  fastify.post('/prizes', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['tier', 'prize_type', 'name', 'weight'],
        properties: {
          tier: { type: 'string', enum: ['common', 'rare', 'epic', 'legendary'] },
          prize_type: { type: 'string', enum: ['runes', 'xp', 'multiplier', 'extra_spin', 'sticker', 'avatar_frame', 'vip', 'merch'] },
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          value: { type: 'integer' },
          weight: { type: 'integer', minimum: 1 },
          icon: { type: 'string' },
          is_active: { type: 'boolean' },
          requires_delivery: { type: 'boolean' },
          max_stock: { type: 'integer' },
        },
      },
    },
  }, async (req, reply) => {
    if (!checkRole(req, reply)) return;
    const b = req.body;
    const { rows: [prize] } = await db.query(
      `INSERT INTO gamification_prizes (tier, prize_type, name, description, value, weight, icon, is_active, requires_delivery, max_stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [b.tier, b.prize_type, b.name, b.description || null, b.value || 0, b.weight, b.icon || null,
       b.is_active !== false, b.requires_delivery || false, b.max_stock || null]
    );
    await db.query(
      `INSERT INTO gamification_audit_log (action, details, performed_by) VALUES ('prize_created', $1, $2)`,
      [JSON.stringify({ prize_id: prize.id, name: b.name }), req.user.id]
    );
    return { ok: true, prize };
  });

  fastify.put('/prizes/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          value: { type: 'integer' },
          weight: { type: 'integer', minimum: 1 },
          icon: { type: 'string' },
          is_active: { type: 'boolean' },
          requires_delivery: { type: 'boolean' },
          max_stock: { type: 'integer' },
        },
      },
    },
  }, async (req, reply) => {
    if (!checkRole(req, reply)) return;
    const id = parseInt(req.params.id, 10);
    const b = req.body;
    const sets = []; const vals = []; let idx = 1;
    for (const [k, v] of Object.entries(b)) {
      if (v !== undefined) { sets.push(`${k} = $${idx}`); vals.push(v); idx++; }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'Нечего обновлять' });
    vals.push(id);
    const { rows: [prize] } = await db.query(
      `UPDATE gamification_prizes SET ${sets.join(',')} WHERE id = $${idx} RETURNING *`, vals
    );
    if (!prize) return reply.code(404).send({ error: 'Приз не найден' });
    return { ok: true, prize };
  });

  fastify.delete('/prizes/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    if (!checkRole(req, reply)) return;
    await db.query('UPDATE gamification_prizes SET is_active = false WHERE id = $1', [parseInt(req.params.id, 10)]);
    return { ok: true };
  });

  // ═══════════════════════════════════════════════════════════════
  // QUESTS
  // ═══════════════════════════════════════════════════════════════

  fastify.get('/quests', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    if (!checkRole(req, reply)) return;
    const { rows } = await db.query('SELECT * FROM gamification_quests ORDER BY quest_type, id');
    return { quests: rows };
  });

  fastify.post('/quests', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['quest_type', 'name', 'target_action', 'target_count', 'reward_amount'],
        properties: {
          quest_type: { type: 'string', enum: ['daily', 'weekly', 'seasonal', 'permanent'] },
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          target_action: { type: 'string' },
          target_count: { type: 'integer', minimum: 1 },
          reward_type: { type: 'string' },
          reward_amount: { type: 'integer', minimum: 0 },
          icon: { type: 'string' },
          is_active: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    if (!checkRole(req, reply)) return;
    const b = req.body;
    const { rows: [quest] } = await db.query(
      `INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [b.quest_type, b.name, b.description || null, b.target_action, b.target_count,
       b.reward_type || 'runes', b.reward_amount, b.icon || null, b.is_active !== false]
    );
    return { ok: true, quest };
  });

  fastify.put('/quests/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          target_count: { type: 'integer', minimum: 1 },
          reward_amount: { type: 'integer', minimum: 0 },
          icon: { type: 'string' },
          is_active: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    if (!checkRole(req, reply)) return;
    const id = parseInt(req.params.id, 10);
    const b = req.body;
    const sets = []; const vals = []; let idx = 1;
    for (const [k, v] of Object.entries(b)) {
      if (v !== undefined) { sets.push(`${k} = $${idx}`); vals.push(v); idx++; }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'Нечего обновлять' });
    vals.push(id);
    const { rows: [quest] } = await db.query(
      `UPDATE gamification_quests SET ${sets.join(',')} WHERE id = $${idx} RETURNING *`, vals
    );
    if (!quest) return reply.code(404).send({ error: 'Квест не найден' });
    return { ok: true, quest };
  });

  fastify.delete('/quests/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    if (!checkRole(req, reply)) return;
    await db.query('UPDATE gamification_quests SET is_active = false WHERE id = $1', [parseInt(req.params.id, 10)]);
    return { ok: true };
  });
}

module.exports = routes;
