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
 * GET  /leaderboard     — top 50 workers by runes + XP with current player rank
 */

const crypto = require('crypto');
const notificationDispatcher = require('../services/notificationDispatcher'); // D-1: activate dead code

async function routes(fastify) {
  const db = fastify.db;

  // ── GET /wallet — balances + level ──
  fastify.get('/wallet', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const eid = req.fieldEmployee.id;

    // Auto-create missing wallets on first access
    await db.query(`
      INSERT INTO gamification_wallets (employee_id, currency, balance)
      VALUES ($1,'silver',0),($1,'runes',0),($1,'xp',0)
      ON CONFLICT (employee_id, currency) DO NOTHING
    `, [eid]);

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

  // ── GET /spin-status — how many spins available ──
  fastify.get('/spin-status', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const eid = req.fieldEmployee.id;
    const now = new Date();
    const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    const resetToday = new Date(msk); resetToday.setHours(0, 0, 0, 0);

    const { rows: [{ cnt: todaySpins }] } = await db.query(
      `SELECT COUNT(*)::int as cnt FROM gamification_spins
       WHERE employee_id = $1 AND spin_at >= $2`, [eid, resetToday]
    );

    const freeTotal = 1;
    const freeUsed = Math.min(todaySpins, freeTotal);
    const freeLeft = freeTotal - freeUsed;

    const { rows: [checkinRecent] } = await db.query(
      `SELECT checkin_at FROM field_checkins
       WHERE employee_id = $1 AND status IN ('active','completed')
         AND checkin_at >= NOW() - INTERVAL '24 hours'
       ORDER BY checkin_at DESC LIMIT 1`, [eid]
    );
    const checkinTotal = checkinRecent ? 3 : 0;
    const checkinUsed = Math.max(0, Math.min(todaySpins - freeTotal, checkinTotal));
    const checkinLeft = checkinTotal - checkinUsed;
    const checkinExpiresAt = checkinRecent
      ? new Date(new Date(checkinRecent.checkin_at).getTime() + 24 * 60 * 60 * 1000).toISOString()
      : null;

    const { rows: [{ cnt: purchasedLeft }] } = await db.query(
      `SELECT COUNT(*)::int as cnt FROM gamification_inventory
       WHERE employee_id = $1 AND item_name ILIKE '%спин%' AND is_used = false`, [eid]
    );

    const total = freeLeft + checkinLeft + purchasedLeft;
    return { free: freeLeft, checkin: checkinLeft, purchased: purchasedLeft, total, checkin_expires_at: checkinExpiresAt };
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

      // ── Spin allowance: 1 free/day (00:00 MSK) + 3 for checkin (24h expiry) + purchased ──
      const now = new Date();
      const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
      const resetToday = new Date(msk); resetToday.setHours(0, 0, 0, 0); // midnight MSK

      // Count spins since midnight MSK
      const { rows: [{ cnt: todaySpins }] } = await client.query(
        `SELECT COUNT(*)::int as cnt FROM gamification_spins
         WHERE employee_id = $1 AND spin_at >= $2`,
        [eid, resetToday]
      );

      // 1 free spin per day
      const freeSpins = 1;

      // 3 bonus spins for any checkin in last 24 hours (by worker or master)
      const { rows: [checkinRecent] } = await client.query(
        `SELECT checkin_at FROM field_checkins
         WHERE employee_id = $1 AND status IN ('active','completed')
           AND checkin_at >= NOW() - INTERVAL '24 hours'
         ORDER BY checkin_at DESC LIMIT 1`,
        [eid]
      );
      const checkinSpins = checkinRecent ? 3 : 0;

      // Purchased spins (unused, from shop)
      const { rows: purchasedSpins } = await client.query(
        `SELECT id FROM gamification_inventory
         WHERE employee_id = $1 AND item_name ILIKE '%спин%' AND is_used = false
         ORDER BY acquired_at ASC`,
        [eid]
      );

      const maxAllowed = freeSpins + checkinSpins + purchasedSpins.length;

      if (todaySpins >= maxAllowed) {
        await client.query('ROLLBACK');
        return reply.code(429).send({
          error: checkinRecent
            ? 'Все спины использованы. Купи доп. спин в магазине или приходи завтра!'
            : 'Бесплатный спин использован. Отметься на объекте — получишь ещё 3!',
          spins_remaining: 0,
        });
      }

      // If using a purchased spin (beyond free + checkin), consume it
      if (todaySpins >= freeSpins + checkinSpins && purchasedSpins.length > 0) {
        await client.query(
          'UPDATE gamification_inventory SET is_used = true WHERE id = $1',
          [purchasedSpins[0].id]
        );
      }

      // Load prizes (join shop_items for icon_svg when prize_type='shop_item')
      const { rows: prizes } = await client.query(
        `SELECT p.*, s.icon_svg FROM gamification_prizes p
         LEFT JOIN gamification_shop_items s ON s.id = p.value AND p.prize_type = 'shop_item'
         WHERE p.is_active = true AND p.weight > 0`
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
      const rewardAmount = selectedPrize.prize_type === 'shop_item'
        ? 0
        : Math.max(0, (selectedPrize.value || 0) * pendingMultiplier);
      if (selectedPrize.prize_type === 'runes' && rewardAmount > 0) {
        await creditWalletTx(client, eid, 'runes', rewardAmount, 'spin_win', selectedPrize.id);
      } else if (selectedPrize.prize_type === 'xp' && rewardAmount > 0) {
        await creditWalletTx(client, eid, 'xp', rewardAmount, 'spin_win', selectedPrize.id);
      } else if (selectedPrize.prize_type === 'shop_item' || selectedPrize.prize_type === 'merch' || selectedPrize.requires_delivery) {
        // Look up shop item category to set item_category correctly
        let itemCategory = 'merch';
        if (selectedPrize.prize_type === 'shop_item' && selectedPrize.value) {
          const { rows: [si] } = await client.query(
            'SELECT category FROM gamification_shop_items WHERE id = $1', [selectedPrize.value]
          );
          if (si) itemCategory = si.category;
        }
        const { rows: [inv] } = await client.query(
          `INSERT INTO gamification_inventory (employee_id, item_type, item_name, item_category, source_id, source_type)
           VALUES ($1, 'spin_prize', $2, $3, $4, 'spin') RETURNING id`,
          [eid, selectedPrize.name, itemCategory, selectedPrize.value]
        );
        // Only create fulfillment for physical items that need delivery
        const needsDelivery = selectedPrize.requires_delivery || selectedPrize.prize_type === 'merch';
        const isDigitalCosmetic = ['digital', 'cosmetic'].includes(itemCategory);
        if (needsDelivery && !isDigitalCosmetic) {
          await client.query(
            `INSERT INTO gamification_fulfillment (inventory_id, employee_id, item_name, status)
             VALUES ($1, $2, $3, 'pending')`,
            [inv.id, eid, selectedPrize.name]
          );
        }
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
          name: selectedPrize.name, description: selectedPrize.description, value: rewardAmount,
          icon: selectedPrize.icon, icon_svg: selectedPrize.icon_svg || null },
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
      `SELECT p.id, p.tier, p.prize_type, p.name, p.description, p.icon, p.weight, p.value, s.icon_svg
       FROM gamification_prizes p
       LEFT JOIN gamification_shop_items s ON s.id = p.value AND p.prize_type = 'shop_item'
       WHERE p.is_active = true ORDER BY p.tier, p.weight DESC`
    );
    return { prizes: rows };
  });

  // ── GET /shop — shop items ──
  fastify.get('/shop', { preHandler: [fastify.fieldAuthenticate] }, async () => {
    const { rows } = await db.query(
      'SELECT id, name, description, price_runes, category, icon, icon_svg, image_url, requires_delivery, current_stock, max_stock, rarity, is_limited FROM gamification_shop_items WHERE is_active = true ORDER BY category, price_runes'
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

    // Calculate period boundaries (MSK)
    const now = new Date();
    const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    const todayMsk = new Date(msk); todayMsk.setHours(0, 0, 0, 0);
    const weekStartMsk = new Date(msk);
    weekStartMsk.setHours(0, 0, 0, 0);
    const dow = weekStartMsk.getDay();
    weekStartMsk.setDate(weekStartMsk.getDate() - (dow === 0 ? 6 : dow - 1));

    // Get wallet for level
    const { rows: walletRows } = await db.query(
      `SELECT currency, balance FROM gamification_wallets WHERE employee_id = $1`, [eid]
    );
    const xpBalance = walletRows.find((r) => r.currency === 'xp')?.balance || 0;
    const currentLevel = Math.floor(xpBalance / 100) + 1;

    const { rows } = await db.query(`
      SELECT
        q.*,
        -- Progress: reset if period rolled over, otherwise use stored
        CASE
          WHEN q.quest_type = 'daily'    AND (qp.period_start IS NULL OR qp.period_start < $2) THEN 0
          WHEN q.quest_type = 'weekly'   AND (qp.period_start IS NULL OR qp.period_start < $3) THEN 0
          ELSE COALESCE(qp.current_count, 0)
        END AS progress,
        -- Completed: reset if period rolled over
        CASE
          WHEN q.quest_type = 'daily'    AND (qp.period_start IS NULL OR qp.period_start < $2) THEN false
          WHEN q.quest_type = 'weekly'   AND (qp.period_start IS NULL OR qp.period_start < $3) THEN false
          ELSE COALESCE(qp.completed, false)
        END AS completed,
        -- reward_claimed: reset if period rolled over
        CASE
          WHEN q.quest_type = 'daily'    AND (qp.period_start IS NULL OR qp.period_start < $2) THEN false
          WHEN q.quest_type = 'weekly'   AND (qp.period_start IS NULL OR qp.period_start < $3) THEN false
          ELSE COALESCE(qp.reward_claimed, false)
        END AS reward_claimed
      FROM gamification_quests q
      LEFT JOIN gamification_quest_progress qp ON qp.quest_id = q.id AND qp.employee_id = $1
      WHERE q.is_active = true
      ORDER BY q.quest_type, q.id
    `, [eid, todayMsk.toISOString(), weekStartMsk.toISOString()]);

    return { quests: rows, current_level: currentLevel };
  });

  // ── GET /leaderboard — top 50 workers ranked by runes + XP, current player highlighted ──
  fastify.get('/leaderboard', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const eid = req.fieldEmployee.id;

    const { rows } = await db.query(`
      WITH wallets AS (
        SELECT
          employee_id,
          MAX(CASE WHEN currency = 'runes' THEN balance ELSE 0 END) AS runes,
          MAX(CASE WHEN currency = 'xp'    THEN balance ELSE 0 END) AS xp
        FROM gamification_wallets
        GROUP BY employee_id
      ),
      ranked AS (
        SELECT
          w.employee_id,
          e.fio,
          w.runes,
          w.xp,
          -- Combined score: runes + xp*2 for ranking
          (w.runes + w.xp * 2) AS score,
          -- Level: floor(xp/100)+1, min 1
          GREATEST(1, FLOOR(w.xp / 100) + 1)::int AS level,
          -- Rank by combined score
          ROW_NUMBER() OVER (ORDER BY (w.runes + w.xp * 2) DESC, w.runes DESC) AS rank,
          -- Total shifts
          (SELECT COUNT(*) FROM field_checkins fc WHERE fc.employee_id = w.employee_id AND fc.status = 'completed') AS total_shifts
        FROM wallets w
        JOIN employees e ON e.id = w.employee_id
        WHERE (w.runes > 0 OR w.xp > 0)
      )
      SELECT * FROM ranked
      WHERE rank <= 50
      ORDER BY rank
    `);

    // Find current player rank (may be outside top-50)
    let myEntry = rows.find((r) => r.employee_id === eid);
    if (!myEntry) {
      const { rows: [me] } = await db.query(`
        WITH wallets AS (
          SELECT employee_id,
            MAX(CASE WHEN currency = 'runes' THEN balance ELSE 0 END) AS runes,
            MAX(CASE WHEN currency = 'xp'    THEN balance ELSE 0 END) AS xp
          FROM gamification_wallets GROUP BY employee_id
        ),
        ranked AS (
          SELECT w.employee_id, e.fio, w.runes, w.xp,
            (w.runes + w.xp * 2) AS score,
            GREATEST(1, FLOOR(w.xp / 100) + 1)::int AS level,
            ROW_NUMBER() OVER (ORDER BY (w.runes + w.xp * 2) DESC, w.runes DESC) AS rank,
            (SELECT COUNT(*) FROM field_checkins fc WHERE fc.employee_id = w.employee_id AND fc.status = 'completed') AS total_shifts
          FROM wallets w JOIN employees e ON e.id = w.employee_id
        )
        SELECT * FROM ranked WHERE employee_id = $1
      `, [eid]);
      myEntry = me || null;
    }

    // Norse rank titles by level
    const RANK_TITLES = [
      { min: 1,  title: 'Трэль',     icon: '⚒️' },
      { min: 3,  title: 'Карл',      icon: '🛡️' },
      { min: 5,  title: 'Хускарл',   icon: '⚔️' },
      { min: 8,  title: 'Дружинник', icon: '🗡️' },
      { min: 12, title: 'Витязь',    icon: '🏹' },
      { min: 16, title: 'Ярл',       icon: '👑' },
      { min: 20, title: 'Конунг',    icon: '⚡' },
    ];
    function getRankTitle(level) {
      const lvl = parseInt(level, 10) || 1;
      let result = RANK_TITLES[0];
      for (const t of RANK_TITLES) { if (lvl >= t.min) result = t; }
      return result;
    }

    const enriched = rows.map((r) => ({ ...r, rank_title: getRankTitle(r.level) }));
    const myEntryEnriched = myEntry ? { ...myEntry, rank_title: getRankTitle(myEntry.level) } : null;

    return { leaderboard: enriched, my_rank: myEntryEnriched };
  });

  // ── POST /inventory/:id/equip — equip digital/cosmetic item ──
  fastify.post('/inventory/:id/equip', { preHandler: [fastify.fieldAuthenticate] }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const invId = parseInt(req.params.id, 10);

    // Get inventory item with shop category
    const { rows: [inv] } = await db.query(
      `SELECT gi.*, gsi.category, gsi.name as shop_name
       FROM gamification_inventory gi
       LEFT JOIN gamification_shop_items gsi ON gsi.id = gi.source_id AND gi.item_type = 'shop_purchase'
       WHERE gi.id = $1 AND gi.employee_id = $2`,
      [invId, eid]
    );
    if (!inv) return reply.code(404).send({ error: 'Предмет не найден' });

    const category = inv.item_category || inv.category || 'merch';
    if (!['digital', 'cosmetic'].includes(category)) {
      return reply.code(400).send({ error: 'Этот предмет нельзя надеть' });
    }

    // Determine equipment slot from item name
    const name = (inv.item_name || '').toLowerCase();
    let slot = 'active_badge';
    if      (name.includes('аватар'))                                   slot = 'active_avatar';
    else if (name.includes('рамк'))                                     slot = 'active_frame';
    else if (name.includes('тема') || /^тем[^а]/.test(name) || name === 'тема') slot = 'active_theme';
    else if (name.includes('шлем') || name.includes('маска'))           slot = 'active_helmet';
    else if (name.includes('оружие') || name.includes('топор') ||
             name.includes('молот') || name.includes('копьё') ||
             name.includes('копье') || name.includes('меч'))            slot = 'active_weapon';
    else if (name.includes('броня') || name.includes('кольчуг') ||
             name.includes('нагрудник') || name.includes('плащ'))       slot = 'active_armor';
    else if (name.includes('бейдж') || name.includes('кубок'))         slot = 'active_badge';

    // Validate slot exists as column
    const VALID_SLOTS = ['active_avatar','active_frame','active_theme','active_badge','active_helmet','active_weapon','active_armor'];
    if (!VALID_SLOTS.includes(slot)) slot = 'active_badge';

    // Unequip previous item in same slot for this employee
    await db.query(
      `UPDATE gamification_inventory SET is_equipped = false
       WHERE employee_id = $1 AND is_equipped = true
         AND id IN (
           SELECT id FROM gamification_inventory
           WHERE employee_id = $1
             AND CASE
               WHEN item_name ILIKE '%аватар%'                                                         THEN 'active_avatar'
               WHEN item_name ILIKE '%рамк%'                                                           THEN 'active_frame'
               WHEN item_name ILIKE '%шлем%' OR item_name ILIKE '%маска%'                             THEN 'active_helmet'
               WHEN item_name ILIKE '%оружие%' OR item_name ILIKE '%топор%' OR
                    item_name ILIKE '%молот%'  OR item_name ILIKE '%копьё%' OR
                    item_name ILIKE '%меч%'                                                            THEN 'active_weapon'
               WHEN item_name ILIKE '%броня%' OR item_name ILIKE '%кольчуг%' OR
                    item_name ILIKE '%нагрудник%' OR item_name ILIKE '%плащ%'                         THEN 'active_armor'
               WHEN item_name ILIKE '%тема%' OR item_name ILIKE '%тём%'                               THEN 'active_theme'
               ELSE 'active_badge'
             END = $2
         )`,
      [eid, slot]
    );

    // Equip this item
    await db.query(
      'UPDATE gamification_inventory SET is_equipped = true WHERE id = $1',
      [invId]
    );

    // Update employee profile slot
    await db.query(
      `UPDATE employees SET ${slot} = $1 WHERE id = $2`,
      [inv.item_name, eid]
    );

    return { ok: true, slot, item_name: inv.item_name };
  });

  // ── POST /inventory/:id/request — worker requests physical prize delivery ──
  fastify.post('/inventory/:id/request', { preHandler: [fastify.fieldAuthenticate] }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const invId = parseInt(req.params.id, 10);

    const { rows: [inv] } = await db.query(
      'SELECT * FROM gamification_inventory WHERE id = $1 AND employee_id = $2',
      [invId, eid]
    );
    if (!inv) return reply.code(404).send({ error: 'Предмет не найден' });

    // Try to update existing fulfillment row
    const { rows: [ful] } = await db.query(
      `UPDATE gamification_fulfillment
       SET status = 'requested', requested_at = NOW(), updated_at = NOW()
       WHERE inventory_id = $1 AND employee_id = $2 AND status = 'pending'
       RETURNING *`,
      [invId, eid]
    );

    let pmUserId = null;

    if (!ful) {
      // No pending fulfillment — create one
      await db.query(
        `INSERT INTO gamification_fulfillment (inventory_id, employee_id, item_name, status, requested_at)
         VALUES ($1, $2, $3, 'requested', NOW())`,
        [invId, eid, inv.item_name]
      );
      // Get PM for notification
      const { rows: [pmInfo] } = await db.query(
        `SELECT w.pm_id FROM employee_assignments ea JOIN works w ON w.id = ea.work_id
         WHERE ea.employee_id = $1 AND ea.is_active = true LIMIT 1`, [eid]
      );
      pmUserId = pmInfo?.pm_id || null;
    } else {
      // Get PM from subquery on employee_assignments
      const { rows: [pmInfo] } = await db.query(
        `SELECT w.pm_id FROM employee_assignments ea JOIN works w ON w.id = ea.work_id
         WHERE ea.employee_id = $1 AND ea.is_active = true LIMIT 1`, [eid]
      );
      pmUserId = pmInfo?.pm_id || null;
    }

    // Notify PM
    if (pmUserId) {
      const { rows: [emp] } = await db.query('SELECT fio FROM employees WHERE id = $1', [eid]);
      notificationDispatcher.send(db, pmUserId, 'PRIZE_REQUESTED', {
        item: inv.item_name,
        employee: emp?.fio || 'Рабочий',
        message: `${emp?.fio || 'Рабочий'} запросил приз: "${inv.item_name}"`,
      }).catch(() => {});
    }

    return { ok: true, status: 'requested' };
  });

  // ── POST /inventory/:id/confirm — worker confirms receipt of physical prize ──
  fastify.post('/inventory/:id/confirm', { preHandler: [fastify.fieldAuthenticate] }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const invId = parseInt(req.params.id, 10);

    const { rows: [ful] } = await db.query(
      `UPDATE gamification_fulfillment
       SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
       WHERE inventory_id = $1 AND employee_id = $2 AND status = 'delivered'
       RETURNING id`,
      [invId, eid]
    );
    if (!ful) return reply.code(400).send({ error: 'Нельзя подтвердить получение: приз не отмечен как выданный' });

    await db.query(
      'UPDATE gamification_inventory SET is_delivered = true WHERE id = $1',
      [invId]
    );

    return { ok: true, status: 'confirmed' };
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
