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
const notificationDispatcher = require('../services/notificationDispatcher'); // D-1: activate dead code

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

    const client = await db.pool.connect();
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

  // ── POST /spin — spin the Wheel of Norns (TRANSACTIONAL) ──
  fastify.post('/spin', { preHandler: [fastify.fieldAuthenticate] }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');

      // R1 fix: Lock pity_counters row FIRST — guarantees only one spin can proceed
      // This works even for first spin because UPSERT creates the row atomically
      const { rows: [pity] } = await client.query(
        `INSERT INTO gamification_pity_counters (employee_id) VALUES ($1)
         ON CONFLICT (employee_id) DO UPDATE SET updated_at = NOW()
         RETURNING *`, [eid]
      );
      // Now lock the row explicitly for the duration of this transaction
      await client.query(
        'SELECT * FROM gamification_pity_counters WHERE employee_id = $1 FOR UPDATE', [eid]
      );

      // Daily spin logic: 1 free + 1 bonus for checkin today
      const now = new Date();
      const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
      const resetToday = new Date(msk); resetToday.setHours(6, 0, 0, 0);
      if (msk < resetToday) resetToday.setDate(resetToday.getDate() - 1);

      // Count spins today
      const { rows: [{ cnt: todaySpins }] } = await client.query(
        `SELECT COUNT(*)::int as cnt FROM gamification_spins
         WHERE employee_id = $1 AND spin_at >= $2`,
        [eid, resetToday]
      );

      // Check if worker has checkin today (bonus spin)
      const { rows: [checkinToday] } = await client.query(
        `SELECT id FROM field_checkins
         WHERE employee_id = $1 AND date >= CURRENT_DATE AND status IN ('active','completed')
         LIMIT 1`,
        [eid]
      );
      const maxFreeSpins = checkinToday ? 2 : 1; // 1 free + 1 bonus for checkin

      if (todaySpins >= maxFreeSpins) {
        // Check for purchased extra spins in inventory (unused)
        const { rows: [purchasedSpin] } = await client.query(
          `SELECT id FROM gamification_inventory
           WHERE employee_id = $1 AND item_name ILIKE '%спин%' AND is_used = false
           ORDER BY acquired_at ASC LIMIT 1`,
          [eid]
        );

        if (purchasedSpin) {
          // Consume the purchased spin
          await client.query(
            'UPDATE gamification_inventory SET is_used = true WHERE id = $1',
            [purchasedSpin.id]
          );
        } else {
          await client.query('ROLLBACK');
          const msg = checkinToday
            ? 'Оба спина использованы. Купи доп. спин в магазине или приходи завтра!'
            : 'Бесплатный спин использован. Отметься на объекте для бонусного!';
          return reply.code(429).send({ error: msg });
        }
      }

      // Load prizes
      const { rows: prizes } = await client.query(
        'SELECT * FROM gamification_prizes WHERE is_active = true AND weight > 0'
      );
      if (!prizes.length) { await client.query('ROLLBACK'); return reply.code(500).send({ error: 'Нет доступных призов' }); }

      // Pity values (row already locked above via pity variable)
      const spinsSinceRare = pity?.spins_since_rare || 0;
      const pendingMultiplier = Math.max(1, pity?.pending_multiplier || 1);
      const pityGuarantee = 50;

      // Select prize
      let selectedPrize;
      if (spinsSinceRare >= pityGuarantee) {
        const rarePrizes = prizes.filter((p) => p.tier !== 'common');
        selectedPrize = weightedRandom(rarePrizes.length ? rarePrizes : prizes);
      } else {
        selectedPrize = weightedRandom(prizes);
      }

      // Record spin
      await client.query(
        `INSERT INTO gamification_spins (employee_id, prize_id, prize_tier, prize_name, prize_value, multiplier_applied)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [eid, selectedPrize.id, selectedPrize.tier, selectedPrize.name, selectedPrize.value, pendingMultiplier]
      );

      // Update pity counter
      const isRare = selectedPrize.tier !== 'common';
      await client.query(
        `UPDATE gamification_pity_counters SET
           spins_since_rare = $2, last_rare_at = $3, pending_multiplier = $4, updated_at = NOW()
         WHERE employee_id = $1`,
        [eid, isRare ? 0 : spinsSinceRare + 1, isRare ? new Date() : pity?.last_rare_at || null,
         selectedPrize.prize_type === 'multiplier' ? Math.max(1, selectedPrize.value) : 1]
      );

      // Credit prize rewards
      const rewardAmount = Math.max(0, (selectedPrize.value || 0) * pendingMultiplier);
      if (selectedPrize.prize_type === 'runes' && rewardAmount > 0) {
        await creditWalletTx(client, eid, 'runes', rewardAmount, 'spin_win', selectedPrize.id);
      } else if (selectedPrize.prize_type === 'xp' && rewardAmount > 0) {
        await creditWalletTx(client, eid, 'xp', rewardAmount, 'spin_win', selectedPrize.id);
      } else if (selectedPrize.prize_type === 'merch' || selectedPrize.requires_delivery) {
        const { rows: [inv] } = await client.query(
          `INSERT INTO gamification_inventory (employee_id, item_type, item_name, source_id, source_type)
           VALUES ($1, 'spin_prize', $2, $3, 'spin') RETURNING id`,
          [eid, selectedPrize.name, selectedPrize.id]
        );
        await client.query(
          `INSERT INTO gamification_fulfillment (inventory_id, employee_id, item_name, status)
           VALUES ($1, $2, $3, 'pending')`,
          [inv.id, eid, selectedPrize.name]
        );
      }

      await client.query('COMMIT');

      // D-1: Send push notification for epic/legendary wins (fire-and-forget)
      if (selectedPrize.tier === 'legendary' || selectedPrize.tier === 'epic') {
        const userId = req.fieldEmployee.user_id;
        if (userId) {
          const template = selectedPrize.tier === 'legendary' ? 'LEGENDARY_WIN' : 'ACHIEVEMENT_EARNED';
          notificationDispatcher.send(db, userId, template, {
            prize: selectedPrize.name, message: `Вы выиграли: ${selectedPrize.name}!`
          }).catch(() => {}); // fire-and-forget
        }
      }

      return {
        prize: { id: selectedPrize.id, tier: selectedPrize.tier, type: selectedPrize.prize_type,
          name: selectedPrize.name, description: selectedPrize.description, value: rewardAmount, icon: selectedPrize.icon },
        multiplier_applied: pendingMultiplier,
        pity_counter: isRare ? 0 : spinsSinceRare + 1,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
      'SELECT id, name, description, price_runes, category, icon, image_url, requires_delivery, current_stock, max_stock, rarity, is_limited FROM gamification_shop_items WHERE is_active = true ORDER BY category, price_runes'
    );
    return { items: rows };
  });

  // ── POST /shop/buy — purchase item ──
  // ── POST /shop/buy — purchase item (TRANSACTIONAL) ──
  fastify.post('/shop/buy', {
    preHandler: [fastify.fieldAuthenticate],
    schema: { body: { type: 'object', required: ['item_id'], properties: { item_id: { type: 'integer' } } } }
  }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const { item_id } = req.body;
    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');

      // Lock and check item + stock
      const { rows: [item] } = await client.query(
        'SELECT * FROM gamification_shop_items WHERE id = $1 AND is_active = true FOR UPDATE', [item_id]
      );
      if (!item) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Товар не найден' }); }
      if (item.max_stock !== null && item.current_stock <= 0) {
        await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Товар закончился' });
      }

      // Debit runes (atomic check)
      const { rows: [wallet] } = await client.query(
        `UPDATE gamification_wallets SET balance = balance - $1, updated_at = NOW()
         WHERE employee_id = $2 AND currency = 'runes' AND balance >= $1 RETURNING balance`,
        [item.price_runes, eid]
      );
      if (!wallet) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Недостаточно рун' }); }

      // Decrement stock
      if (item.max_stock !== null) {
        await client.query(
          'UPDATE gamification_shop_items SET current_stock = current_stock - 1 WHERE id = $1', [item_id]
        );
      }

      // Ledger
      await client.query(
        `INSERT INTO gamification_currency_ledger (employee_id, currency, amount, balance_after, operation, reference_id, reference_type)
         VALUES ($1, 'runes', $2, $3, 'shop_buy', $4, 'shop')`,
        [eid, -item.price_runes, wallet.balance, item.id]
      );

      // Inventory
      const { rows: [inv] } = await client.query(
        `INSERT INTO gamification_inventory (employee_id, item_type, item_name, item_description, source_id, source_type)
         VALUES ($1, 'shop_purchase', $2, $3, $4, 'shop') RETURNING id`,
        [eid, item.name, item.description, item.id]
      );

      // Fulfillment if physical
      if (item.requires_delivery) {
        await client.query(
          `INSERT INTO gamification_fulfillment (inventory_id, employee_id, item_name, status)
           VALUES ($1, $2, $3, 'pending')`,
          [inv.id, eid, item.name]
        );
      }

      await client.query('COMMIT');
      return { ok: true, item: item.name, runes_spent: item.price_runes, balance: wallet.balance };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // ── GET /inventory ──
  fastify.get('/inventory', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const { rows } = await db.query(
      `SELECT gi.*, gf.status as delivery_status, gf.delivery_note, gf.delivered_at,
              u.name as pm_name, e2.phone as pm_phone, w.object_name as work_name
       FROM gamification_inventory gi
       LEFT JOIN gamification_fulfillment gf ON gf.inventory_id = gi.id
       LEFT JOIN users u ON u.id = gf.assigned_pm
       LEFT JOIN employee_assignments ea ON ea.employee_id = gi.employee_id
       LEFT JOIN works w ON w.id = ea.work_id
       LEFT JOIN employees e2 ON e2.id = gi.employee_id
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

  // ── POST /quests/:id/claim — claim quest reward ──
  fastify.post('/quests/:id/claim', { preHandler: [fastify.fieldAuthenticate] }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const questId = parseInt(req.params.id, 10);

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Check quest progress
      const { rows: [progress] } = await client.query(
        `SELECT qp.*, q.reward_type, q.reward_amount, q.name
         FROM gamification_quest_progress qp
         JOIN gamification_quests q ON q.id = qp.quest_id
         WHERE qp.quest_id = $1 AND qp.employee_id = $2 AND qp.completed = true AND qp.reward_claimed = false
         FOR UPDATE OF qp`,
        [questId, eid]
      );
      if (!progress) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Квест не завершён или награда уже получена' });
      }

      // Mark as claimed
      await client.query(
        'UPDATE gamification_quest_progress SET reward_claimed = true WHERE quest_id = $1 AND employee_id = $2',
        [questId, eid]
      );

      // Credit reward (D9: handles both 'runes' and 'xp')
      const rewardCurrency = progress.reward_type === 'xp' ? 'xp' : 'runes';
      if (['runes', 'xp'].includes(progress.reward_type) && progress.reward_amount > 0) {
        await client.query(
          `INSERT INTO gamification_wallets (employee_id, currency, balance)
           VALUES ($1, $2, $3)
           ON CONFLICT (employee_id, currency) DO UPDATE SET balance = gamification_wallets.balance + $3, updated_at = NOW()`,
          [eid, rewardCurrency, progress.reward_amount]
        );
        const { rows: [w] } = await client.query(
          'SELECT balance FROM gamification_wallets WHERE employee_id = $1 AND currency = $2', [eid, rewardCurrency]
        );
        await client.query(
          `INSERT INTO gamification_currency_ledger (employee_id, currency, amount, balance_after, operation, reference_id, reference_type)
           VALUES ($1, $2, $3, $4, 'quest_claim', $5, 'quest')`,
          [eid, rewardCurrency, progress.reward_amount, w.balance, questId]
        );
      }

      // Audit log
      await client.query(
        `INSERT INTO gamification_audit_log (employee_id, action, details) VALUES ($1, 'quest_claimed', $2)`,
        [eid, JSON.stringify({ quest_id: questId, quest_name: progress.name, reward_type: progress.reward_type, reward_amount: progress.reward_amount })]
      );

      await client.query('COMMIT');
      return { ok: true, quest_id: questId, reward_type: progress.reward_type, reward_amount: progress.reward_amount };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
}

// ── Helpers ──

function weightedRandom(items) {
  const totalWeight = items.reduce((sum, item) => sum + (item.weight || 0), 0);
  if (totalWeight <= 0) return items[Math.floor(Math.random() * items.length)]; // fallback
  const bytes = crypto.randomBytes(4);
  const rand = bytes.readUInt32BE(0) / 0xFFFFFFFF;
  let cumulative = 0;

  for (const item of items) {
    cumulative += (item.weight || 0) / totalWeight;
    if (rand <= cumulative) return item;
  }
  return items[items.length - 1];
}

// Transaction-aware version (uses client from transaction)
async function creditWalletTx(client, employeeId, currency, amount, operation, referenceId) {
  await client.query(
    `INSERT INTO gamification_wallets (employee_id, currency, balance)
     VALUES ($1, $2, $3)
     ON CONFLICT (employee_id, currency) DO UPDATE SET balance = gamification_wallets.balance + $3, updated_at = NOW()`,
    [employeeId, currency, amount]
  );
  const { rows: [w] } = await client.query(
    'SELECT balance FROM gamification_wallets WHERE employee_id = $1 AND currency = $2', [employeeId, currency]
  );
  await client.query(
    `INSERT INTO gamification_currency_ledger (employee_id, currency, amount, balance_after, operation, reference_id, reference_type)
     VALUES ($1, $2, $3, $4, $5, $6, 'spin')`,
    [employeeId, currency, amount, w.balance, operation, referenceId]
  );
}

// R5: removed dead non-transactional creditWallet() — use creditWalletTx() instead

module.exports = routes;
