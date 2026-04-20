/**
 * Field Gamification API — Wheel of Norns + Wallet + Shop
 * ═══════════════════════════════════════════════════════════
 * GET  /wallet          — balances (silver, runes, xp) + level
 * POST /wallet/convert  — silver → runes
 * GET  /wallet/history  — ledger transactions
 * POST /spin            — spin the wheel (server RNG)
 * GET  /prizes          — current prize catalog
 * GET  /shop            — shop items
 * POST /shop/buy        — purchase with runes
 * GET  /inventory       — player inventory
 * GET  /quests          — active quests + progress
 */

const crypto = require('crypto');

async function routes(fastify) {
  const db = fastify.db;

  // ── GET /wallet — balances + level ──
  fastify.get('/wallet', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const eid = req.fieldEmployee.id;
    const { rows } = await db.query(
      'SELECT currency, balance FROM gamification_wallets WHERE employee_id = $1', [eid]
    );
    const balances = { silver: 0, runes: 0, xp: 0 };
    rows.forEach((r) => { balances[r.currency] = r.balance; });

    const xpPerLevel = 100;
    const level = Math.floor(balances.xp / xpPerLevel) + 1;
    const xpInLevel = balances.xp % xpPerLevel;

    return { ...balances, level, xp_in_level: xpInLevel, xp_per_level: xpPerLevel };
  });

  // ── POST /wallet/convert — silver → runes ──
  fastify.post('/wallet/convert', {
    preHandler: [fastify.fieldAuthenticate],
    schema: { body: { type: 'object', required: ['silver_amount'], properties: { silver_amount: { type: 'integer', minimum: 10 } } } }
  }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const { silver_amount } = req.body;
    const runesGained = silver_amount * 10; // 10 silver = 100 runes → 1 silver = 10 runes

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Debit silver
      const { rows: [wallet] } = await client.query(
        `UPDATE gamification_wallets SET balance = balance - $1, updated_at = NOW()
         WHERE employee_id = $2 AND currency = 'silver' AND balance >= $1 RETURNING balance`,
        [silver_amount, eid]
      );
      if (!wallet) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Недостаточно серебра' }); }

      // Credit runes
      await client.query(
        `INSERT INTO gamification_wallets (employee_id, currency, balance)
         VALUES ($1, 'runes', $2)
         ON CONFLICT (employee_id, currency) DO UPDATE SET balance = gamification_wallets.balance + $2, updated_at = NOW()`,
        [eid, runesGained]
      );

      // Ledger entries
      await client.query(
        `INSERT INTO gamification_currency_ledger (employee_id, currency, amount, balance_after, operation)
         VALUES ($1, 'silver', $2, $3, 'convert')`,
        [eid, -silver_amount, wallet.balance]
      );
      const { rows: [runeWallet] } = await client.query(
        'SELECT balance FROM gamification_wallets WHERE employee_id = $1 AND currency = $2', [eid, 'runes']
      );
      await client.query(
        `INSERT INTO gamification_currency_ledger (employee_id, currency, amount, balance_after, operation)
         VALUES ($1, 'runes', $2, $3, 'convert')`,
        [eid, runesGained, runeWallet.balance]
      );

      await client.query('COMMIT');
      return { ok: true, silver_spent: silver_amount, runes_gained: runesGained };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // ── GET /wallet/history — last 50 transactions ──
  fastify.get('/wallet/history', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const eid = req.fieldEmployee.id;
    const { rows } = await db.query(
      `SELECT currency, amount, balance_after, operation, note, created_at
       FROM gamification_currency_ledger WHERE employee_id = $1
       ORDER BY created_at DESC LIMIT 50`, [eid]
    );
    return { transactions: rows };
  });

  // ── POST /spin — spin the Wheel of Norns ──
  fastify.post('/spin', { preHandler: [fastify.fieldAuthenticate] }, async (req, reply) => {
    const eid = req.fieldEmployee.id;

    // Check daily spin (reset at 06:00 MSK)
    const { rows: [lastSpin] } = await db.query(
      `SELECT spin_at FROM gamification_spins WHERE employee_id = $1
       ORDER BY spin_at DESC LIMIT 1`, [eid]
    );

    if (lastSpin) {
      const now = new Date();
      const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
      const resetToday = new Date(msk); resetToday.setHours(6, 0, 0, 0);
      if (msk < resetToday) resetToday.setDate(resetToday.getDate() - 1);

      const lastSpinMsk = new Date(lastSpin.spin_at.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
      if (lastSpinMsk >= resetToday) {
        return reply.code(429).send({ error: 'Спин уже использован сегодня', next_spin: resetToday.toISOString() });
      }
    }

    // Load prizes and determine winner using crypto RNG
    const { rows: prizes } = await db.query(
      'SELECT * FROM gamification_prizes WHERE is_active = true'
    );
    if (!prizes.length) return reply.code(500).send({ error: 'Нет доступных призов' });

    // Pity system check
    const { rows: [pity] } = await db.query(
      `INSERT INTO gamification_pity_counters (employee_id) VALUES ($1)
       ON CONFLICT (employee_id) DO UPDATE SET updated_at = NOW()
       RETURNING spins_since_rare, pending_multiplier`, [eid]
    );
    const spinsSinceRare = pity?.spins_since_rare || 0;
    const pendingMultiplier = pity?.pending_multiplier || 1;

    // Select prize via weighted random (crypto.randomBytes)
    let selectedPrize;
    const pityGuarantee = 50; // from settings

    if (spinsSinceRare >= pityGuarantee) {
      // Guaranteed rare+
      const rarePrizes = prizes.filter((p) => p.tier !== 'common');
      selectedPrize = weightedRandom(rarePrizes);
    } else {
      selectedPrize = weightedRandom(prizes);
    }

    // Record spin
    await db.query(
      `INSERT INTO gamification_spins (employee_id, prize_id, prize_tier, prize_name, prize_value, multiplier_applied)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [eid, selectedPrize.id, selectedPrize.tier, selectedPrize.name, selectedPrize.value, pendingMultiplier]
    );

    // Update pity counter
    const isRare = selectedPrize.tier !== 'common';
    await db.query(
      `UPDATE gamification_pity_counters SET
         spins_since_rare = $2,
         last_rare_at = $3,
         pending_multiplier = $4,
         updated_at = NOW()
       WHERE employee_id = $1`,
      [eid, isRare ? 0 : spinsSinceRare + 1, isRare ? new Date() : pity?.last_rare_at || null,
       selectedPrize.prize_type === 'multiplier' ? selectedPrize.value : 1]
    );

    // Credit prize rewards
    const rewardAmount = (selectedPrize.value || 0) * pendingMultiplier;
    if (selectedPrize.prize_type === 'runes' && rewardAmount > 0) {
      await creditWallet(db, eid, 'runes', rewardAmount, 'spin_win', selectedPrize.id);
    } else if (selectedPrize.prize_type === 'xp' && rewardAmount > 0) {
      await creditWallet(db, eid, 'xp', rewardAmount, 'spin_win', selectedPrize.id);
    } else if (selectedPrize.prize_type === 'merch' || selectedPrize.requires_delivery) {
      // Add to inventory + create fulfillment
      const { rows: [inv] } = await db.query(
        `INSERT INTO gamification_inventory (employee_id, item_type, item_name, source_id, source_type)
         VALUES ($1, 'spin_prize', $2, $3, 'spin') RETURNING id`,
        [eid, selectedPrize.name, selectedPrize.id]
      );
      await db.query(
        `INSERT INTO gamification_fulfillment (inventory_id, employee_id, item_name, status)
         VALUES ($1, $2, $3, 'pending')`,
        [inv.id, eid, selectedPrize.name]
      );
    }

    return {
      prize: {
        id: selectedPrize.id,
        tier: selectedPrize.tier,
        type: selectedPrize.prize_type,
        name: selectedPrize.name,
        description: selectedPrize.description,
        value: rewardAmount,
        icon: selectedPrize.icon,
      },
      multiplier_applied: pendingMultiplier,
      pity_counter: isRare ? 0 : spinsSinceRare + 1,
    };
  });

  // ── GET /prizes — prize catalog ──
  fastify.get('/prizes', { preHandler: [fastify.fieldAuthenticate] }, async () => {
    const { rows } = await db.query(
      'SELECT id, tier, prize_type, name, description, icon, weight FROM gamification_prizes WHERE is_active = true ORDER BY tier, weight DESC'
    );
    return { prizes: rows };
  });

  // ── GET /shop — shop items ──
  fastify.get('/shop', { preHandler: [fastify.fieldAuthenticate] }, async () => {
    const { rows } = await db.query(
      'SELECT id, name, description, price_runes, category, icon, image_url, requires_delivery FROM gamification_shop_items WHERE is_active = true ORDER BY category, price_runes'
    );
    return { items: rows };
  });

  // ── POST /shop/buy — purchase item ──
  fastify.post('/shop/buy', {
    preHandler: [fastify.fieldAuthenticate],
    schema: { body: { type: 'object', required: ['item_id'], properties: { item_id: { type: 'integer' } } } }
  }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const { item_id } = req.body;

    const { rows: [item] } = await db.query(
      'SELECT * FROM gamification_shop_items WHERE id = $1 AND is_active = true', [item_id]
    );
    if (!item) return reply.code(404).send({ error: 'Товар не найден' });

    // Debit runes
    const { rows: [wallet] } = await db.query(
      `UPDATE gamification_wallets SET balance = balance - $1, updated_at = NOW()
       WHERE employee_id = $2 AND currency = 'runes' AND balance >= $1 RETURNING balance`,
      [item.price_runes, eid]
    );
    if (!wallet) return reply.code(400).send({ error: 'Недостаточно рун' });

    // Ledger
    await db.query(
      `INSERT INTO gamification_currency_ledger (employee_id, currency, amount, balance_after, operation, reference_id, reference_type)
       VALUES ($1, 'runes', $2, $3, 'shop_buy', $4, 'shop')`,
      [eid, -item.price_runes, wallet.balance, item.id]
    );

    // Add to inventory
    const { rows: [inv] } = await db.query(
      `INSERT INTO gamification_inventory (employee_id, item_type, item_name, item_description, source_id, source_type)
       VALUES ($1, 'shop_purchase', $2, $3, $4, 'shop') RETURNING id`,
      [eid, item.name, item.description, item.id]
    );

    // Fulfillment if physical
    if (item.requires_delivery) {
      await db.query(
        `INSERT INTO gamification_fulfillment (inventory_id, employee_id, item_name, status)
         VALUES ($1, $2, $3, 'pending')`,
        [inv.id, eid, item.name]
      );
    }

    return { ok: true, item: item.name, runes_spent: item.price_runes, balance: wallet.balance };
  });

  // ── GET /inventory ──
  fastify.get('/inventory', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const { rows } = await db.query(
      `SELECT gi.*, gf.status as delivery_status, gf.delivery_note
       FROM gamification_inventory gi
       LEFT JOIN gamification_fulfillment gf ON gf.inventory_id = gi.id
       WHERE gi.employee_id = $1 ORDER BY gi.acquired_at DESC`,
      [req.fieldEmployee.id]
    );
    return { inventory: rows };
  });

  // ── GET /quests ──
  fastify.get('/quests', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const eid = req.fieldEmployee.id;
    const { rows } = await db.query(`
      SELECT q.*, COALESCE(qp.current_count, 0) as progress, COALESCE(qp.completed, false) as completed,
             qp.reward_claimed
      FROM gamification_quests q
      LEFT JOIN gamification_quest_progress qp ON qp.quest_id = q.id AND qp.employee_id = $1
      WHERE q.is_active = true
      ORDER BY q.quest_type, q.id
    `, [eid]);
    return { quests: rows };
  });
}

// ── Helpers ──

function weightedRandom(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const bytes = crypto.randomBytes(4);
  const rand = bytes.readUInt32BE(0) / 0xFFFFFFFF;
  let cumulative = 0;

  for (const item of items) {
    cumulative += item.weight / totalWeight;
    if (rand <= cumulative) return item;
  }
  return items[items.length - 1];
}

async function creditWallet(db, employeeId, currency, amount, operation, referenceId) {
  await db.query(
    `INSERT INTO gamification_wallets (employee_id, currency, balance)
     VALUES ($1, $2, $3)
     ON CONFLICT (employee_id, currency) DO UPDATE SET
       balance = gamification_wallets.balance + $3, updated_at = NOW()`,
    [employeeId, currency, amount]
  );
  const { rows: [w] } = await db.query(
    'SELECT balance FROM gamification_wallets WHERE employee_id = $1 AND currency = $2',
    [employeeId, currency]
  );
  await db.query(
    `INSERT INTO gamification_currency_ledger (employee_id, currency, amount, balance_after, operation, reference_id, reference_type)
     VALUES ($1, $2, $3, $4, $5, $6, 'spin')`,
    [employeeId, currency, amount, w.balance, operation, referenceId]
  );
}

module.exports = routes;
