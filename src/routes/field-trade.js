'use strict';

/**
 * P2P trade scaffold for digital cosmetics.
 * Mount under /api/field/gamification (routes: /trade/...)
 */
async function tradeRoutes(fastify) {
  const db = fastify.db;
  const auth = [fastify.fieldAuthenticate];

  fastify.get('/trade/offers', { preHandler: auth }, async (req) => {
    const eid = req.fieldEmployee.id;
    const { rows } = await db.query(`
      SELECT t.*,
             fe.fio AS from_fio, te.fio AS to_fio,
             fi.item_name AS from_item_name, ti.item_name AS to_item_name
      FROM gamification_trade_offers t
      JOIN employees fe ON fe.id = t.from_employee_id
      JOIN employees te ON te.id = t.to_employee_id
      LEFT JOIN gamification_inventory fi ON fi.id = t.from_inventory_id
      LEFT JOIN gamification_inventory ti ON ti.id = t.to_inventory_id
      WHERE t.from_employee_id = $1 OR t.to_employee_id = $1
      ORDER BY t.id DESC
      LIMIT 50
    `, [eid]);
    return { offers: rows };
  });

  fastify.post('/trade/offers', { preHandler: auth }, async (req, reply) => {
    const fromId = req.fieldEmployee.id;
    const {
      to_employee_id,
      from_inventory_id,
      to_inventory_id = null,
      price_runes = 0
    } = req.body || {};

    const toId = parseInt(to_employee_id, 10);
    const fromInv = parseInt(from_inventory_id, 10);
    const price = Math.max(0, parseInt(price_runes, 10) || 0);
    if (!toId || !fromInv) return reply.code(400).send({ error: 'to_employee_id и from_inventory_id обязательны' });
    if (toId === fromId) return reply.code(400).send({ error: 'Нельзя торговать с собой' });

    const { rows: [inv] } = await db.query(`
      SELECT gi.*, COALESCE(gi.item_category, gsi.category) AS cat
      FROM gamification_inventory gi
      LEFT JOIN gamification_shop_items gsi ON gsi.id = gi.source_id
      WHERE gi.id = $1 AND gi.employee_id = $2 AND COALESCE(gi.is_used,false) = false
    `, [fromInv, fromId]);
    if (!inv) return reply.code(404).send({ error: 'Ваш предмет не найден' });
    if (!['digital', 'cosmetic'].includes(inv.cat || inv.item_category)) {
      return reply.code(400).send({ error: 'Обменивать можно только digital/cosmetic' });
    }

    const { rows: [offer] } = await db.query(`
      INSERT INTO gamification_trade_offers
        (from_employee_id, to_employee_id, from_inventory_id, to_inventory_id, price_runes, status)
      VALUES ($1,$2,$3,$4,$5,'pending')
      RETURNING *
    `, [fromId, toId, fromInv, to_inventory_id ? parseInt(to_inventory_id, 10) : null, price]);

    return { offer };
  });

  fastify.post('/trade/offers/:id/accept', { preHandler: auth }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const id = parseInt(req.params.id, 10);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: [offer] } = await client.query(
        `SELECT * FROM gamification_trade_offers WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!offer || offer.status !== 'pending') {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Оффер не найден' });
      }
      if (offer.to_employee_id !== eid) {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'Это не ваш оффер' });
      }

      const price = Number(offer.price_runes) || 0;
      if (price > 0) {
        const { rows: [w] } = await client.query(
          `SELECT balance FROM gamification_wallets
           WHERE employee_id = $1 AND currency = 'runes' FOR UPDATE`,
          [eid]
        );
        if (!w || w.balance < price) {
          await client.query('ROLLBACK');
          return reply.code(400).send({ error: 'Недостаточно рун' });
        }
        const sellerGets = Math.floor(price * 0.9); // 10% fee
        await client.query(
          `UPDATE gamification_wallets SET balance = balance - $1, updated_at = NOW()
           WHERE employee_id = $2 AND currency = 'runes'`,
          [price, eid]
        );
        await client.query(`
          INSERT INTO gamification_wallets (employee_id, currency, balance)
          VALUES ($1, 'runes', $2)
          ON CONFLICT (employee_id, currency) DO UPDATE
          SET balance = gamification_wallets.balance + $2, updated_at = NOW()
        `, [offer.from_employee_id, sellerGets]);
      }

      await client.query(
        `UPDATE gamification_inventory SET employee_id = $1, is_equipped = false WHERE id = $2`,
        [eid, offer.from_inventory_id]
      );
      if (offer.to_inventory_id) {
        await client.query(
          `UPDATE gamification_inventory SET employee_id = $1, is_equipped = false
           WHERE id = $2 AND employee_id = $3`,
          [offer.from_employee_id, offer.to_inventory_id, eid]
        );
      }

      await client.query(
        `UPDATE gamification_trade_offers
         SET status = 'completed', resolved_at = NOW(), escrow_runes = $2
         WHERE id = $1`,
        [id, price]
      );
      await client.query('COMMIT');
      return { ok: true };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  fastify.post('/trade/offers/:id/cancel', { preHandler: auth }, async (req, reply) => {
    const eid = req.fieldEmployee.id;
    const id = parseInt(req.params.id, 10);
    const { rows: [offer] } = await db.query(
      `UPDATE gamification_trade_offers SET status = 'cancelled', resolved_at = NOW()
       WHERE id = $1 AND status = 'pending' AND (from_employee_id = $2 OR to_employee_id = $2)
       RETURNING *`,
      [id, eid]
    );
    if (!offer) return reply.code(404).send({ error: 'Оффер не найден' });
    return { ok: true, offer };
  });
}

module.exports = tradeRoutes;
