/**
 * Gamification CRUD — Shop Items, Prizes, Quests management
 * ═══════════════════════════════════════════════════════════════════
 * Roles: ADMIN, DIRECTOR_GEN, OFFICE_MANAGER, HR
 * Auto-sync: shop item add/update/delete → gamification_prizes auto-upsert
 */

const CRUD_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HR', 'HR_MANAGER', 'OFFICE_MANAGER'];

const ALLOWED_COLS = {
  shop_items: new Set(['name','description','price_runes','category','icon','image_url','is_active','max_stock','current_stock','requires_delivery','rarity']),
  prizes: new Set(['name','description','tier','prize_type','value','weight','icon','is_active','requires_delivery','max_stock']),
  quests: new Set(['name','description','quest_type','target_action','target_count','reward_type','reward_amount','icon','is_active','lore','allowed_roles','required_level']),
};

function buildSafeUpdate(body, allowedSet) {
  const sets = []; const vals = []; let idx = 1;
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && allowedSet.has(k)) { sets.push(`${k} = $${idx}`); vals.push(v); idx++; }
  }
  return { sets, vals, idx };
}

// Auto-sync shop item → gamification_prizes
// weight = GREATEST(1, round(10000 / price_runes))
async function syncShopItemToPrize(db, item) {
  const weight = Math.max(1, Math.round(10000 / item.price_runes));
  const tier = item.rarity || 'common';
  const isActive = item.is_active !== false;

  const { rows: [existing] } = await db.query(
    `SELECT id FROM gamification_prizes WHERE prize_type = 'shop_item' AND value = $1`,
    [item.id]
  );

  if (existing) {
    await db.query(
      `UPDATE gamification_prizes SET tier=$1, name=$2, description=$3, icon=$4, weight=$5, requires_delivery=$6, is_active=$7
       WHERE id = $8`,
      [tier, item.name, item.description || null, item.icon || null, weight, item.requires_delivery || false, isActive, existing.id]
    );
  } else {
    await db.query(
      `INSERT INTO gamification_prizes (tier, prize_type, name, description, icon, weight, value, requires_delivery, is_active)
       VALUES ($1, 'shop_item', $2, $3, $4, $5, $6, $7, $8)`,
      [tier, item.name, item.description || null, item.icon || null, weight, item.id, item.requires_delivery || false, isActive]
    );
  }
}

async function routes(fastify) {
  const db = fastify.db;

  const checkCrudRole = async (req, reply) => {
    if (!CRUD_ROLES.includes(req.user?.role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }
  };

  const auth = [fastify.authenticate, checkCrudRole];

  // ═══════════════════════════════════════════════════════════════
  // SHOP ITEMS
  // ═══════════════════════════════════════════════════════════════

  fastify.get('/shop-items', { preHandler: auth }, async () => {
    // Attach roulette probability to each item
    const { rows: prizes } = await db.query(
      `SELECT value::int AS shop_item_id, weight, is_active
       FROM gamification_prizes WHERE prize_type = 'shop_item'`
    );
    const totalWeight = prizes.filter(p => p.is_active).reduce((s, p) => s + p.weight, 0);
    const prizeMap = {};
    prizes.forEach(p => { prizeMap[p.shop_item_id] = { weight: p.weight, is_active: p.is_active }; });

    const { rows } = await db.query('SELECT * FROM gamification_shop_items ORDER BY category, price_runes');
    const items = rows.map(item => {
      const prize = prizeMap[item.id];
      const pct = prize?.is_active && totalWeight > 0
        ? ((prize.weight / totalWeight) * 100).toFixed(1) : null;
      return { ...item, prize_weight: prize?.weight || null, roulette_pct: pct };
    });
    return { items };
  });

  fastify.post('/shop-items', {
    preHandler: auth,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['name', 'price_runes', 'category'],
        properties: {
          name: { type: 'string', minLength: 1 }, description: { type: 'string' },
          price_runes: { type: 'integer', minimum: 1 },
          category: { type: 'string', enum: ['merch', 'digital', 'privilege', 'cosmetic', 'food'] },
          rarity: { type: 'string', enum: ['common', 'rare', 'epic', 'legendary'] },
          icon: { type: 'string' }, image_url: { type: 'string' },
          is_active: { type: 'boolean' }, max_stock: { type: 'integer' },
          requires_delivery: { type: 'boolean' },
        },
      },
    },
  }, async (req) => {
    const b = req.body;
    const { rows: [item] } = await db.query(
      `INSERT INTO gamification_shop_items (name, description, price_runes, category, icon, image_url, is_active, max_stock, current_stock, requires_delivery, rarity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [b.name, b.description || null, b.price_runes, b.category, b.icon || null, b.image_url || null,
       b.is_active !== false, b.max_stock || null, b.max_stock || 0, b.requires_delivery || false,
       b.rarity || 'common']
    );
    // Auto-sync to roulette prizes
    await syncShopItemToPrize(db, item);
    await db.query(
      `INSERT INTO gamification_audit_log (action, details, performed_by) VALUES ('shop_item_created', $1, $2)`,
      [JSON.stringify({ item_id: item.id, name: b.name }), req.user.id]
    );
    return { ok: true, item };
  });

  fastify.put('/shop-items/:id', {
    preHandler: auth,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string' }, description: { type: 'string' },
          price_runes: { type: 'integer', minimum: 1 },
          category: { type: 'string', enum: ['merch', 'digital', 'privilege', 'cosmetic', 'food'] },
          rarity: { type: 'string', enum: ['common', 'rare', 'epic', 'legendary'] },
          icon: { type: 'string' }, is_active: { type: 'boolean' },
          max_stock: { type: 'integer' }, current_stock: { type: 'integer' },
          requires_delivery: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const { sets, vals, idx } = buildSafeUpdate(req.body, ALLOWED_COLS.shop_items);
    if (sets.length === 0) return reply.code(400).send({ error: 'Нечего обновлять' });
    vals.push(id);
    const { rows: [item] } = await db.query(
      `UPDATE gamification_shop_items SET ${sets.join(',')} WHERE id = $${idx} RETURNING *`, vals
    );
    if (!item) return reply.code(404).send({ error: 'Товар не найден' });
    // Auto-sync to roulette prizes (price or status may have changed)
    await syncShopItemToPrize(db, item);
    await db.query(
      `INSERT INTO gamification_audit_log (action, details, performed_by) VALUES ('shop_item_updated', $1, $2)`,
      [JSON.stringify({ item_id: id, changes: Object.keys(req.body) }), req.user.id]
    );
    return { ok: true, item };
  });

  fastify.delete('/shop-items/:id', { preHandler: auth }, async (req) => {
    const id = parseInt(req.params.id, 10);
    await db.query('UPDATE gamification_shop_items SET is_active = false WHERE id = $1', [id]);
    // Deactivate corresponding prize
    await db.query(
      `UPDATE gamification_prizes SET is_active = false WHERE prize_type = 'shop_item' AND value = $1`,
      [id]
    );
    await db.query(
      `INSERT INTO gamification_audit_log (action, details, performed_by) VALUES ('shop_item_deactivated', $1, $2)`,
      [JSON.stringify({ item_id: id }), req.user.id]
    );
    return { ok: true };
  });

  // ═══════════════════════════════════════════════════════════════
  // PRIZES (Wheel of Norns) — read-only view + manual toggles
  // ═══════════════════════════════════════════════════════════════

  fastify.get('/prizes', { preHandler: auth }, async () => {
    const { rows } = await db.query(`
      SELECT p.*, s.icon_svg, s.price_runes, s.category AS item_category
      FROM gamification_prizes p
      LEFT JOIN gamification_shop_items s ON s.id = p.value AND p.prize_type = 'shop_item'
      ORDER BY p.tier, p.weight DESC
    `);
    const totalWeight = rows.filter(p => p.is_active).reduce((s, p) => s + p.weight, 0);
    const prizes = rows.map(p => ({
      ...p,
      roulette_pct: p.is_active && totalWeight > 0 ? ((p.weight / totalWeight) * 100).toFixed(2) : '0.00'
    }));
    return { prizes, total_weight: totalWeight };
  });

  // Toggle prize active/inactive
  fastify.put('/prizes/:id/toggle', { preHandler: auth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const { rows: [prize] } = await db.query(
      `UPDATE gamification_prizes SET is_active = NOT is_active WHERE id = $1 RETURNING *`, [id]
    );
    if (!prize) return reply.code(404).send({ error: 'Приз не найден' });
    return { ok: true, is_active: prize.is_active };
  });

  // ═══════════════════════════════════════════════════════════════
  // QUESTS
  // ═══════════════════════════════════════════════════════════════

  fastify.get('/quests', { preHandler: auth }, async () => {
    const { rows } = await db.query('SELECT * FROM gamification_quests ORDER BY quest_type, id');
    return { quests: rows };
  });

  fastify.post('/quests', {
    preHandler: auth,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['quest_type', 'name', 'target_action', 'target_count', 'reward_amount'],
        properties: {
          quest_type: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'seasonal', 'permanent'] },
          name: { type: 'string', minLength: 1 }, description: { type: 'string' },
          target_action: { type: 'string' }, target_count: { type: 'integer', minimum: 1 },
          reward_type: { type: 'string' }, reward_amount: { type: 'integer', minimum: 0 },
          icon: { type: 'string' }, is_active: { type: 'boolean' },
        },
      },
    },
  }, async (req) => {
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
    preHandler: auth,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string' }, description: { type: 'string' },
          quest_type: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'seasonal', 'permanent'] },
          target_action: { type: 'string' }, target_count: { type: 'integer', minimum: 1 },
          reward_amount: { type: 'integer', minimum: 0 }, reward_type: { type: 'string' },
          icon: { type: 'string' }, is_active: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const { sets, vals, idx } = buildSafeUpdate(req.body, ALLOWED_COLS.quests);
    if (sets.length === 0) return reply.code(400).send({ error: 'Нечего обновлять' });
    vals.push(id);
    const { rows: [quest] } = await db.query(
      `UPDATE gamification_quests SET ${sets.join(',')} WHERE id = $${idx} RETURNING *`, vals
    );
    if (!quest) return reply.code(404).send({ error: 'Квест не найден' });
    return { ok: true, quest };
  });

  fastify.delete('/quests/:id', { preHandler: auth }, async (req) => {
    await db.query('UPDATE gamification_quests SET is_active = false WHERE id = $1', [parseInt(req.params.id, 10)]);
    return { ok: true };
  });

  // ═══════════════════════════════════════════════════════════════
  // WINNERS — история выигрышей по всем РП и рабочим
  // ═══════════════════════════════════════════════════════════════

  fastify.get('/winners', { preHandler: auth }, async (req) => {
    const { from, to, employee_id, status } = req.query;

    const conditions = ['1=1'];
    const params = [];
    let idx = 1;

    if (from) { conditions.push(`gs.spin_at >= $${idx++}`); params.push(from); }
    if (to)   { conditions.push(`gs.spin_at <= $${idx++}`); params.push(to + ' 23:59:59'); }
    if (employee_id) { conditions.push(`gs.employee_id = $${idx++}`); params.push(parseInt(employee_id)); }
    if (status === 'pending') { conditions.push(`gf.status IN ('pending', 'ready')`); }
    if (status === 'delivered') { conditions.push(`gf.status = 'delivered'`); }

    const { rows } = await db.query(`
      SELECT
        gs.id AS spin_id,
        gs.spin_at,
        gs.prize_tier AS tier,
        gs.prize_name,
        e.id AS employee_id,
        e.fio AS employee_name,
        e.phone AS employee_phone,
        e.position AS employee_position,
        w.object_name AS work_name,
        gf.id AS fulfillment_id,
        gf.status AS delivery_status,
        gf.delivered_at,
        gf.delivery_note,
        gsi.icon AS item_icon,
        gsi.category AS item_category,
        gsi.price_runes
      FROM gamification_spins gs
      JOIN employees e ON e.id = gs.employee_id
      LEFT JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_active = true
      LEFT JOIN works w ON w.id = ea.work_id
      LEFT JOIN LATERAL (
        SELECT gi.id
        FROM gamification_inventory gi
        WHERE gi.employee_id = gs.employee_id
          AND gi.source_type = 'spin'
          AND gi.source_id = gs.prize_id
        ORDER BY gi.acquired_at DESC
        LIMIT 1
      ) gi ON true
      LEFT JOIN gamification_fulfillment gf ON gf.inventory_id = gi.id
      LEFT JOIN gamification_prizes gp ON gp.id = gs.prize_id
      LEFT JOIN gamification_shop_items gsi ON gsi.id = gp.value AND gp.prize_type = 'shop_item'
      WHERE ${conditions.join(' AND ')}
      ORDER BY gs.spin_at DESC
      LIMIT 200
    `, params);

    // Stats summary
    const { rows: [stats] } = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM gamification_spins) AS total_spins,
        COUNT(gf.id) FILTER (WHERE gf.status IN ('pending','ready')) AS pending_deliveries,
        COUNT(gf.id) FILTER (WHERE gf.status = 'delivered') AS delivered,
        COUNT(gf.id) FILTER (WHERE gs.prize_tier IN ('rare','epic','legendary')) AS rare_wins
      FROM gamification_spins gs
      LEFT JOIN LATERAL (
        SELECT gi.id FROM gamification_inventory gi
        WHERE gi.employee_id = gs.employee_id AND gi.source_type = 'spin' AND gi.source_id = gs.prize_id
        ORDER BY gi.acquired_at DESC LIMIT 1
      ) gi ON true
      LEFT JOIN gamification_fulfillment gf ON gf.inventory_id = gi.id
    `);

    return { wins: rows, stats };
  });

  // Mark delivery from winners tab
  fastify.put('/winners/delivery/:fulfillmentId', {
    preHandler: auth,
    schema: {
      body: { type: 'object', properties: { delivery_note: { type: 'string' }, status: { type: 'string', enum: ['ready', 'delivered'] } } }
    }
  }, async (req, reply) => {
    const fid = parseInt(req.params.fulfillmentId, 10);
    const { delivery_note, status = 'delivered' } = req.body || {};

    const updateFields = status === 'delivered'
      ? `status = 'delivered', delivered_at = NOW(), delivered_by = $1, delivery_note = $2, updated_at = NOW()`
      : `status = 'ready', updated_at = NOW()`;
    const params = status === 'delivered' ? [req.user.id, delivery_note || null, fid] : [fid];

    const { rows: [item] } = await db.query(
      `UPDATE gamification_fulfillment SET ${updateFields} WHERE id = $${params.length} AND status IN ('pending','ready') RETURNING *`,
      params
    );
    if (!item) return reply.code(404).send({ error: 'Запись не найдена или уже выдана' });

    if (status === 'delivered') {
      await db.query('UPDATE gamification_inventory SET is_delivered = true WHERE id = $1', [item.inventory_id]);
    }

    return { ok: true, status };
  });
}

module.exports = routes;
