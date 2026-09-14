'use strict';
/**
 * АСГАРД CRM — Корзина склада (маркетплейс). Регистрируется под /api/warehouse-cart.
 *
 * РП накликивает позиции из каталога/оборудования на странице склада (#/warehouse-v2),
 * открывает корзину (персистентную, одна на пользователя), указывает количества, может
 * добавить вручную (проверка по каталогу) или прикрепить Excel (парс+сопоставление).
 * На submit система ПЕРЕПРОВЕРЯЕТ остатки (FOR UPDATE) и АВТО-РАЗБИВАЕТ:
 *   наличие → резерв на складе (stock.reserved_qty + stock_reservations),
 *   дефицит + новые позиции → ОДНА заявка закупщику (procurement_requests + procurement_items),
 *   оборудование → батч equipment_requests.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { randomUUID } = require('crypto');
const { reserveStock } = require('../utils/stock-ops');
const { parseProcurementExcel } = require('../utils/excel-parser');

// Кто пользуется корзиной (РП + кладовщик + закупка + руководители)
const CART_ROLES = ['PM', 'HEAD_PM', 'WAREHOUSE', 'PROC', 'ADMIN', 'CHIEF_ENGINEER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const SEGMENTS = ['cheap', 'medium', 'premium'];

async function routes(fastify) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

  async function mainWarehouseId(client) {
    const r = await (client || db).query("SELECT id FROM warehouses WHERE is_main=true AND is_active=true ORDER BY id LIMIT 1");
    return r.rows[0]?.id || null;
  }

  // upsert продукта по имени (как ensureCatalogProduct в procurement.js) — для новых позиций
  async function ensureProduct(c, { name, unit, article, userId }) {
    const nm = (name || '').trim(); if (!nm) return null;
    const r = await c.query('SELECT id FROM products WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1', [nm]);
    if (r.rows[0]) return r.rows[0].id;
    try {
      const ins = await c.query(
        "INSERT INTO products(name,article,unit,created_from,created_by) VALUES($1,$2,$3,'procurement',$4) RETURNING id",
        [nm, article || null, unit || 'шт', userId || null]);
      return ins.rows[0].id;
    } catch (e) {
      if (e.code === '23505') { const x = await c.query('SELECT id FROM products WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1', [nm]); return x.rows[0]?.id || null; }
      throw e;
    }
  }

  // Получить корзину пользователя (id) или null
  async function getCart(client, userId) {
    const r = await (client || db).query('SELECT * FROM warehouse_cart WHERE user_id=$1', [userId]);
    return r.rows[0] || null;
  }

  // Снимок остатка/цены товара (на момент добавления)
  async function snapshotProduct(client, productId, warehouseId) {
    const s = await client.query(
      'SELECT COALESCE(SUM(quantity - reserved_qty),0) AS available FROM stock WHERE product_id=$1' + (warehouseId ? ' AND warehouse_id=$2' : ''),
      warehouseId ? [productId, warehouseId] : [productId]);
    const p = await client.query('SELECT unit_price, supplier_name FROM v_last_price_by_product WHERE product_id=$1', [productId]);
    return {
      available: parseFloat(s.rows[0].available) || 0,
      price: p.rows[0] ? p.rows[0].unit_price : null,
      supplier: p.rows[0] ? p.rows[0].supplier_name : null,
    };
  }

  // Полная корзина с live-данными (для ответа всех мутаций)
  async function cartPayload(client, userId) {
    const cart = await getCart(client, userId);
    if (!cart) return { cart: null, items: [] };
    const { rows } = await client.query(`
      SELECT ci.*,
        COALESCE(p.name, e.name, ci.custom_name) AS name,
        p.article, COALESCE(p.unit, 'шт') AS unit, p.photo_url,
        COALESCE((SELECT SUM(s.quantity - s.reserved_qty) FROM stock s WHERE s.product_id=ci.product_id), 0) AS available_qty,
        lp.unit_price AS last_price, lp.supplier_name AS last_supplier
      FROM warehouse_cart_items ci
      LEFT JOIN products p   ON p.id = ci.product_id
      LEFT JOIN equipment e  ON e.id = ci.equipment_id
      LEFT JOIN v_last_price_by_product lp ON lp.product_id = ci.product_id
      WHERE ci.cart_id = $1
      ORDER BY ci.added_at`, [cart.id]);
    return { cart: { id: cart.id, warehouse_id: cart.warehouse_id, updated_at: cart.updated_at }, items: rows };
  }

  // ── GET / — корзина пользователя ──────────────────────────────────────────
  fastify.get('/', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req) => {
    return cartPayload(db, req.user.id);
  });

  // ── POST /items — добавить одну/несколько позиций ─────────────────────────
  fastify.post('/items', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req, reply) => {
    const items = (req.body && req.body.items) || [];
    if (!Array.isArray(items) || !items.length) return bad(reply, 'items обязателен');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const wh = req.body.warehouse_id || await mainWarehouseId(client);
      const cu = await client.query(
        `INSERT INTO warehouse_cart(user_id,warehouse_id) VALUES($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET updated_at=NOW(), warehouse_id=COALESCE(warehouse_cart.warehouse_id,EXCLUDED.warehouse_id)
         RETURNING id, warehouse_id`, [req.user.id, wh]);
      const cartId = cu.rows[0].id, cartWh = cu.rows[0].warehouse_id;
      for (const it of items) {
        const type = ['consumable', 'equipment', 'new_position'].includes(it.item_type) ? it.item_type : null;
        if (!type) continue;
        // need_qty всегда > 0 (CHECK в БД); 0/отрицательное/мусор → 1
        const nq = num(it.need_qty); const needQty = (nq && nq > 0) ? nq : 1;
        const seg = SEGMENTS.includes(it.price_segment) ? it.price_segment : null;
        const src = ['catalog', 'manual', 'excel'].includes(it.source) ? it.source : 'catalog';
        let snap = { available: null, price: null, supplier: null };
        if (it.product_id) snap = await snapshotProduct(client, it.product_id, cartWh);
        if (type === 'consumable' && it.product_id) {
          await client.query(`INSERT INTO warehouse_cart_items
            (cart_id,item_type,product_id,need_qty,work_id,price_segment,supplier_name,snapshot_available,snapshot_price,snapshot_supplier,source)
            VALUES($1,'consumable',$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (cart_id,product_id) WHERE product_id IS NOT NULL
            DO UPDATE SET need_qty=EXCLUDED.need_qty, snapshot_available=EXCLUDED.snapshot_available, snapshot_price=EXCLUDED.snapshot_price`,
            [cartId, it.product_id, needQty, it.work_id || null, seg, snap.supplier, snap.available, snap.price, snap.supplier, src]);
        } else if (type === 'equipment' && it.equipment_id) {
          await client.query(`INSERT INTO warehouse_cart_items(cart_id,item_type,equipment_id,need_qty,work_id,source)
            VALUES($1,'equipment',$2,$3,$4,$5)
            ON CONFLICT (cart_id,equipment_id) WHERE equipment_id IS NOT NULL
            DO UPDATE SET need_qty=EXCLUDED.need_qty`,
            [cartId, it.equipment_id, needQty, it.work_id || null, src]);
        } else if (type === 'new_position' && (it.custom_name || '').trim()) {
          await client.query(`INSERT INTO warehouse_cart_items
            (cart_id,item_type,custom_name,need_qty,work_id,price_segment,manual_price,supplier_name,is_new_position,source)
            VALUES($1,'new_position',$2,$3,$4,$5,$6,$7,true,$8)`,
            [cartId, it.custom_name.trim(), needQty, it.work_id || null, seg, num(it.manual_price), it.supplier_name || null, src]);
        }
      }
      await client.query('UPDATE warehouse_cart SET updated_at=NOW() WHERE id=$1', [cartId]);
      await client.query('COMMIT');
      return cartPayload(db, req.user.id);
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  // ── PUT /items/:id — обновить позицию ─────────────────────────────────────
  fastify.put('/items/:id', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id); if (isNaN(id)) return bad(reply, 'Неверный ID');
    const own = await db.query(
      'SELECT ci.id FROM warehouse_cart_items ci JOIN warehouse_cart c ON c.id=ci.cart_id WHERE ci.id=$1 AND c.user_id=$2', [id, req.user.id]);
    if (!own.rows[0]) return bad(reply, 'Позиция не найдена', 404);
    const fields = []; const vals = []; let i = 1;
    const b = req.body || {};
    if (b.need_qty !== undefined) { const q = num(b.need_qty); if (q && q > 0) { fields.push(`need_qty=$${i++}`); vals.push(q); } }
    if (b.work_id !== undefined) { fields.push(`work_id=$${i++}`); vals.push(b.work_id || null); }
    if (b.price_segment !== undefined) { fields.push(`price_segment=$${i++}`); vals.push(SEGMENTS.includes(b.price_segment) ? b.price_segment : null); }
    if (b.manual_price !== undefined) { fields.push(`manual_price=$${i++}`); vals.push(num(b.manual_price)); }
    if (b.supplier_name !== undefined) { fields.push(`supplier_name=$${i++}`); vals.push(b.supplier_name || null); }
    if (!fields.length) return bad(reply, 'Нет данных для обновления');
    vals.push(id);
    await db.query(`UPDATE warehouse_cart_items SET ${fields.join(',')} WHERE id=$${i}`, vals);
    await db.query('UPDATE warehouse_cart c SET updated_at=NOW() FROM warehouse_cart_items ci WHERE ci.id=$1 AND ci.cart_id=c.id', [id]);
    return cartPayload(db, req.user.id);
  });

  // ── DELETE /items/:id — убрать позицию ────────────────────────────────────
  fastify.delete('/items/:id', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id); if (isNaN(id)) return bad(reply, 'Неверный ID');
    const own = await db.query(
      'SELECT ci.cart_id FROM warehouse_cart_items ci JOIN warehouse_cart c ON c.id=ci.cart_id WHERE ci.id=$1 AND c.user_id=$2', [id, req.user.id]);
    if (!own.rows[0]) return bad(reply, 'Позиция не найдена', 404);
    const cartId = own.rows[0].cart_id;
    await db.query('DELETE FROM warehouse_cart_items WHERE id=$1', [id]);
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM warehouse_cart_items WHERE cart_id=$1', [cartId]);
    if (cnt.rows[0].n === 0) await db.query('DELETE FROM warehouse_cart WHERE id=$1', [cartId]);
    return cartPayload(db, req.user.id);
  });

  // ── DELETE / — очистить корзину ───────────────────────────────────────────
  fastify.delete('/', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req) => {
    await db.query('DELETE FROM warehouse_cart WHERE user_id=$1', [req.user.id]);
    return { success: true };
  });

  // ── POST /add-manual — поиск по каталогу для ручного добавления ────────────
  fastify.post('/add-manual', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req) => {
    const name = ((req.body && req.body.name) || '').trim();
    if (name.length < 2) return { matches: [] };
    const cart = await getCart(db, req.user.id);
    const wh = (cart && cart.warehouse_id) || await mainWarehouseId(db);
    const { rows } = await db.query(`
      SELECT p.id, p.name, p.article, p.unit,
        COALESCE((SELECT SUM(s.quantity - s.reserved_qty) FROM stock s WHERE s.product_id=p.id),0) AS available_qty,
        lp.unit_price AS last_price, lp.supplier_name AS last_supplier
      FROM products p
      LEFT JOIN v_last_price_by_product lp ON lp.product_id=p.id
      WHERE p.deleted_at IS NULL AND p.is_active=true
        AND (p.name ILIKE $1 OR p.article ILIKE $1)
      ORDER BY p.name LIMIT 8`, ['%' + name + '%']);
    return { matches: rows, warehouse_id: wh };
  });

  // Токены для ILIKE (слова ≥3 символов; иначе весь запрос)
  function nameTokens(nm) {
    const parts = String(nm || '').toLowerCase().split(/[\s,./\\|()\[\]«»"'+_-]+/).filter(t => t.length >= 3);
    return parts.length ? parts.slice(0, 4) : [String(nm || '').trim().toLowerCase()].filter(Boolean);
  }
  function productAction(avail, need) {
    const a = parseFloat(avail) || 0;
    if (a >= need) return 'reserve';
    if (a > 0) return 'reserve_and_procure';
    return 'procure';
  }
  function equipAction(status) {
    return status === 'on_warehouse' ? 'reserve_equipment' : 'procure_equipment';
  }

  // Fuzzy-поиск по products + equipment (exact / article / ILIKE token / pg_trgm).
  // limit — сколько кандидатов вернуть; без предварительного LIMIT на полный скан таблиц.
  async function fuzzyCatalogMatches(client, { name, article, warehouseId, limit }) {
    const nm = String(name || '').trim();
    const art = String(article || '').trim();
    const lim = Math.max(1, Math.min(50, limit || 15));
    const tokens = nameTokens(nm);
    const likePatterns = tokens.map(t => '%' + t + '%');
    // products
    const prodSqlTrgm = `
      SELECT 'product'::text AS kind, p.id AS product_id, NULL::int AS equipment_id,
        p.name, p.article, p.unit, NULL::text AS status, NULL::text AS inventory_number,
        COALESCE((SELECT SUM(s.quantity - s.reserved_qty) FROM stock s
          WHERE s.product_id=p.id AND ($2::int IS NULL OR s.warehouse_id=$2)),0) AS available_qty,
        lp.unit_price AS last_price, lp.supplier_name AS last_supplier,
        GREATEST(
          CASE WHEN lower(p.name)=lower($1) THEN 1.0 ELSE 0 END,
          CASE WHEN p.article IS NOT NULL AND $3<>'' AND lower(p.article)=lower($3) THEN 0.98 ELSE 0 END,
          COALESCE(similarity(lower(p.name), lower($1)), 0)
        ) AS sim
      FROM products p
      LEFT JOIN v_last_price_by_product lp ON lp.product_id=p.id
      WHERE p.deleted_at IS NULL AND COALESCE(p.is_active,true)=true
        AND (
          lower(p.name)=lower($1)
          OR (p.article IS NOT NULL AND $3<>'' AND lower(p.article)=lower($3))
          OR p.name ILIKE ANY($4::text[])
          OR (p.article IS NOT NULL AND p.article ILIKE ANY($4::text[]))
          OR lower(p.name) % lower($1)
        )
      ORDER BY (lower(p.name)=lower($1)) DESC,
        (p.article IS NOT NULL AND $3<>'' AND lower(p.article)=lower($3)) DESC,
        sim DESC NULLS LAST, p.name
      LIMIT $5`;
    const prodSqlLike = `
      SELECT 'product'::text AS kind, p.id AS product_id, NULL::int AS equipment_id,
        p.name, p.article, p.unit, NULL::text AS status, NULL::text AS inventory_number,
        COALESCE((SELECT SUM(s.quantity - s.reserved_qty) FROM stock s
          WHERE s.product_id=p.id AND ($2::int IS NULL OR s.warehouse_id=$2)),0) AS available_qty,
        lp.unit_price AS last_price, lp.supplier_name AS last_supplier,
        CASE WHEN lower(p.name)=lower($1) THEN 1.0
             WHEN p.article IS NOT NULL AND $3<>'' AND lower(p.article)=lower($3) THEN 0.98
             WHEN p.name ILIKE $6 THEN 0.7 ELSE 0.4 END AS sim
      FROM products p
      LEFT JOIN v_last_price_by_product lp ON lp.product_id=p.id
      WHERE p.deleted_at IS NULL AND COALESCE(p.is_active,true)=true
        AND (
          lower(p.name)=lower($1)
          OR (p.article IS NOT NULL AND $3<>'' AND lower(p.article)=lower($3))
          OR p.name ILIKE ANY($4::text[])
          OR (p.article IS NOT NULL AND p.article ILIKE ANY($4::text[]))
          OR lower(p.name) LIKE lower($6)
        )
      ORDER BY (lower(p.name)=lower($1)) DESC, sim DESC, p.name
      LIMIT $5`;
    let products;
    try {
      products = await client.query(prodSqlTrgm, [nm, warehouseId, art, likePatterns, lim]);
    } catch (_) {
      products = await client.query(prodSqlLike, [
        nm, warehouseId, art, likePatterns, lim,
        '%' + nm.slice(0, Math.min(16, nm.length)) + '%'
      ]);
    }

    // equipment
    const eqSqlTrgm = `
      SELECT 'equipment'::text AS kind, NULL::int AS product_id, e.id AS equipment_id,
        e.name, NULL::text AS article, 'шт'::text AS unit, e.status, e.inventory_number,
        CASE WHEN e.status='on_warehouse' THEN 1 ELSE 0 END::float AS available_qty,
        NULL::numeric AS last_price, NULL::text AS last_supplier,
        GREATEST(
          CASE WHEN lower(e.name)=lower($1) THEN 1.0 ELSE 0 END,
          CASE WHEN e.inventory_number IS NOT NULL AND $2<>'' AND lower(e.inventory_number)=lower($2) THEN 0.95 ELSE 0 END,
          COALESCE(similarity(lower(e.name), lower($1)), 0)
        ) AS sim
      FROM equipment e
      WHERE e.deleted_at IS NULL AND e.status <> 'written_off'
        AND (
          lower(e.name)=lower($1)
          OR (e.inventory_number IS NOT NULL AND $2<>'' AND lower(e.inventory_number)=lower($2))
          OR e.name ILIKE ANY($3::text[])
          OR (e.inventory_number IS NOT NULL AND e.inventory_number ILIKE ANY($3::text[]))
          OR lower(e.name) % lower($1)
        )
      ORDER BY (lower(e.name)=lower($1)) DESC, sim DESC NULLS LAST, e.name
      LIMIT $4`;
    const eqSqlLike = `
      SELECT 'equipment'::text AS kind, NULL::int AS product_id, e.id AS equipment_id,
        e.name, NULL::text AS article, 'шт'::text AS unit, e.status, e.inventory_number,
        CASE WHEN e.status='on_warehouse' THEN 1 ELSE 0 END::float AS available_qty,
        NULL::numeric AS last_price, NULL::text AS last_supplier,
        CASE WHEN lower(e.name)=lower($1) THEN 1.0
             WHEN e.inventory_number IS NOT NULL AND $2<>'' AND lower(e.inventory_number)=lower($2) THEN 0.95
             ELSE 0.5 END AS sim
      FROM equipment e
      WHERE e.deleted_at IS NULL AND e.status <> 'written_off'
        AND (
          lower(e.name)=lower($1)
          OR (e.inventory_number IS NOT NULL AND $2<>'' AND lower(e.inventory_number)=lower($2))
          OR e.name ILIKE ANY($3::text[])
          OR lower(e.name) LIKE lower($5)
        )
      ORDER BY (lower(e.name)=lower($1)) DESC, e.name
      LIMIT $4`;
    let equipment;
    try {
      equipment = await client.query(eqSqlTrgm, [nm, art || nm, likePatterns, lim]);
    } catch (_) {
      equipment = await client.query(eqSqlLike, [
        nm, art || nm, likePatterns, lim,
        '%' + nm.slice(0, Math.min(16, nm.length)) + '%'
      ]);
    }

    const merged = [...products.rows, ...equipment.rows]
      .sort((a, b) => (parseFloat(b.sim) || 0) - (parseFloat(a.sim) || 0))
      .slice(0, lim);
    return merged;
  }

  function mapAlt(row, need) {
    const avail = parseFloat(row.available_qty) || 0;
    if (row.kind === 'equipment') {
      return {
        kind: 'equipment',
        product_id: null,
        equipment_id: row.equipment_id,
        name: row.name,
        article: row.inventory_number || null,
        unit: 'шт',
        status: row.status,
        available_qty: avail,
        last_price: null,
        last_supplier: null,
        sim: parseFloat(row.sim) || 0,
        action: equipAction(row.status)
      };
    }
    return {
      kind: 'product',
      product_id: row.product_id,
      equipment_id: null,
      name: row.name,
      article: row.article,
      unit: row.unit,
      available_qty: avail,
      last_price: row.last_price,
      last_supplier: row.last_supplier,
      sim: parseFloat(row.sim) || 0,
      action: productAction(avail, need)
    };
  }

  const WMS_CART_AI_SYSTEM = [
    'Ты — помощник склада ООО «АСГАРД-Сервис» (WMS-корзина).',
    'Тебе дают строки заявки РП и кандидатов из каталога расходников (products) и оборудования (equipment).',
    'Задача по каждой входной строке:',
    '1) Выбрать лучший матч из кандидатов (или признать, что позиции нет в каталоге).',
    '2) Рекомендовать действие: reserve | reserve_and_procure | procure | procure_new | reserve_equipment | procure_equipment.',
    '3) Упорядочить альтернативы по убыванию уверенности (confidence 0..1).',
    '4) Не выдумывай id/артикулы/остатки — бери только из кандидатов.',
    '5) Верни СТРОГО JSON без markdown: {"suggestions":[{"input_name":"...","matched":true,"match_kind":"product|equipment|null","product_id":null,"equipment_id":null,"recommended_action":"...","confidence":0.0,"reason":"...","alternatives":[{"kind":"product|equipment","product_id":null,"equipment_id":null,"name":"...","confidence":0.0,"action":"..."}]}]}'
  ].join('\n');

  async function maybeEnrichWithLlm(sqlSuggestions) {
    const flag = String(process.env.WMS_CART_AI || '').toLowerCase();
    if (flag === '0' || flag === 'false' || flag === 'off') return { suggestions: sqlSuggestions, ai_used: false };
    try {
      const aiProvider = require('../services/ai-provider');
      const payload = sqlSuggestions.map(s => ({
        input_name: s.input_name,
        article: s.article,
        need_qty: s.need_qty,
        sql_candidates: (s.alternatives || []).map(a => ({
          kind: a.kind,
          product_id: a.product_id,
          equipment_id: a.equipment_id,
          name: a.name,
          article: a.article,
          unit: a.unit,
          available_qty: a.available_qty,
          sim: a.sim,
          action: a.action,
          status: a.status || null
        }))
      }));
      const ai = await aiProvider.complete({
        system: WMS_CART_AI_SYSTEM,
        messages: [{
          role: 'user',
          content: 'Склад warehouse_id в контексте заявки. Строки и SQL-кандидаты (JSON):\n' + JSON.stringify(payload)
        }],
        maxTokens: 4000,
        temperature: 0.1
      });
      let text = (ai && ai.text || '').trim();
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.suggestions)) return { suggestions: sqlSuggestions, ai_used: false };
      // Мержим: SQL-остатки/ids остаются источником правды, LLM — порядок/action/reason
      const byName = new Map(sqlSuggestions.map(s => [String(s.input_name).toLowerCase(), s]));
      const merged = parsed.suggestions.map(ls => {
        const base = byName.get(String(ls.input_name || '').toLowerCase()) || sqlSuggestions.find(s => s.input_name === ls.input_name);
        if (!base) return null;
        const allowActions = new Set(['reserve', 'reserve_and_procure', 'procure', 'procure_new', 'reserve_equipment', 'procure_equipment']);
        const action = allowActions.has(ls.recommended_action) ? ls.recommended_action : base.recommended_action;
        let product_id = base.product_id;
        let equipment_id = base.equipment_id;
        let match_kind = base.match_kind;
        if (ls.product_id && (base.alternatives || []).some(a => a.product_id === ls.product_id)) {
          product_id = ls.product_id; equipment_id = null; match_kind = 'product';
        }
        if (ls.equipment_id && (base.alternatives || []).some(a => a.equipment_id === ls.equipment_id)) {
          equipment_id = ls.equipment_id; product_id = null; match_kind = 'equipment';
        }
        const bestAlt = (base.alternatives || []).find(a =>
          (product_id && a.product_id === product_id) || (equipment_id && a.equipment_id === equipment_id)
        ) || (base.alternatives || [])[0] || null;
        return {
          ...base,
          matched: ls.matched != null ? !!ls.matched : base.matched,
          match_kind,
          product_id,
          equipment_id,
          available_qty: bestAlt ? bestAlt.available_qty : base.available_qty,
          recommended_action: action,
          confidence: typeof ls.confidence === 'number' ? ls.confidence : (bestAlt ? bestAlt.sim : 0),
          reason: ls.reason || null,
          alternatives: base.alternatives,
          is_new_position: action === 'procure_new' || (!product_id && !equipment_id),
          ai_reason: ls.reason || null
        };
      }).filter(Boolean);
      // сохранить порядок входных SQL-строк, если LLM что-то пропустил
      const seen = new Set(merged.map(m => m.input_name));
      for (const s of sqlSuggestions) if (!seen.has(s.input_name)) merged.push(s);
      return { suggestions: merged, ai_used: true };
    } catch (e) {
      return { suggestions: sqlSuggestions, ai_used: false, ai_error: e.message || String(e) };
    }
  }

  // ── POST /parse-excel — Excel → строки с сопоставлением каталогу ───────────
  fastify.post('/parse-excel', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req, reply) => {
    const data = await req.file(); if (!data) return bad(reply, 'Файл не загружен');
    let buf; try { buf = await data.toBuffer(); } catch (_) { return bad(reply, 'Не удалось прочитать файл'); }
    let parsed; try { parsed = await parseProcurementExcel(buf); } catch (_) { return bad(reply, 'Не удалось прочитать Excel'); }
    if (!parsed.length) return bad(reply, 'Не найдено позиций в таблице');
    const cart = await getCart(db, req.user.id);
    const wh = (cart && cart.warehouse_id) || await mainWarehouseId(db);
    const out = [];
    for (const it of parsed) {
      const nm = (it.name || '').trim(); if (!nm) continue;
      const candidates = await fuzzyCatalogMatches(db, {
        name: nm, article: it.article || '', warehouseId: wh, limit: 3
      });
      // предпочтение product над equipment при равном sim; порог слабого матча
      const ranked = candidates.slice().sort((a, b) => {
        const ds = (parseFloat(b.sim) || 0) - (parseFloat(a.sim) || 0);
        if (Math.abs(ds) > 0.02) return ds;
        if (a.kind !== b.kind) return a.kind === 'product' ? -1 : 1;
        return 0;
      });
      const best = ranked[0] && (parseFloat(ranked[0].sim) || 0) >= 0.25 ? ranked[0] : null;
      if (best && best.kind === 'product') {
        out.push({
          name: nm, article: it.article || best.article || '', quantity: it.quantity || 1,
          unit: best.unit || it.unit || 'шт',
          unit_price: it.unit_price != null ? it.unit_price : best.last_price,
          supplier_name: it.supplier_name || best.last_supplier,
          matched: true, match_kind: 'product', product_id: best.product_id, equipment_id: null,
          available_qty: parseFloat(best.available_qty) || 0, last_price: best.last_price,
          is_new_position: false, match_sim: parseFloat(best.sim) || 0,
          candidates: ranked.map(r => mapAlt(r, it.quantity || 1))
        });
      } else if (best && best.kind === 'equipment') {
        out.push({
          name: nm, article: it.article || best.inventory_number || '', quantity: it.quantity || 1,
          unit: 'шт', unit_price: it.unit_price, supplier_name: it.supplier_name || null,
          matched: true, match_kind: 'equipment', product_id: null, equipment_id: best.equipment_id,
          available_qty: parseFloat(best.available_qty) || 0, last_price: null,
          is_new_position: false, match_sim: parseFloat(best.sim) || 0,
          candidates: ranked.map(r => mapAlt(r, it.quantity || 1))
        });
      } else {
        out.push({
          name: nm, article: it.article || '', quantity: it.quantity || 1, unit: it.unit || 'шт',
          unit_price: it.unit_price, supplier_name: it.supplier_name || null,
          matched: false, match_kind: null, product_id: null, equipment_id: null,
          available_qty: 0, last_price: null, is_new_position: true, match_sim: 0,
          candidates: ranked.map(r => mapAlt(r, it.quantity || 1))
        });
      }
    }
    return { rows: out, warehouse_id: wh };
  });

  // ── POST /suggest-ai — AI-слой: products+equipment, SQL fuzzy + optional LLM ──
  fastify.post('/suggest-ai', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req, reply) => {
    const rowsRaw = (req.body && req.body.rows) || [];
    if (!Array.isArray(rowsRaw) || !rowsRaw.length) return bad(reply, 'rows[] обязателен');
    const MAX_ROWS = 300;
    const truncated = rowsRaw.length > MAX_ROWS;
    const rowsIn = truncated ? rowsRaw.slice(0, MAX_ROWS) : rowsRaw;
    const cart = await getCart(db, req.user.id);
    const wh = (cart && cart.warehouse_id) || await mainWarehouseId(db);
    const sqlSuggestions = [];
    for (const it of rowsIn) {
      const nm = String(it.name || '').trim();
      if (!nm) continue;
      const need = parseFloat(it.quantity || it.need_qty || it.qty || 1) || 1;
      const matches = await fuzzyCatalogMatches(db, {
        name: nm, article: it.article || '', warehouseId: wh, limit: 15
      });
      const alts = matches.map(m => mapAlt(m, need));
      const best = alts[0] || null;
      const weak = !best || (best.sim || 0) < 0.25;
      sqlSuggestions.push({
        input_name: nm,
        article: it.article || null,
        need_qty: need,
        matched: !weak,
        match_kind: weak ? null : (best.kind || null),
        product_id: (!weak && best && best.kind === 'product') ? best.product_id : null,
        equipment_id: (!weak && best && best.kind === 'equipment') ? best.equipment_id : null,
        available_qty: best && !weak ? best.available_qty : 0,
        recommended_action: weak ? 'procure_new' : best.action,
        confidence: best && !weak ? (best.sim || 0) : 0,
        alternatives: alts,
        is_new_position: weak
      });
    }
    const enriched = await maybeEnrichWithLlm(sqlSuggestions);
    return {
      warehouse_id: wh,
      ai_used: !!enriched.ai_used,
      ai_error: enriched.ai_error || null,
      truncated,
      max_rows: MAX_ROWS,
      input_rows: rowsRaw.length,
      suggestions: enriched.suggestions
    };
  });

  // Внутренний расчёт разбивки корзины (используется preview и submit).
  // forUpdate: предварительно лочим stock-строки расходников отдельным SELECT FOR UPDATE
  // (нельзя FOR UPDATE на nullable-side LEFT JOIN), затем читаем агрегированную картину.
  async function loadSplit(client, userId, globalWorkId, forUpdate) {
    const cart = await getCart(client, userId);
    if (!cart) return { cart: null, items: [] };
    if (forUpdate) {
      // лочим stock-строки только для consumable-позиций корзины
      await client.query(`
        SELECT s.id FROM stock s
        WHERE s.warehouse_id = $2 AND s.product_id IN (
          SELECT ci.product_id FROM warehouse_cart_items ci
          WHERE ci.cart_id = $1 AND ci.item_type='consumable' AND ci.product_id IS NOT NULL
        ) FOR UPDATE`, [cart.id, cart.warehouse_id]);
    }
    const { rows } = await client.query(`
      SELECT ci.*, COALESCE(p.name, e.name, ci.custom_name) AS name, p.unit AS product_unit,
        st.quantity, st.reserved_qty, st.available_now,
        lp.unit_price AS last_price, lp.supplier_name AS last_supplier
      FROM warehouse_cart_items ci
      LEFT JOIN products p  ON p.id = ci.product_id
      LEFT JOIN equipment e ON e.id = ci.equipment_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(s.quantity),0) AS quantity,
               COALESCE(SUM(s.reserved_qty),0) AS reserved_qty,
               COALESCE(SUM(s.quantity - COALESCE(s.reserved_qty,0)),0) AS available_now
        FROM stock s
        WHERE s.product_id = ci.product_id AND s.warehouse_id = $2
      ) st ON TRUE
      LEFT JOIN LATERAL (
        SELECT lp.unit_price, lp.supplier_name
        FROM v_last_price_by_product lp
        WHERE lp.product_id = ci.product_id
        ORDER BY lp.recorded_at DESC NULLS LAST
        LIMIT 1
      ) lp ON TRUE
      WHERE ci.cart_id = $1`, [cart.id, cart.warehouse_id]);
    return { cart, items: rows };
  }

  // ── POST /preview-submit — разбивка (read-only, без записи) ────────────────
  fastify.post('/preview-submit', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req, reply) => {
    const globalWork = (req.body && req.body.global_work_id) || null;
    const { cart, items } = await loadSplit(db, req.user.id, globalWork, false);
    if (!cart) return bad(reply, 'Корзина пуста', 404);
    const reserve_lines = [], procure_lines = [], equipment_lines = [];
    for (const it of items) {
      const work = globalWork || it.work_id || null;
      if (it.item_type === 'equipment') {
        const ea = await db.query("SELECT COUNT(*)::int AS n FROM equipment WHERE id=$1 AND status='on_warehouse'", [it.equipment_id]);
        equipment_lines.push({ cart_item_id: it.id, name: it.name, available: ea.rows[0].n, need: parseFloat(it.need_qty), work_id: work });
      } else {
        const need = parseFloat(it.need_qty);
        const avail = Math.max(0, parseFloat(it.available_now) || 0);
        const reserve = it.is_new_position ? 0 : Math.min(need, avail);
        const deficit = need - reserve;
        if (reserve > 0) reserve_lines.push({ cart_item_id: it.id, name: it.name, unit: it.product_unit || 'шт', reserve_qty: reserve, available: avail, work_id: work });
        if (deficit > 0) {
          const pickPrice = it.manual_price != null ? it.manual_price : (it.is_new_position ? it.manual_price : it.last_price);
          const pickSup = it.supplier_name || (it.is_new_position ? it.supplier_name : it.last_supplier);
          procure_lines.push({
            cart_item_id: it.id, product_id: it.product_id || null, name: it.name, unit: it.product_unit || 'шт', deficit_qty: deficit,
            last_price: pickPrice, last_supplier: pickSup,
            price_segment: it.price_segment, is_new_position: it.is_new_position,
            supplier_picked: !!(it.supplier_name || it.manual_price != null)
          });
        }
      }
    }
    return { reserve_lines, procure_lines, equipment_lines };
  });

  // ── POST /submit — главная транзакция (перепроверка + авто-разбивка) ───────
  fastify.post('/submit', { preHandler: [fastify.requireRoles(CART_ROLES)] }, async (req, reply) => {
    const b = req.body || {};
    const globalWork = b.global_work_id || b.work_id || null;
    const destination = (b.destination || b.object_name || '').trim() || null;
    const plannedDate = b.planned_date || null;
    const objectName = (b.object_name || b.destination || '').trim() || null;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { cart, items } = await loadSplit(client, req.user.id, globalWork, true);
      if (!cart || !items.length) { await client.query('ROLLBACK'); return bad(reply, 'Корзина пуста', 404); }

      // 1) Перепроверка остатков: критично только если сейчас меньше, чем нужно зарезервировать
      // (снижение ниже snapshot, но всё ещё ≥ need — не блокируем submit).
      const changed = [];
      for (const it of items) {
        if (it.item_type !== 'consumable' || it.is_new_position) continue;
        const now = Math.max(0, parseFloat(it.available_now) || 0);
        const need = Math.max(0, parseFloat(it.need_qty) || 0);
        const snap = it.snapshot_available != null ? parseFloat(it.snapshot_available) : null;
        if (snap != null && now < snap && now < need) {
          changed.push({ cart_item_id: it.id, name: it.name, snapshot_available: snap, new_available: now, need_qty: need });
        }
      }
      if (changed.length) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'stock_changed', changed }); }

      const reservations = [];
      const procureLines = [];   // дефицит + новые позиции + дефицит оборудования (как текст)
      const equipIds = [];
      const reservedSoFar = new Map(); // product_id → уже зарезервировано в этой транзакции

      for (const it of items) {
        const work = globalWork || it.work_id || null;
        if (it.item_type === 'equipment') {
          equipIds.push({ id: it.equipment_id, name: it.name, need: parseFloat(it.need_qty), work });
          continue;
        }
        const need = parseFloat(it.need_qty);
        if (it.is_new_position || !it.product_id) {
          procureLines.push({ name: it.name, qty: need, unit_price: it.manual_price, supplier: it.supplier_name, segment: it.price_segment, work, product_id: null });
          continue;
        }
        const baseAvail = Math.max(0, parseFloat(it.available_now) || 0);
        const already = reservedSoFar.get(it.product_id) || 0;
        const avail = Math.max(0, baseAvail - already);
        const reserve = Math.min(need, avail);
        const deficit = need - reserve;
        if (reserve > 0) {
          const r = await reserveStock(client, { product_id: it.product_id, warehouse_id: cart.warehouse_id, qty: reserve,
            work_id: work, reserved_by: req.user.id, notes: 'Резерв из корзины РП' });
          reservations.push({ product_id: it.product_id, name: it.name, reserve_qty: reserve, reservation_id: r.reservation_id });
          reservedSoFar.set(it.product_id, already + reserve);
        }
        if (deficit > 0) {
          const unitPrice = it.manual_price != null ? it.manual_price : it.last_price;
          const supplier = it.supplier_name || it.last_supplier;
          procureLines.push({ name: it.name, qty: deficit, unit_price: unitPrice, supplier, segment: it.price_segment, work, product_id: it.product_id });
        }
      }

      // 2) Оборудование → батч equipment_requests (FOR UPDATE проверка занятости)
      let equipBatchId = null;
      if (equipIds.length) {
        const ids = equipIds.map(e => e.id);
        const lock = await client.query("SELECT id, name, status FROM equipment WHERE id = ANY($1) FOR UPDATE", [ids]);
        const taken = [];
        for (const e of lock.rows) {
          if (e.status !== 'on_warehouse') { taken.push(e.name); continue; }
          const act = await client.query("SELECT 1 FROM equipment_reservations WHERE equipment_id=$1 AND status='active' LIMIT 1", [e.id]);
          const pend = await client.query("SELECT 1 FROM equipment_requests WHERE equipment_id=$1 AND status='pending' LIMIT 1", [e.id]);
          if (act.rows[0] || pend.rows[0]) taken.push(e.name);
        }
        if (taken.length) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'equipment_taken', taken }); }
        equipBatchId = randomUUID();
        const eqWork = globalWork || equipIds[0].work || null;
        for (const e of equipIds) {
          await client.query(
            `INSERT INTO equipment_requests(equipment_id,requester_id,batch_id,work_id,request_type,status,notes)
             VALUES($1,$2,$3,$4,'issue','pending',$5)`,
            [e.id, req.user.id, equipBatchId, e.work || eqWork, 'Из корзины склада']);
        }
      }

      // 3) Дефицит + новые позиции → ОДНА заявка закупщику
      let procurementId = null;
      // работа: явный global_work_id ИЛИ единая work_id у позиций корзины
      const workCandidates = [
        globalWork,
        ...procureLines.map((l) => l.work).filter(Boolean),
        ...items.map((it) => it.work_id).filter(Boolean),
      ].filter(Boolean);
      const uniqueWorks = [...new Set(workCandidates)];
      const inferredWork = globalWork || (uniqueWorks.length === 1 ? uniqueWorks[0] : null);
      if (procureLines.length) {
        const seg = procureLines.find(l => l.segment)?.segment || null;
        const pr = await client.query(
          `INSERT INTO procurement_requests(work_id,title,price_segment,status,author_id,pm_id)
           VALUES($1,$2,$3,'draft',$4,$4) RETURNING id`,
          [inferredWork, 'Заявка из корзины склада — ' + new Date().toLocaleDateString('ru-RU'), seg, req.user.id]);
        procurementId = pr.rows[0].id;
        // назначить закупщика (ещё не уведомляем — заявка на проверке у РП)
        const pu = await client.query("SELECT id FROM users WHERE role='PROC' AND is_active=true ORDER BY id LIMIT 1");
        if (pu.rows[0]) await client.query('UPDATE procurement_requests SET proc_id=$1 WHERE id=$2', [pu.rows[0].id, procurementId]);
        // позиции bulk
        const n = [], q = [], pp = [], tt = [], sup = [], pid = [], rw = [];
        for (const l of procureLines) {
          let p2 = l.product_id;
          if (!p2) { try { p2 = await ensureProduct(client, { name: l.name, userId: req.user.id }); } catch (_) { p2 = null; } }
          const price = num(l.unit_price);
          n.push(l.name); q.push(l.qty); pp.push(price); tt.push(price ? price * l.qty : null);
          sup.push(l.supplier || null); pid.push(p2); rw.push(l.work || inferredWork || null);
        }
        await client.query(`INSERT INTO procurement_items(procurement_id,name,quantity,unit_price,total_price,supplier,product_id,recipient_work_id,delivery_target)
          SELECT $1,unnest($2::text[]),unnest($3::numeric[]),unnest($4::numeric[]),unnest($5::numeric[]),unnest($6::text[]),unnest($7::int[]),unnest($8::int[]),'warehouse'`,
          [procurementId, n, q, pp, tt, sup, pid, rw]);
        // материализовать total_sum (иначе в карточке «Сумма: 0 ₽» при заполненных ценах)
        await client.query(
          `UPDATE procurement_requests SET total_sum=(
             SELECT COALESCE(SUM(total_price),0) FROM procurement_items
             WHERE procurement_id=$1 AND COALESCE(item_status,'pending')<>'cancelled'
           ), updated_at=NOW() WHERE id=$1`,
          [procurementId]
        );
        // привязать резервы к заявке (информативно)
        if (reservations.length) {
          await client.query('UPDATE stock_reservations SET procurement_id=$1 WHERE id = ANY($2)', [procurementId, reservations.map(r => r.reservation_id)]);
        }
        // уведомить РП: заявка draft на проверку (НЕ закупщиков)
        createNotification(db, {
          user_id: req.user.id,
          title: `📝 Заявка #${procurementId} на проверке`,
          message: `Резерв и сборка созданы. Проверьте позиции и отправьте закупщику.`,
          type: 'procurement',
          link: `#/procurement?id=${procurementId}`
        });
        if (inferredWork) {
          const pms = await client.query(
            `SELECT w.pm_id AS id FROM works w
             JOIN users u ON u.id=w.pm_id AND u.is_active=true
             WHERE w.id=$1 AND w.pm_id IS DISTINCT FROM $2`,
            [inferredWork, req.user.id]
          ).catch(() => ({ rows: [] }));
          for (const p of pms.rows) {
            createNotification(db, {
              user_id: p.id,
              title: `📝 Заявка #${procurementId} на проверке`,
              message: `Из корзины: ${procureLines.length} поз. — проверьте и отправьте закупщику`,
              type: 'procurement',
              link: `#/procurement?id=${procurementId}`
            });
          }
        }
      }

      // 4) Авто-assembly при наличии работы (не отдельная кнопка)
      let assemblyId = null;
      const workForAsm = inferredWork || globalWork;
      if (workForAsm) {
        if (!destination || !plannedDate) {
          await client.query('ROLLBACK');
          return bad(reply, 'Укажите объект и плановую дату для сборки', 400);
        }
        const existing = await client.query(
          `SELECT id FROM assembly_orders WHERE work_id=$1 AND type='mobilization'
             AND status NOT IN ('closed','returned','in_transit') ORDER BY id DESC LIMIT 1`, [workForAsm]);
        if (existing.rows[0]) {
          assemblyId = existing.rows[0].id;
          await client.query(
            `UPDATE assembly_orders SET auto_from_cart=true, source_cart_id=$1, updated_at=NOW(),
               destination=COALESCE($3, destination),
               planned_date=COALESCE($4::date, planned_date),
               object_name=COALESCE($5, object_name)
             WHERE id=$2`,
            [cart.id, assemblyId, destination, plannedDate, objectName]);
        } else {
          const wc = await client.query('SELECT work_title FROM works WHERE id=$1', [workForAsm]);
          const title = 'Мобилизация (корзина): ' + ((wc.rows[0] && wc.rows[0].work_title) || ('#' + workForAsm));
          const ins = await client.query(
            `INSERT INTO assembly_orders(work_id,type,title,destination,planned_date,object_name,created_by,auto_from_cart,source_cart_id,status)
             VALUES($1,'mobilization',$2,$3,$4,$5,$6,true,$7,'confirmed') RETURNING id`,
            [workForAsm, title, destination, plannedDate, objectName, req.user.id, cart.id]);
          assemblyId = ins.rows[0].id;
        }
        // позиции из резерва
        for (const r of reservations) {
          await client.query(
            `INSERT INTO assembly_items(assembly_id,product_id,name,unit,quantity,source,line_status)
             VALUES($1,$2,$3,'шт',$4,'from_cart','reserved')
             ON CONFLICT DO NOTHING`,
            [assemblyId, r.product_id, r.name, r.reserve_qty]).catch(async () => {
              await client.query(
                `INSERT INTO assembly_items(assembly_id,product_id,name,unit,quantity,source,line_status)
                 VALUES($1,$2,$3,'шт',$4,'from_cart','reserved')`,
                [assemblyId, r.product_id, r.name, r.reserve_qty]);
            });
        }
        for (const e of equipIds) {
          await client.query(
            `INSERT INTO assembly_items(assembly_id,equipment_id,name,unit,quantity,source,line_status)
             VALUES($1,$2,$3,'шт',$4,'from_cart','awaiting_wh_approve')`,
            [assemblyId, e.id, e.name, e.need || 1]);
        }
        for (const l of procureLines) {
          await client.query(
            `INSERT INTO assembly_items(assembly_id,product_id,name,unit,quantity,source,line_status)
             VALUES($1,$2,$3,'шт',$4,'from_cart','awaiting_procurement')`,
            [assemblyId, l.product_id || null, l.name, l.qty]);
        }
        // уведомить склад
        const whs = await client.query("SELECT id FROM users WHERE role='WAREHOUSE' AND is_active=true");
        for (const w of whs.rows) {
          if (w.id !== req.user.id) createNotification(db, {
            user_id: w.id, title: '🏗️ Сборка из корзины',
            message: `Работа #${workForAsm} → assembly #${assemblyId}`,
            type: 'assembly', link: `#/warehouse-v2?tab=assemblies&id=${assemblyId}`
          });
        }
      }

      // 5) Очистить корзину
      await client.query('DELETE FROM warehouse_cart WHERE id=$1', [cart.id]);
      await client.query('COMMIT');
      return { success: true, reservations, procurement_id: procurementId, equipment_batch_id: equipBatchId, assembly_id: assemblyId };
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === 'RESERVED') return bad(reply, 'Остаток изменился во время отправки, повторите', 409);
      throw e;
    } finally { client.release(); }
  });
}

module.exports = routes;
