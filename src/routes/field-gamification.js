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

  // ── POST /wallet/convert-to-xp — runes → XP (rate: 5 runes = 1 XP) ──
  // Daily cap: 1000 runes per day. Min: 15 runes. Max per request: 1000 runes.
  fastify.post('/wallet/convert-to-xp', {
    preHandler: [fastify.fieldAuthenticate],
    schema: {
      body: {
        type: 'object',
        required: ['runes_amount'],
        properties: { runes_amount: { type: 'integer', minimum: 15, maximum: 1000 } }
      }
    }
  }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const { runes_amount } = req.body;

    const RATE = 5;       // 5 runes → 1 XP
    const DAILY_CAP = 1000; // max runes converted per day

    const xpGained = Math.floor(runes_amount / RATE);
    if (xpGained < 1) {
      return reply.code(400).send({ error: `Минимум ${RATE} рун для получения 1 XP` });
    }
    const runesSpent = xpGained * RATE; // round down to exact multiple

    // Check daily cap
    const nowMsk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    const todayMsk = new Date(nowMsk); todayMsk.setHours(0, 0, 0, 0);

    const { rows: [{ used_today }] } = await db.query(
      `SELECT COALESCE(SUM(ABS(amount)), 0)::int AS used_today
       FROM gamification_currency_ledger
       WHERE employee_id = $1 AND currency = 'runes' AND operation = 'xp_convert'
         AND created_at >= $2`,
      [eid, todayMsk.toISOString()]
    );
    if (parseInt(used_today) + runesSpent > DAILY_CAP) {
      const remaining = Math.max(0, DAILY_CAP - parseInt(used_today));
      return reply.code(400).send({
        error: `Дневной лимит: ${DAILY_CAP} рун. Сегодня осталось: ${remaining} рун`,
        daily_remaining: remaining
      });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Debit runes (atomic check)
      const { rows: [runesWallet] } = await client.query(
        `SELECT balance FROM gamification_wallets WHERE employee_id = $1 AND currency = 'runes' FOR UPDATE`,
        [eid]
      );
      if (!runesWallet || parseFloat(runesWallet.balance) < runesSpent) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: `Недостаточно рун. Нужно: ${runesSpent}, есть: ${Math.floor(runesWallet?.balance || 0)}` });
      }

      const newRunesBalance = parseFloat(runesWallet.balance) - runesSpent;
      await client.query(
        `UPDATE gamification_wallets SET balance = $2, updated_at = NOW()
         WHERE employee_id = $1 AND currency = 'runes'`,
        [eid, newRunesBalance]
      );
      await client.query(
        `INSERT INTO gamification_currency_ledger (employee_id, currency, amount, balance_after, operation, note)
         VALUES ($1, 'runes', $2, $3, 'xp_convert', $4)`,
        [eid, -runesSpent, newRunesBalance, `Переплавка рун в XP: ${runesSpent} ᚱ → ${xpGained} XP`]
      );

      // Credit XP
      await client.query(
        `INSERT INTO gamification_wallets (employee_id, currency, balance)
         VALUES ($1, 'xp', $2)
         ON CONFLICT (employee_id, currency) DO UPDATE
           SET balance = gamification_wallets.balance + $2, updated_at = NOW()`,
        [eid, xpGained]
      );
      const { rows: [xpWallet] } = await client.query(
        `SELECT balance FROM gamification_wallets WHERE employee_id = $1 AND currency = 'xp'`, [eid]
      );
      await client.query(
        `INSERT INTO gamification_currency_ledger (employee_id, currency, amount, balance_after, operation, note)
         VALUES ($1, 'xp', $2, $3, 'xp_convert', $4)`,
        [eid, xpGained, xpWallet.balance, `Переплавка: ${runesSpent} ᚱ → ${xpGained} XP`]
      );

      // Audit
      await client.query(
        `INSERT INTO gamification_audit_log (employee_id, action, details)
         VALUES ($1, 'xp_convert', $2)`,
        [eid, JSON.stringify({ runes_spent: runesSpent, xp_gained: xpGained })]
      );

      await client.query('COMMIT');

      const newLevel = Math.max(1, Math.floor(xpWallet.balance / 100) + 1);
      return {
        ok: true,
        runes_spent: runesSpent,
        xp_gained: xpGained,
        xp_balance: parseInt(xpWallet.balance),
        new_level: newLevel,
        daily_remaining: DAILY_CAP - parseInt(used_today) - runesSpent,
      };
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
      let rewardAmount = selectedPrize.prize_type === 'shop_item'
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
        const isDigitalCosmetic = ['digital', 'cosmetic'].includes(itemCategory);

        // Dedup: digital/cosmetic items can only be owned once — give runes instead
        let duplicate = false;
        if (isDigitalCosmetic) {
          const { rows: [existing] } = await client.query(
            'SELECT id FROM gamification_inventory WHERE employee_id = $1 AND item_name = $2 LIMIT 1',
            [eid, selectedPrize.name]
          );
          if (existing) duplicate = true;
        }

        if (duplicate) {
          const compRunes = 50;
          await creditWalletTx(client, eid, 'runes', compRunes, 'duplicate_prize', selectedPrize.id);
          rewardAmount = compRunes;
          selectedPrize = Object.assign({}, selectedPrize, {
            name: selectedPrize.name + ' → руны ×' + compRunes,
            prize_type: 'runes'
          });
        } else {
          const { rows: [inv] } = await client.query(
            `INSERT INTO gamification_inventory (employee_id, item_type, item_name, item_category, source_id, source_type)
             VALUES ($1, 'spin_prize', $2, $3, $4, 'spin') RETURNING id`,
            [eid, selectedPrize.name, itemCategory, selectedPrize.value]
          );
          // Only create fulfillment for physical items that need delivery
          const needsDelivery = selectedPrize.requires_delivery || selectedPrize.prize_type === 'merch';
          if (needsDelivery && !isDigitalCosmetic) {
            await client.query(
              `INSERT INTO gamification_fulfillment (inventory_id, employee_id, item_name, status)
               VALUES ($1, $2, $3, 'pending')`,
              [inv.id, eid, selectedPrize.name]
            );
          }
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

      // Dedup: block re-purchase of already-owned digital/cosmetic items
      if (['digital', 'cosmetic'].includes(item.category)) {
        const { rows: [existing] } = await client.query(
          'SELECT id FROM gamification_inventory WHERE employee_id = $1 AND item_name = $2 LIMIT 1',
          [eid, item.name]
        );
        if (existing) {
          await client.query('ROLLBACK');
          return reply.code(400).send({ error: 'У вас уже есть этот предмет' });
        }
      }

      // Inventory (item_category from shop item so equip/request buttons render correctly)
      const { rows: [inv] } = await client.query(
        `INSERT INTO gamification_inventory (employee_id, item_type, item_name, item_description, item_category, source_id, source_type)
         VALUES ($1, 'shop_purchase', $2, $3, $4, $5, 'shop') RETURNING id`,
        [eid, item.name, item.description, item.category || 'merch', item.id]
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
              (gf.id IS NOT NULL) as has_fulfillment,
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
    const monthStartMsk = new Date(msk);
    monthStartMsk.setDate(1);
    monthStartMsk.setHours(0, 0, 0, 0);

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
          WHEN q.quest_type = 'monthly'  AND (qp.period_start IS NULL OR qp.period_start < $4) THEN 0
          ELSE COALESCE(qp.current_count, 0)
        END AS progress,
        -- Completed: reset if period rolled over
        CASE
          WHEN q.quest_type = 'daily'    AND (qp.period_start IS NULL OR qp.period_start < $2) THEN false
          WHEN q.quest_type = 'weekly'   AND (qp.period_start IS NULL OR qp.period_start < $3) THEN false
          WHEN q.quest_type = 'monthly'  AND (qp.period_start IS NULL OR qp.period_start < $4) THEN false
          ELSE COALESCE(qp.completed, false)
        END AS completed,
        -- reward_claimed: reset if period rolled over
        CASE
          WHEN q.quest_type = 'daily'    AND (qp.period_start IS NULL OR qp.period_start < $2) THEN false
          WHEN q.quest_type = 'weekly'   AND (qp.period_start IS NULL OR qp.period_start < $3) THEN false
          WHEN q.quest_type = 'monthly'  AND (qp.period_start IS NULL OR qp.period_start < $4) THEN false
          ELSE COALESCE(qp.reward_claimed, false)
        END AS reward_claimed
      FROM gamification_quests q
      LEFT JOIN gamification_quest_progress qp ON qp.quest_id = q.id AND qp.employee_id = $1
      WHERE q.is_active = true
        AND (q.allowed_roles IS NULL OR q.allowed_roles = ''
          OR EXISTS (
            SELECT 1 FROM employee_assignments ea
            WHERE ea.employee_id = $1 AND ea.is_active = true
              AND ea.field_role = ANY(string_to_array(q.allowed_roles, ','))
          )
        )
      ORDER BY q.quest_type, q.id
    `, [eid, todayMsk.toISOString(), weekStartMsk.toISOString(), monthStartMsk.toISOString()]);

    return { quests: rows, current_level: currentLevel };
  });

  // ── GET /leaderboard — ranked by Сила Воина (shifts*10+xp*5+runes*8), real DB tournament ──
  fastify.get('/leaderboard', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const eid = req.fieldEmployee.id;

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
      const lvl = parseInt(level, 10) || 1;
      let result = RANK_TITLES[0];
      for (const t of RANK_TITLES) { if (lvl >= t.min) result = t; }
      return result;
    }

    // warrior_power = total_shifts*10 + earned_xp*5 + earned_runes*8
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
          COALESCE(ea.earned_runes, 0)  AS earned_runes,
          COALESCE(ea.earned_xp, 0)     AS earned_xp,
          COALESCE(gw_r.balance, 0)::int AS runes,
          COALESCE(gw_x.balance, 0)::int AS xp,
          COALESCE(sh.shift_count, 0)::int AS total_shifts,
          COALESCE(gs.current_streak, 0)::int AS streak,
          GREATEST(1, FLOOR(COALESCE(gw_x.balance, 0) / 100) + 1)::int AS level,
          (COALESCE(sh.shift_count,0)*10 + COALESCE(ea.earned_xp,0)*5 + COALESCE(ea.earned_runes,0)*8)::int AS warrior_power,
          ROW_NUMBER() OVER (
            ORDER BY (COALESCE(sh.shift_count,0)*10 + COALESCE(ea.earned_xp,0)*5 + COALESCE(ea.earned_runes,0)*8) DESC
          )::int AS rank
        FROM employees e
        LEFT JOIN gamification_wallets gw_r ON gw_r.employee_id=e.id AND gw_r.currency='runes'
        LEFT JOIN gamification_wallets gw_x  ON gw_x.employee_id=e.id AND gw_x.currency='xp'
        LEFT JOIN earned ea ON ea.employee_id=e.id
        LEFT JOIN (
          SELECT employee_id, COUNT(*)::int AS shift_count
          FROM field_checkins WHERE status='completed' GROUP BY employee_id
        ) sh ON sh.employee_id=e.id
        LEFT JOIN gamification_streaks gs ON gs.employee_id=e.id
        WHERE e.is_active = true
      )
      SELECT * FROM ranked ORDER BY rank LIMIT 200
    `);

    const enriched = rows.map((r) => ({ ...r, rank_title: getRankTitle(r.level) }));

    // Current player (may be outside top-200)
    let myEntry = enriched.find((r) => r.employee_id === eid);
    if (!myEntry) {
      const { rows: [me] } = await db.query(`
        WITH earned AS (
          SELECT employee_id,
            SUM(CASE WHEN currency='runes' AND amount>0 THEN amount ELSE 0 END)::int AS earned_runes,
            SUM(CASE WHEN currency='xp' AND amount>0 THEN amount ELSE 0 END)::int AS earned_xp
          FROM gamification_currency_ledger GROUP BY employee_id
        ),
        ranked AS (
          SELECT e.id AS employee_id, e.fio, e.active_avatar,
            COALESCE(ea.earned_runes,0) AS earned_runes,
            COALESCE(ea.earned_xp,0) AS earned_xp,
            COALESCE(gw_r.balance,0)::int AS runes,
            COALESCE(gw_x.balance,0)::int AS xp,
            COALESCE(sh.shift_count,0)::int AS total_shifts,
            COALESCE(gs.current_streak,0)::int AS streak,
            GREATEST(1, FLOOR(COALESCE(gw_x.balance,0)/100)+1)::int AS level,
            (COALESCE(sh.shift_count,0)*10 + COALESCE(ea.earned_xp,0)*5 + COALESCE(ea.earned_runes,0)*8)::int AS warrior_power,
            ROW_NUMBER() OVER (
              ORDER BY (COALESCE(sh.shift_count,0)*10 + COALESCE(ea.earned_xp,0)*5 + COALESCE(ea.earned_runes,0)*8) DESC
            )::int AS rank
          FROM employees e
          LEFT JOIN gamification_wallets gw_r ON gw_r.employee_id=e.id AND gw_r.currency='runes'
          LEFT JOIN gamification_wallets gw_x ON gw_x.employee_id=e.id AND gw_x.currency='xp'
          LEFT JOIN earned ea ON ea.employee_id=e.id
          LEFT JOIN (SELECT employee_id, COUNT(*)::int AS shift_count FROM field_checkins WHERE status='completed' GROUP BY employee_id) sh ON sh.employee_id=e.id
          LEFT JOIN gamification_streaks gs ON gs.employee_id=e.id
          WHERE e.is_active = true
        )
        SELECT * FROM ranked WHERE employee_id = $1
      `, [eid]);
      myEntry = me ? { ...me, rank_title: getRankTitle(me.level) } : null;
    }

    // Total active participants
    const { rows: [{ total_count }] } = await db.query(
      `SELECT COUNT(*)::int AS total_count FROM employees WHERE is_active = true`
    );
    if (myEntry) myEntry = { ...myEntry, total: total_count };

    // ── Real DB tournament bracket ──
    let tournament = null;
    try {
      const { rows: [dbT] } = await db.query(`
        SELECT * FROM gamification_tournaments
        ORDER BY week_start DESC LIMIT 1
      `);

      if (dbT && Array.isArray(dbT.seeding) && dbT.seeding.length >= 2) {
        const seeding = dbT.seeding;
        const playerIds = seeding.map(s => s.employee_id);

        // Weekly warrior_power for each seeded player (within tournament week)
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
            (COALESCE(ws.weekly_shifts,0)*10 + COALESCE(wc.weekly_xp,0)*5 + COALESCE(wc.weekly_runes,0)*8)::int AS weekly_warrior_power
          FROM employees e
          LEFT JOIN wc ON wc.employee_id = e.id
          LEFT JOIN ws ON ws.employee_id = e.id
          WHERE e.id = ANY($1)
        `, [playerIds, dbT.week_start, dbT.week_end]);

        const wmap = {};
        for (const r of weeklyRows) wmap[r.employee_id] = parseInt(r.weekly_warrior_power) || 0;

        function mkCard(s) {
          if (!s) return null;
          return {
            employee_id: s.employee_id,
            name: (s.fio || '').split(' ')[0],
            seed: s.seed,
            seeded_power: s.warrior_power || 0,
            warrior_power: wmap[s.employee_id] || 0,
          };
        }

        function winnerCard(c1, c2) {
          if (!c1) return c2; if (!c2) return c1;
          if (c1.warrior_power !== c2.warrior_power) return c1.warrior_power > c2.warrior_power ? c1 : c2;
          return c1.seed < c2.seed ? c1 : c2; // lower seed# = stronger
        }

        function makeMatch(c1, c2) {
          const w = winnerCard(c1, c2);
          return { p1: c1 || null, p2: c2 || null, winner_id: w?.employee_id ?? null };
        }

        function getWinner(match) {
          if (!match) return null;
          return match.winner_id === match.p1?.employee_id ? match.p1 : match.p2;
        }

        const seeds = seeding.slice(0, 16);
        while (seeds.length < 16) seeds.push(null);

        const r1 = Array.from({ length: 8 }, (_, i) => makeMatch(mkCard(seeds[i]), mkCard(seeds[15 - i])));
        const r2 = Array.from({ length: 4 }, (_, i) => makeMatch(getWinner(r1[i * 2]), getWinner(r1[i * 2 + 1])));
        const r3 = Array.from({ length: 2 }, (_, i) => makeMatch(getWinner(r2[i * 2]), getWinner(r2[i * 2 + 1])));
        const rfinal = makeMatch(getWinner(r3[0]), getWinner(r3[1]));
        const champion = getWinner(rfinal);

        tournament = {
          week_start: dbT.week_start,
          week_end: dbT.week_end,
          status: dbT.status,
          rounds: [r1, r2, r3, [rfinal]],
          champion,
        };
      }
    } catch (tErr) {
      fastify.log.warn('[leaderboard] tournament fetch error:', tErr.message);
    }

    return { leaderboard: enriched, my_rank: myEntry, tournament };
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

  // ── POST /inventory/:id/unequip — unequip cosmetic/digital item ──
  fastify.post('/inventory/:id/unequip', { preHandler: [fastify.fieldAuthenticate] }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const invId = parseInt(req.params.id, 10);

    const { rows: [inv] } = await db.query(
      'SELECT * FROM gamification_inventory WHERE id = $1 AND employee_id = $2',
      [invId, eid]
    );
    if (!inv) return reply.code(404).send({ error: 'Предмет не найден' });
    if (!inv.is_equipped) return reply.code(400).send({ error: 'Предмет не надет' });

    // Determine slot by item_name (same logic as equip)
    const name = (inv.item_name || '').toLowerCase();
    let slot = 'active_badge';
    if      (name.includes('аватар'))                                   slot = 'active_avatar';
    else if (name.includes('рамк'))                                     slot = 'active_frame';
    else if (name.includes('тема') || /^тем[^а]/.test(name))           slot = 'active_theme';
    else if (name.includes('шлем') || name.includes('маска'))           slot = 'active_helmet';
    else if (name.includes('оружие') || name.includes('топор') ||
             name.includes('молот') || name.includes('копьё') ||
             name.includes('копье') || name.includes('меч'))            slot = 'active_weapon';
    else if (name.includes('броня') || name.includes('кольчуг') ||
             name.includes('нагрудник') || name.includes('плащ'))       slot = 'active_armor';

    await db.query('UPDATE gamification_inventory SET is_equipped = false WHERE id = $1', [invId]);
    await db.query(`UPDATE employees SET ${slot} = NULL WHERE id = $1`, [eid]);

    return { ok: true, slot };
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

  // ── POST /inventory/:id/sell — sell item for 50% of shop price in runes ──
  fastify.post('/inventory/:id/sell', { preHandler: [fastify.fieldAuthenticate] }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const invId = parseInt(req.params.id, 10);

    const { rows: [inv] } = await db.query(
      'SELECT * FROM gamification_inventory WHERE id = $1 AND employee_id = $2',
      [invId, eid]
    );
    if (!inv) return reply.code(404).send({ error: 'Предмет не найден' });
    if (inv.is_equipped) return reply.code(400).send({ error: 'Сначала снимите предмет' });

    // Cannot sell item if any fulfillment record exists (pending/requested/ready/delivered)
    const { rows: [ful] } = await db.query(
      `SELECT id FROM gamification_fulfillment WHERE inventory_id = $1`,
      [invId]
    );
    if (ful) return reply.code(400).send({ error: 'Предмет в процессе доставки — нельзя продать' });

    // Determine sell price:
    // Tier-based defaults (runes) for fallback
    const TIER_PRICE = { legendary: 500, epic: 200, rare: 75, uncommon: 40, common: 25 };
    let shopPriceRunes = 0;

    if (inv.source_type === 'shop' && inv.source_id) {
      const { rows: [si] } = await db.query(
        'SELECT price_runes FROM gamification_shop_items WHERE id = $1', [inv.source_id]
      );
      shopPriceRunes = parseInt(si?.price_runes || 0);
    } else if (inv.source_type === 'spin' && inv.source_id) {
      // Prize may link to a shop_item via prize.value when prize_type='shop_item'
      const { rows: [pr] } = await db.query(
        `SELECT prize_type, value, tier FROM gamification_prizes WHERE id = $1`, [inv.source_id]
      );
      if (pr?.prize_type === 'shop_item' && pr.value) {
        const { rows: [si] } = await db.query(
          'SELECT price_runes FROM gamification_shop_items WHERE id = $1', [parseInt(pr.value)]
        );
        shopPriceRunes = parseInt(si?.price_runes || 0);
      }
      if (!shopPriceRunes) {
        shopPriceRunes = TIER_PRICE[pr?.tier] || 50;
      }
    }

    // Fallback: use item_category/item_name heuristics
    if (!shopPriceRunes) shopPriceRunes = 50;

    const sellPrice = Math.max(5, Math.floor(shopPriceRunes * 0.5));

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Check fulfillment inside transaction to avoid race condition
      const { rows: [fulTx] } = await client.query(
        'SELECT id FROM gamification_fulfillment WHERE inventory_id = $1',
        [invId]
      );
      if (fulTx) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Предмет в процессе доставки — нельзя продать' });
      }

      // Delete inventory record
      const { rowCount } = await client.query(
        'DELETE FROM gamification_inventory WHERE id = $1 AND employee_id = $2',
        [invId, eid]
      );
      if (!rowCount) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Предмет уже продан' });
      }

      // Credit runes
      await client.query(
        `INSERT INTO gamification_wallets (employee_id, currency, balance)
         VALUES ($1, 'runes', $2)
         ON CONFLICT (employee_id, currency) DO UPDATE
           SET balance = gamification_wallets.balance + $2, updated_at = NOW()`,
        [eid, sellPrice]
      );

      // Ledger
      const { rows: [wallet] } = await client.query(
        `SELECT balance FROM gamification_wallets WHERE employee_id = $1 AND currency = 'runes'`, [eid]
      );
      await client.query(
        `INSERT INTO gamification_currency_ledger (employee_id, currency, amount, balance_after, operation, note, reference_type)
         VALUES ($1, 'runes', $2, $3, 'item_sell', $4, 'inventory')`,
        [eid, sellPrice, wallet?.balance || sellPrice, `Продажа: ${inv.item_name}`]
      );

      // Audit log
      await client.query(
        `INSERT INTO gamification_audit_log (employee_id, action, details)
         VALUES ($1, 'item_sold', $2)`,
        [eid, JSON.stringify({ inventory_id: invId, item_name: inv.item_name, sell_price: sellPrice })]
      );

      await client.query('COMMIT');
      return { ok: true, sell_price: sellPrice, item_name: inv.item_name };
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23503') {
        return reply.code(400).send({ error: 'Предмет в процессе доставки — нельзя продать' });
      }
      throw e;
    } finally {
      client.release();
    }
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

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2: Brigade Quests, Odin's Challenge, Duels
  // ═══════════════════════════════════════════════════════════════════

  // ── GET /brigade-quests — active brigade quests for worker's current project ──
  fastify.get('/brigade-quests', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const eid = req.fieldEmployee.id;
    // Find worker's active work_id
    const { rows: [assign] } = await db.query(
      `SELECT work_id FROM employee_assignments WHERE employee_id = $1 AND is_active = true LIMIT 1`, [eid]
    );
    if (!assign) return { quests: [] };

    const { rows } = await db.query(
      `SELECT * FROM gamification_brigade_quests
       WHERE work_id = $1 AND is_active = true
       ORDER BY quest_type, id`, [assign.work_id]
    );

    // Count crew size for reward display
    const { rows: [{ cnt: crewSize }] } = await db.query(
      `SELECT COUNT(*)::int as cnt FROM employee_assignments
       WHERE work_id = $1 AND is_active = true AND field_role = 'worker'`, [assign.work_id]
    );

    return {
      quests: rows.map(q => ({
        ...q,
        crew_size: crewSize,
        total_reward: q.reward_per_person * crewSize,
      })),
    };
  });

  // ── GET /odin-challenge — today's Odin challenge for this project ──
  fastify.get('/odin-challenge', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const eid = req.fieldEmployee.id;
    const { rows: [assign] } = await db.query(
      `SELECT work_id FROM employee_assignments WHERE employee_id = $1 AND is_active = true LIMIT 1`, [eid]
    );
    if (!assign) return { challenge: null };

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
    const { rows: [challenge] } = await db.query(
      `SELECT oc.*, u.name as created_by_name
       FROM gamification_odin_challenges oc
       LEFT JOIN users u ON u.id = oc.created_by
       WHERE oc.work_id = $1 AND oc.challenge_date = $2 AND oc.is_active = true`, [assign.work_id, todayStr]
    );
    if (!challenge) return { challenge: null };

    // Check if current employee already completed it
    const { rows: [completion] } = await db.query(
      `SELECT * FROM gamification_odin_completions WHERE challenge_id = $1 AND employee_id = $2`, [challenge.id, eid]
    );

    // Count total completions
    const { rows: [{ cnt: completions }] } = await db.query(
      `SELECT COUNT(*)::int as cnt FROM gamification_odin_completions WHERE challenge_id = $1`, [challenge.id]
    );

    return {
      challenge: {
        ...challenge,
        my_completion: completion || null,
        total_completions: completions,
      },
    };
  });

  // ── POST /odin-challenge/:id/complete — mark challenge as done (with optional photo) ──
  fastify.post('/odin-challenge/:id/complete', { preHandler: [fastify.fieldAuthenticate] }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const challengeId = parseInt(req.params.id);
    const { photo_url } = req.body || {};

    // Verify challenge exists and is today's
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
    const { rows: [challenge] } = await db.query(
      `SELECT * FROM gamification_odin_challenges WHERE id = $1 AND challenge_date = $2 AND is_active = true`, [challengeId, todayStr]
    );
    if (!challenge) return reply.code(404).send({ error: 'Задание не найдено или истекло' });

    // Insert completion (unique constraint prevents double)
    try {
      await db.query(
        `INSERT INTO gamification_odin_completions (challenge_id, employee_id, proof_photo_url)
         VALUES ($1, $2, $3)`, [challengeId, eid, photo_url || null]
      );
    } catch (e) {
      if (e.code === '23505') return reply.code(400).send({ error: 'Вы уже выполнили это задание' });
      throw e;
    }

    // Auto-verify for non-photo challenges, credit reward immediately
    if (challenge.verification_type !== 'photo' || !challenge.reward_runes) {
      await db.query(
        `UPDATE gamification_odin_completions SET reward_claimed = true, verified_at = NOW() WHERE challenge_id = $1 AND employee_id = $2`,
        [challengeId, eid]
      );
      // Credit runes
      await db.query(
        `INSERT INTO gamification_wallets (employee_id, currency, balance)
         VALUES ($1, 'runes', $2)
         ON CONFLICT (employee_id, currency) DO UPDATE SET balance = gamification_wallets.balance + $2, updated_at = NOW()`,
        [eid, challenge.reward_runes]
      );
      await db.query(
        `INSERT INTO gamification_currency_ledger (employee_id, currency, amount, balance_after, operation, reference_id, reference_type)
         VALUES ($1, 'runes', $2, (SELECT balance FROM gamification_wallets WHERE employee_id = $1 AND currency = 'runes'), 'odin_challenge', $3, 'odin')`,
        [eid, challenge.reward_runes, challengeId]
      );
    }

    return { ok: true, reward: challenge.reward_runes };
  });

  // ── GET /duels — my active and recent duels ──
  fastify.get('/duels', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const eid = req.fieldEmployee.id;
    const { rows } = await db.query(
      `SELECT d.*, e1.fio as challenger_name, e2.fio as opponent_name, e3.fio as winner_name
       FROM gamification_duels d
       JOIN employees e1 ON e1.id = d.challenger_id
       JOIN employees e2 ON e2.id = d.opponent_id
       LEFT JOIN employees e3 ON e3.id = d.winner_id
       WHERE (d.challenger_id = $1 OR d.opponent_id = $1)
         AND d.duel_date >= CURRENT_DATE - 7
       ORDER BY d.created_at DESC LIMIT 20`, [eid]
    );
    return { duels: rows };
  });

  // ── POST /duels — create a duel challenge ──
  fastify.post('/duels', {
    preHandler: [fastify.fieldAuthenticate],
    schema: { body: { type: 'object', required: ['opponent_id', 'duel_type'], properties: {
      opponent_id: { type: 'integer' }, duel_type: { type: 'string', enum: ['photos','hours','shifts'] },
      stake_runes: { type: 'integer', minimum: 5, maximum: 50 },
    } } }
  }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const { opponent_id, duel_type, stake_runes = 10 } = req.body;
    if (opponent_id === eid) return reply.code(400).send({ error: 'Нельзя вызвать самого себя' });

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });

    // Check: max 1 active duel per person per day
    const { rows: [existing] } = await db.query(
      `SELECT id FROM gamification_duels
       WHERE duel_date = $1 AND status IN ('pending','accepted','active')
         AND (challenger_id = $2 OR opponent_id = $2)`, [todayStr, eid]
    );
    if (existing) return reply.code(400).send({ error: 'У тебя уже есть активная дуэль сегодня' });

    // Check opponent doesn't have active duel
    const { rows: [oppDuel] } = await db.query(
      `SELECT id FROM gamification_duels
       WHERE duel_date = $1 AND status IN ('pending','accepted','active')
         AND (challenger_id = $2 OR opponent_id = $2)`, [todayStr, opponent_id]
    );
    if (oppDuel) return reply.code(400).send({ error: 'У соперника уже есть дуэль сегодня' });

    // Check both have enough runes
    const { rows: [myWallet] } = await db.query(
      `SELECT balance FROM gamification_wallets WHERE employee_id = $1 AND currency = 'runes'`, [eid]
    );
    if (!myWallet || myWallet.balance < stake_runes) return reply.code(400).send({ error: 'Недостаточно рун для ставки' });

    // Find work_id
    const { rows: [assign] } = await db.query(
      `SELECT work_id FROM employee_assignments WHERE employee_id = $1 AND is_active = true LIMIT 1`, [eid]
    );

    const { rows: [duel] } = await db.query(
      `INSERT INTO gamification_duels (work_id, challenger_id, opponent_id, duel_type, stake_runes, duel_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING *`,
      [assign?.work_id || 0, eid, opponent_id, duel_type, stake_runes, todayStr]
    );

    return { ok: true, duel };
  });

  // ── POST /duels/:id/respond — accept or decline ──
  fastify.post('/duels/:id/respond', {
    preHandler: [fastify.fieldAuthenticate],
    schema: { body: { type: 'object', required: ['action'], properties: { action: { type: 'string', enum: ['accept','decline'] } } } }
  }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const duelId = parseInt(req.params.id);
    const { action } = req.body;

    const { rows: [duel] } = await db.query(
      `SELECT * FROM gamification_duels WHERE id = $1 AND opponent_id = $2 AND status = 'pending'`, [duelId, eid]
    );
    if (!duel) return reply.code(404).send({ error: 'Дуэль не найдена' });

    if (action === 'decline') {
      await db.query(`UPDATE gamification_duels SET status = 'declined', resolved_at = NOW() WHERE id = $1`, [duelId]);
      return { ok: true, status: 'declined' };
    }

    // Accept — check opponent has enough runes
    const { rows: [oppWallet] } = await db.query(
      `SELECT balance FROM gamification_wallets WHERE employee_id = $1 AND currency = 'runes'`, [eid]
    );
    if (!oppWallet || oppWallet.balance < duel.stake_runes) {
      return reply.code(400).send({ error: 'Недостаточно рун для ставки' });
    }

    await db.query(`UPDATE gamification_duels SET status = 'active' WHERE id = $1`, [duelId]);
    return { ok: true, status: 'active' };
  });

  // ── POST /duels/:id/resolve — end-of-day resolution (called by cron or manually) ──
  fastify.post('/duels/:id/resolve', { preHandler: [fastify.fieldAuthenticate] }, async (req, reply) => {
    const duelId = parseInt(req.params.id);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [duel] } = await client.query(
        `SELECT * FROM gamification_duels WHERE id = $1 AND status = 'active' FOR UPDATE`, [duelId]
      );
      if (!duel) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Дуэль не найдена' }); }

      // Calculate scores based on duel_type
      let cScore = 0, oScore = 0;
      if (duel.duel_type === 'photos') {
        const { rows: [cs] } = await client.query(
          `SELECT COUNT(*)::int as cnt FROM field_photos WHERE employee_id = $1 AND uploaded_at::date = $2`, [duel.challenger_id, duel.duel_date]
        );
        const { rows: [os] } = await client.query(
          `SELECT COUNT(*)::int as cnt FROM field_photos WHERE employee_id = $1 AND uploaded_at::date = $2`, [duel.opponent_id, duel.duel_date]
        );
        cScore = cs?.cnt || 0; oScore = os?.cnt || 0;
      } else if (duel.duel_type === 'hours') {
        const { rows: [cs] } = await client.query(
          `SELECT COALESCE(SUM(hours_worked),0)::numeric as hrs FROM field_checkins WHERE employee_id = $1 AND date = $2 AND status = 'completed'`, [duel.challenger_id, duel.duel_date]
        );
        const { rows: [os] } = await client.query(
          `SELECT COALESCE(SUM(hours_worked),0)::numeric as hrs FROM field_checkins WHERE employee_id = $1 AND date = $2 AND status = 'completed'`, [duel.opponent_id, duel.duel_date]
        );
        cScore = parseFloat(cs?.hrs || 0); oScore = parseFloat(os?.hrs || 0);
      }

      const winnerId = cScore > oScore ? duel.challenger_id : oScore > cScore ? duel.opponent_id : null;
      const totalPot = duel.stake_runes * 2;

      await client.query(
        `UPDATE gamification_duels SET status = 'completed', challenger_score = $2, opponent_score = $3, winner_id = $4, resolved_at = NOW() WHERE id = $1`,
        [duelId, cScore, oScore, winnerId]
      );

      if (winnerId) {
        // Debit loser, credit winner
        const loserId = winnerId === duel.challenger_id ? duel.opponent_id : duel.challenger_id;
        await client.query(
          `UPDATE gamification_wallets SET balance = balance - $2, updated_at = NOW() WHERE employee_id = $1 AND currency = 'runes'`,
          [loserId, duel.stake_runes]
        );
        await client.query(
          `UPDATE gamification_wallets SET balance = balance + $2, updated_at = NOW() WHERE employee_id = $1 AND currency = 'runes'`,
          [winnerId, duel.stake_runes]
        );
        await client.query(`UPDATE gamification_duels SET reward_paid = true WHERE id = $1`, [duelId]);
      }
      // Draw — no one pays

      await client.query('COMMIT');
      return { ok: true, winner_id: winnerId, challenger_score: cScore, opponent_score: oScore, reward: winnerId ? totalPot : 0 };
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
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
