/**
 * ASGARD CRM — Личный канбан с подэтапами + карты (Волна 2 ночного прогона)
 * См. PERSONAL_KANBAN_AND_INBOX_PIPELINE.md §2.1, §9.1, MIGRATION_LOG_KANBAN.md H1..H4.
 *
 * Эндпоинты (префикс /api/personal-kanban):
 *   GET    /substages?flow_type=&main_status=
 *   POST   /substages
 *   PATCH  /substages/:id
 *   DELETE /substages/:id
 *   POST   /substages/:id/move-cards-to/:targetId
 *   GET    /cards?flow_type=&include_closed=false
 *   POST   /cards/:id/move
 *   POST   /cards/:id/transfer
 *   GET    /cards/:id/history
 *   POST   /cards/:id/notes
 *   POST   /cards/:id/reminders
 *   PATCH  /cards/:id/reminders/:rid
 *   DELETE /cards/:id/reminders/:rid
 */

'use strict';

const db = require('../services/db');
const { createNotification } = require('../services/notify');
const { broadcast } = require('./sse');

// ─────────────────────────────────────────────────────────────────────────────
// Канонические main_status по flow_type (§9.1 — взяты из реальных источников)
//   application — inbox_applications.status (CHECK после V223)
//   tender      — TENDER_TRANSITIONS из src/routes/tenders.js:9-21
//   pre_tender  — CHECK pre_tender_requests.status (migrations/V046:37)
//   work        — WORK_STATUS_TRANSITIONS из public/assets/js/pm_works.js:1-10
// ─────────────────────────────────────────────────────────────────────────────
const CANONICAL_MAIN_STATUSES = {
  application: [
    'new', 'ai_processed', 'under_review', 'assigned',
    'accepted', 'rejected', 'archived'
  ],
  tender: [
    'Черновик', 'Новый', 'На анализе', 'Отправлено на просчёт',
    'Согласование ТКП', 'ТКП согласовано', 'Готово к отправке КП',
    'КП отправлено', 'Выиграли', 'Проиграли', 'Не подходит'
  ],
  pre_tender: [
    'new', 'in_review', 'need_docs', 'accepted', 'rejected', 'expired',
    'pending_approval', 'approved', 'pending_payment', 'paid',
    'cash_issued', 'cash_received', 'expense_reported'
  ],
  work: [
    'Новая', 'Подготовка', 'Мобилизация', 'В работе',
    'На паузе', 'Подписание акта', 'Работы сдали', 'Закрыт'
  ]
};

const VALID_FLOW_TYPES = ['application', 'tender', 'pre_tender', 'work'];
const VALID_ENTITY_KINDS = ['inbox_application', 'tender', 'pre_tender', 'work'];

function isValidMainStatus(flowType, mainStatus) {
  const list = CANONICAL_MAIN_STATUSES[flowType];
  return Array.isArray(list) && list.includes(mainStatus);
}

function asInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function asColor(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  if (!/^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(s)) return null;
  return s;
}

// Entity-specific lookup for card list (полиморфный JOIN)
async function loadEntitySnapshot(entityKind, entityId) {
  if (!entityId) return null;
  try {
    if (entityKind === 'inbox_application') {
      const r = await db.query(
        `SELECT id, subject AS title, source_name AS customer_name, source_email,
                ai_color, ai_classification, status, created_at,
                EXTRACT(EPOCH FROM (NOW() - created_at))/86400 AS days_since_created
           FROM inbox_applications WHERE id = $1`, [entityId]);
      return r.rows[0] || null;
    } else if (entityKind === 'tender') {
      const r = await db.query(
        `SELECT id, tender_title AS title, customer_name,
                tender_status AS status, tender_price, created_at,
                EXTRACT(EPOCH FROM (NOW() - created_at))/86400 AS days_since_created
           FROM tenders WHERE id = $1`, [entityId]);
      return r.rows[0] || null;
    } else if (entityKind === 'pre_tender') {
      // F2: в pre_tender_requests нет колонки title — используем COALESCE из реальных полей
      // (work_description / work_location / customer_name). Alias=title для единого фронт-API.
      const r = await db.query(
        `SELECT id,
                COALESCE(NULLIF(work_description, ''),
                         NULLIF(work_location, ''),
                         NULLIF(customer_name, ''),
                         'Запрос #' || id::text) AS title,
                customer_name, status, created_at,
                EXTRACT(EPOCH FROM (NOW() - created_at))/86400 AS days_since_created
           FROM pre_tender_requests WHERE id = $1`, [entityId]);
      return r.rows[0] || null;
    } else if (entityKind === 'work') {
      const r = await db.query(
        `SELECT id, work_title AS title, customer_name,
                work_status AS status, created_at,
                EXTRACT(EPOCH FROM (NOW() - created_at))/86400 AS days_since_created
           FROM works WHERE id = $1`, [entityId]);
      return r.rows[0] || null;
    }
  } catch (e) {
    return null;
  }
  return null;
}

// B1: батчевая загрузка снапшотов — Map(id → row). Используется в GET /cards.
async function loadEntitySnapshotsBatch(entityKind, ids) {
  const map = new Map();
  if (!Array.isArray(ids) || ids.length === 0) return map;
  // Дедуп + фильтр null/NaN
  const cleanIds = Array.from(new Set(ids.filter(v => Number.isFinite(Number(v))).map(v => Number(v))));
  if (cleanIds.length === 0) return map;
  try {
    let sql;
    if (entityKind === 'inbox_application') {
      sql = `SELECT id, subject AS title, source_name AS customer_name, source_email,
                    ai_color, ai_classification, status, created_at,
                    EXTRACT(EPOCH FROM (NOW() - created_at))/86400 AS days_since_created
               FROM inbox_applications WHERE id = ANY($1::int[])`;
    } else if (entityKind === 'tender') {
      sql = `SELECT id, tender_title AS title, customer_name,
                    tender_status AS status, tender_price, created_at,
                    EXTRACT(EPOCH FROM (NOW() - created_at))/86400 AS days_since_created
               FROM tenders WHERE id = ANY($1::int[])`;
    } else if (entityKind === 'pre_tender') {
      sql = `SELECT id,
                    COALESCE(NULLIF(work_description, ''),
                             NULLIF(work_location, ''),
                             NULLIF(customer_name, ''),
                             'Запрос #' || id::text) AS title,
                    customer_name, status, created_at,
                    EXTRACT(EPOCH FROM (NOW() - created_at))/86400 AS days_since_created
               FROM pre_tender_requests WHERE id = ANY($1::int[])`;
    } else if (entityKind === 'work') {
      sql = `SELECT id, work_title AS title, customer_name,
                    work_status AS status, created_at,
                    EXTRACT(EPOCH FROM (NOW() - created_at))/86400 AS days_since_created
               FROM works WHERE id = ANY($1::int[])`;
    } else {
      return map;
    }
    const r = await db.query(sql, [cleanIds]);
    for (const row of r.rows) map.set(row.id, row);
  } catch (e) {
    // Логируем но не валим запрос — fallback: пустой Map → entity:null в ответе.
    try { console.warn(`[personal-kanban] loadEntitySnapshotsBatch(${entityKind}) failed: ${e.message}`); }
    catch (_) {}
  }
  return map;
}

async function loadFirstActiveSubstage(client, ownerUserId, flowType, mainStatus) {
  const r = await client.query(
    `SELECT id FROM kanban_substages
      WHERE owner_user_id = $1 AND flow_type = $2 AND main_status = $3 AND is_active = TRUE
      ORDER BY sort_order ASC, id ASC LIMIT 1`,
    [ownerUserId, flowType, mainStatus]);
  return r.rows[0]?.id || null;
}

// Wave-5 H4: helper для закрытия orphan-карт при удалении/архивации источника.
// Вызывается из handler'ов удаления tenders / works / inbox_applications.
// runner: db.pool client ИЛИ shared db (для idempotency пишем UPDATE ... RETURNING).
// reason — короткая метка для history.note (e.g. 'source deleted', 'tender hard delete').
// Возвращает { closed_card_ids: number[] }.
async function closeKanbanCardsForEntity(runner, entityKind, entityId, actorUserId, reason) {
  if (!entityKind || !entityId) return { closed_card_ids: [] };
  // 1. Помечаем карты как закрытые.
  const upd = await runner.query(
    `UPDATE personal_kanban_cards
        SET is_closed = TRUE, last_moved_at = now(), version = version + 1, updated_at = now()
      WHERE entity_kind = $1 AND entity_id = $2 AND is_closed = FALSE
    RETURNING id, owner_user_id, current_substage_id, current_main_status`,
    [entityKind, entityId]);
  if (upd.rowCount === 0) return { closed_card_ids: [] };
  // 2. history запись на каждую карту.
  for (const row of upd.rows) {
    try {
      await runner.query(
        `INSERT INTO personal_kanban_card_history
          (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, note, action)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, 'close')`,
        [row.id, row.current_substage_id, row.current_main_status, row.current_main_status,
         actorUserId || null, `auto: ${reason || 'source deleted'} (${entityKind} #${entityId})`]);
    } catch (e) {
      // не валим вызов источника, history — диагностика
      try { console.warn('[personal-kanban] close history insert failed:', e.message); } catch (_) {}
    }
  }
  // 3. SSE — НЕ внутри транзакции вызывающего; вызывающий пусть пушит сам по closed_card_ids.
  return { closed_card_ids: upd.rows.map(r => r.id), rows: upd.rows };
}

module.exports = async function (fastify) {

  // ═══════════════════════════════════════════════════════════════════
  // GET /substages?flow_type=&main_status=
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/substages', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const { flow_type, main_status, include_inactive } = request.query || {};
    const where = ['owner_user_id = $1'];
    const params = [userId];
    let idx = 2;
    if (flow_type) {
      if (!VALID_FLOW_TYPES.includes(flow_type)) {
        return reply.code(400).send({ error: 'invalid_flow_type' });
      }
      where.push(`flow_type = $${idx++}`); params.push(flow_type);
    }
    if (main_status) {
      where.push(`main_status = $${idx++}`); params.push(main_status);
    }
    if (include_inactive !== 'true') {
      where.push('is_active = TRUE');
    }
    const r = await db.query(
      `SELECT id, owner_user_id, flow_type, main_status, title, sort_order, color,
              is_active, version, created_at, updated_at
         FROM kanban_substages
        WHERE ${where.join(' AND ')}
        ORDER BY flow_type, main_status, sort_order ASC, id ASC`,
      params);
    return { success: true, items: r.rows };
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /substages
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/substages', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const body = request.body || {};
    const flow_type = body.flow_type;
    const main_status = body.main_status;
    const title = (body.title || '').toString().trim();
    const color = asColor(body.color) || '#8a93a6';
    let sort_order = body.sort_order;

    if (!VALID_FLOW_TYPES.includes(flow_type)) {
      return reply.code(400).send({ error: 'invalid_flow_type', valid: VALID_FLOW_TYPES });
    }
    if (!isValidMainStatus(flow_type, main_status)) {
      return reply.code(400).send({
        error: 'invalid_main_status',
        message: `main_status "${main_status}" не входит в каноник flow_type=${flow_type}`,
        valid: CANONICAL_MAIN_STATUSES[flow_type]
      });
    }
    if (title.length < 2 || title.length > 40) {
      return reply.code(400).send({ error: 'invalid_title', message: 'title 2..40 символов' });
    }

    if (typeof sort_order !== 'number' || !Number.isFinite(sort_order)) {
      const r = await db.query(
        `SELECT COALESCE(MAX(sort_order), 0) AS m FROM kanban_substages
          WHERE owner_user_id = $1 AND flow_type = $2 AND main_status = $3`,
        [userId, flow_type, main_status]);
      const max = parseFloat(r.rows[0]?.m || 0);
      sort_order = max > 0 ? max + 1000 : 1000;
    }

    try {
      const ins = await db.query(
        `INSERT INTO kanban_substages
          (owner_user_id, flow_type, main_status, title, sort_order, color)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, owner_user_id, flow_type, main_status, title, sort_order, color,
                   is_active, version, created_at, updated_at`,
        [userId, flow_type, main_status, title, sort_order, color]);
      return { success: true, item: ins.rows[0] };
    } catch (e) {
      request.log.error({ err: e }, '[personal-kanban] create substage failed');
      return reply.code(500).send({ error: 'create_failed', message: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /substages/:id  {title?, color?, sort_order?, version}
  // ═══════════════════════════════════════════════════════════════════
  fastify.patch('/substages/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const id = asInt(request.params.id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });
    const body = request.body || {};
    const version = asInt(body.version);
    if (version === null) return reply.code(400).send({ error: 'version_required' });

    const sets = [];
    const params = [];
    let idx = 1;

    if (body.title !== undefined) {
      const t = (body.title || '').toString().trim();
      if (t.length < 2 || t.length > 40) {
        return reply.code(400).send({ error: 'invalid_title' });
      }
      sets.push(`title = $${idx++}`); params.push(t);
    }
    if (body.color !== undefined) {
      const c = asColor(body.color);
      if (!c) return reply.code(400).send({ error: 'invalid_color' });
      sets.push(`color = $${idx++}`); params.push(c);
    }
    if (body.sort_order !== undefined) {
      const so = parseFloat(body.sort_order);
      if (!Number.isFinite(so)) return reply.code(400).send({ error: 'invalid_sort_order' });
      sets.push(`sort_order = $${idx++}`); params.push(so);
    }

    if (!sets.length) return reply.code(400).send({ error: 'nothing_to_update' });

    sets.push('version = version + 1');
    sets.push('updated_at = now()');

    params.push(id);             // $idx
    params.push(userId);         // $idx+1
    params.push(version);        // $idx+2

    const r = await db.query(
      `UPDATE kanban_substages
          SET ${sets.join(', ')}
        WHERE id = $${idx} AND owner_user_id = $${idx + 1} AND version = $${idx + 2} AND is_active = TRUE
        RETURNING id, owner_user_id, flow_type, main_status, title, sort_order, color, is_active, version, created_at, updated_at`,
      params);

    if (r.rowCount === 0) {
      // либо чужой, либо version_conflict, либо удалён
      const cur = await db.query(
        `SELECT id, owner_user_id, version, is_active FROM kanban_substages WHERE id = $1`, [id]);
      if (!cur.rows[0]) return reply.code(404).send({ error: 'not_found' });
      if (cur.rows[0].owner_user_id !== userId) return reply.code(403).send({ error: 'forbidden' });
      if (!cur.rows[0].is_active) return reply.code(409).send({ error: 'soft_deleted' });
      return reply.code(409).send({ error: 'version_conflict', current_version: cur.rows[0].version });
    }
    return { success: true, item: r.rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════════
  // DELETE /substages/:id — soft-delete с гардом «есть карты»
  // ═══════════════════════════════════════════════════════════════════
  fastify.delete('/substages/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const id = asInt(request.params.id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });

    const cur = await db.query(
      `SELECT id, owner_user_id, flow_type, main_status, is_active FROM kanban_substages WHERE id = $1`, [id]);
    if (!cur.rows[0]) return reply.code(404).send({ error: 'not_found' });
    if (cur.rows[0].owner_user_id !== userId) return reply.code(403).send({ error: 'forbidden' });
    if (!cur.rows[0].is_active) return { success: true, already_inactive: true };

    const cards = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM personal_kanban_cards
        WHERE current_substage_id = $1 AND owner_user_id = $2 AND is_closed = FALSE`,
      [id, userId]);
    const cardsCount = cards.rows[0]?.cnt || 0;
    if (cardsCount > 0) {
      const target = await db.query(
        `SELECT id FROM kanban_substages
          WHERE owner_user_id = $1 AND flow_type = $2 AND main_status = $3
            AND is_active = TRUE AND id <> $4
          ORDER BY sort_order ASC, id ASC LIMIT 1`,
        [userId, cur.rows[0].flow_type, cur.rows[0].main_status, id]);
      return reply.code(409).send({
        error: 'has_cards',
        cards_count: cardsCount,
        suggest_target_id: target.rows[0]?.id || null
      });
    }

    await db.query(
      `UPDATE kanban_substages SET is_active = FALSE, updated_at = now() WHERE id = $1`, [id]);
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /substages/:id/move-cards-to/:targetId — массовый перенос
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/substages/:id/move-cards-to/:targetId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const id = asInt(request.params.id);
    const targetId = asInt(request.params.targetId);
    if (id === null || targetId === null) return reply.code(400).send({ error: 'invalid_id' });
    if (id === targetId) return reply.code(400).send({ error: 'same_substage' });

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const src = await client.query(
        `SELECT id, owner_user_id, flow_type, main_status, is_active
           FROM kanban_substages WHERE id = $1 FOR UPDATE`, [id]);
      const tgt = await client.query(
        `SELECT id, owner_user_id, flow_type, main_status, is_active
           FROM kanban_substages WHERE id = $1 FOR UPDATE`, [targetId]);
      if (!src.rows[0] || !tgt.rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'not_found' });
      }
      if (src.rows[0].owner_user_id !== userId || tgt.rows[0].owner_user_id !== userId) {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (!tgt.rows[0].is_active) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'target_inactive' });
      }
      if (src.rows[0].main_status !== tgt.rows[0].main_status ||
          src.rows[0].flow_type !== tgt.rows[0].flow_type) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'main_status_mismatch' });
      }

      const cards = await client.query(
        `SELECT id, current_substage_id, current_main_status FROM personal_kanban_cards
          WHERE current_substage_id = $1 AND owner_user_id = $2 AND is_closed = FALSE
          FOR UPDATE`,
        [id, userId]);

      for (const card of cards.rows) {
        await client.query(
          `UPDATE personal_kanban_cards
              SET current_substage_id = $1, last_moved_at = now(),
                  version = version + 1, updated_at = now()
            WHERE id = $2`,
          [targetId, card.id]);
        await client.query(
          `INSERT INTO personal_kanban_card_history
            (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, note, action)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'move')`,
          [card.id, id, targetId, card.current_main_status, card.current_main_status, userId,
           'bulk move перед удалением substage']);
      }

      await client.query('COMMIT');

      // SSE для каждой карты
      try {
        for (const card of cards.rows) {
          broadcast('personal_kanban:card_moved', {
            card_id: card.id, owner_user_id: userId,
            to_substage_id: targetId, to_main_status: src.rows[0].main_status,
            bulk: true
          });
        }
      } catch (_) {}

      return { success: true, moved: cards.rowCount };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      request.log.error({ err: e }, '[personal-kanban] move-cards-to failed');
      return reply.code(500).send({ error: 'move_failed', message: e.message });
    } finally {
      client.release();
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /cards?flow_type=&include_closed=false
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/cards', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const { flow_type, include_closed } = request.query || {};
    const where = ['c.owner_user_id = $1'];
    const params = [userId];
    let idx = 2;
    if (flow_type) {
      if (!VALID_FLOW_TYPES.includes(flow_type)) {
        return reply.code(400).send({ error: 'invalid_flow_type' });
      }
      where.push(`c.flow_type = $${idx++}`); params.push(flow_type);
    }
    if (include_closed !== 'true') {
      where.push('c.is_closed = FALSE');
    }

    const r = await db.query(
      `SELECT c.id, c.owner_user_id, c.flow_type, c.entity_kind, c.entity_id,
              c.current_main_status, c.current_substage_id,
              c.transferred_from_user_id, c.transferred_prev_substage_label, c.transferred_at,
              c.last_moved_at, c.is_closed, c.version, c.created_at, c.updated_at,
              s.title AS substage_title, s.color AS substage_color, s.sort_order AS substage_sort_order
         FROM personal_kanban_cards c
         LEFT JOIN kanban_substages s ON s.id = c.current_substage_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.current_main_status, s.sort_order NULLS FIRST, c.last_moved_at DESC`,
      params);

    // B1 (Wave-2 fixer): батчевая загрузка снапшотов вместо N+1.
    // Группируем id по entity_kind → 1 SQL на каждый тип, потом map id→snapshot.
    const idsByKind = {};
    for (const row of r.rows) {
      if (!row.entity_id) continue;
      const k = row.entity_kind;
      if (!idsByKind[k]) idsByKind[k] = new Set();
      idsByKind[k].add(row.entity_id);
    }
    const snapshotsByKind = {};
    for (const kind of Object.keys(idsByKind)) {
      const ids = Array.from(idsByKind[kind]);
      snapshotsByKind[kind] = await loadEntitySnapshotsBatch(kind, ids);
    }

    const items = [];
    for (const row of r.rows) {
      const map = snapshotsByKind[row.entity_kind];
      const snap = (map && row.entity_id != null) ? (map.get(row.entity_id) || null) : null;
      items.push({ ...row, entity: snap });
    }

    // группировка по main_status → substage
    const groups = {};
    for (const it of items) {
      const ms = it.current_main_status || 'unknown';
      if (!groups[ms]) groups[ms] = { main_status: ms, substages: {}, unplaced: [] };
      if (it.current_substage_id == null) {
        groups[ms].unplaced.push(it);
      } else {
        const sid = String(it.current_substage_id);
        if (!groups[ms].substages[sid]) {
          groups[ms].substages[sid] = {
            substage_id: it.current_substage_id,
            title: it.substage_title,
            color: it.substage_color,
            sort_order: it.substage_sort_order,
            cards: []
          };
        }
        groups[ms].substages[sid].cards.push(it);
      }
    }

    return { success: true, items, groups, total: items.length };
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /cards/:id/move — перемещение с FOR UPDATE + version check
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/cards/:id/move', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const userRole = request.user.role;
    const id = asInt(request.params.id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });
    const body = request.body || {};
    const version = asInt(body.version);
    if (version === null) return reply.code(400).send({ error: 'version_required' });
    const toSubstageId = body.to_substage_id == null ? null : asInt(body.to_substage_id);
    const toMainStatusReq = body.to_main_status || null;
    const note = body.note ? String(body.note).slice(0, 2000) : null;
    const confirm = body.confirm === true;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query(
        `SELECT id, owner_user_id, flow_type, entity_kind, entity_id,
                current_substage_id, current_main_status, version, is_closed
           FROM personal_kanban_cards WHERE id = $1 FOR UPDATE`, [id]);
      if (!cur.rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'not_found' });
      }
      const card = cur.rows[0];
      const isOwner = card.owner_user_id === userId;
      const isManager = ['HEAD_PM', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(userRole);
      if (!isOwner && !isManager) {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (card.is_closed) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'card_closed' });
      }
      if (card.version !== version) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'version_conflict', current_version: card.version });
      }

      // Определяем целевой main_status
      let newMainStatus;
      let newSubstageId = toSubstageId;
      if (toSubstageId !== null) {
        const tgt = await client.query(
          `SELECT id, owner_user_id, main_status, flow_type, is_active
             FROM kanban_substages WHERE id = $1 FOR UPDATE`, [toSubstageId]);
        if (!tgt.rows[0]) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'invalid_target' });
        }
        if (tgt.rows[0].owner_user_id !== card.owner_user_id) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'target_owner_mismatch' });
        }
        if (!tgt.rows[0].is_active) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'target_inactive' });
        }
        if (tgt.rows[0].flow_type !== card.flow_type) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'target_flow_type_mismatch' });
        }
        newMainStatus = tgt.rows[0].main_status;
      } else if (toMainStatusReq) {
        if (!isValidMainStatus(card.flow_type, toMainStatusReq)) {
          await client.query('ROLLBACK');
          return reply.code(400).send({
            error: 'invalid_main_status',
            valid: CANONICAL_MAIN_STATUSES[card.flow_type]
          });
        }
        newMainStatus = toMainStatusReq;
        newSubstageId = null;
      } else {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'no_target' });
      }

      // Cross main_status — гард confirm
      if (newMainStatus !== card.current_main_status && !confirm) {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'confirm_required',
          code: 'cross_main_status',
          message: 'Переход между основными статусами требует confirm:true',
          from_main_status: card.current_main_status,
          to_main_status: newMainStatus
        });
      }

      // UPDATE карты
      const upd = await client.query(
        `UPDATE personal_kanban_cards
            SET current_substage_id = $1, current_main_status = $2,
                last_moved_at = now(), version = version + 1, updated_at = now()
          WHERE id = $3 AND version = $4
          RETURNING id, owner_user_id, flow_type, current_main_status, current_substage_id, version`,
        [newSubstageId, newMainStatus, id, version]);
      if (upd.rowCount === 0) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'version_conflict' });
      }

      // INSERT history
      await client.query(
        `INSERT INTO personal_kanban_card_history
          (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, note, action)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'move')`,
        [id, card.current_substage_id, newSubstageId, card.current_main_status, newMainStatus, userId, note]);

      await client.query('COMMIT');

      try {
        broadcast('personal_kanban:card_moved', {
          card_id: id,
          owner_user_id: card.owner_user_id,
          to_substage_id: newSubstageId,
          to_main_status: newMainStatus,
          by_user_id: userId
        });
      } catch (_) {}

      return { success: true, item: upd.rows[0] };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      request.log.error({ err: e }, '[personal-kanban] move failed');
      return reply.code(500).send({ error: 'move_failed', message: e.message });
    } finally {
      client.release();
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /cards/:id/transfer  {to_user_id, note?}
  // H1: 23505 → 409 already_owns
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/cards/:id/transfer', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const actorId = request.user.id;
    const actorRole = request.user.role;
    const id = asInt(request.params.id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });
    const body = request.body || {};
    const toUserId = asInt(body.to_user_id);
    if (toUserId === null) return reply.code(400).send({ error: 'to_user_id_required' });
    const note = body.note ? String(body.note).slice(0, 2000) : null;

    // RBAC: owner OR HEAD_PM OR director/admin
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query(
        `SELECT id, owner_user_id, flow_type, entity_kind, entity_id,
                current_substage_id, current_main_status, version, is_closed
           FROM personal_kanban_cards WHERE id = $1 FOR UPDATE`, [id]);
      if (!cur.rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'not_found' });
      }
      const card = cur.rows[0];
      const isOwner = card.owner_user_id === actorId;
      const isManager = ['HEAD_PM', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(actorRole);
      if (!isOwner && !isManager) {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (card.is_closed) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'card_closed' });
      }
      if (toUserId === card.owner_user_id) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'same_owner' });
      }

      // Валидируем нового owner
      const u = await client.query(
        `SELECT id, name, role, is_active FROM users WHERE id = $1`, [toUserId]);
      if (!u.rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'to_user_not_found' });
      }
      if (!u.rows[0].is_active) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'to_user_inactive' });
      }
      if (!['PM', 'HEAD_PM'].includes(u.rows[0].role)) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'to_user_invalid_role', message: 'transfer только PM/HEAD_PM' });
      }

      // Проверка дубля (H1)
      const dupe = await client.query(
        `SELECT id FROM personal_kanban_cards
          WHERE owner_user_id = $1 AND entity_kind = $2 AND entity_id = $3 AND id <> $4 LIMIT 1`,
        [toUserId, card.entity_kind, card.entity_id, id]);
      if (dupe.rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'already_owns',
          message: 'У получателя уже есть карта на этот entity',
          existing_card_id: dupe.rows[0].id
        });
      }

      // Title прошлого substage (для transferred_prev_substage_label)
      let prevLabel = null;
      if (card.current_substage_id) {
        const ps = await client.query(
          `SELECT title FROM kanban_substages WHERE id = $1`, [card.current_substage_id]);
        prevLabel = ps.rows[0]?.title || null;
      }

      // Новый substage = первый активный у нового owner для текущего main_status
      const newSubstageId = await loadFirstActiveSubstage(client, toUserId, card.flow_type, card.current_main_status);

      let upd;
      try {
        upd = await client.query(
          `UPDATE personal_kanban_cards
              SET owner_user_id = $1, current_substage_id = $2,
                  transferred_from_user_id = $3,
                  transferred_prev_substage_label = $4,
                  transferred_at = now(),
                  last_moved_at = now(), version = version + 1, updated_at = now()
            WHERE id = $5
            RETURNING id, owner_user_id, current_substage_id, current_main_status, version`,
          [toUserId, newSubstageId, card.owner_user_id, prevLabel, id]);
      } catch (e) {
        // H1: PG 23505 unique_violation
        if (e && e.code === '23505') {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'already_owns', constraint: e.constraint || null });
        }
        throw e;
      }

      await client.query(
        `INSERT INTO personal_kanban_card_history
          (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, note, action)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'transfer')`,
        [id, card.current_substage_id, newSubstageId, card.current_main_status, card.current_main_status, actorId,
         note ? `transfer to user ${toUserId}: ${note}` : `transfer to user ${toUserId}`]);

      await client.query('COMMIT');

      // Уведомление новому owner (H3: async-promise rejection → swallowed правильно)
      try {
        const entityLabel = (card.entity_kind || 'card').replace('_', ' ');
        Promise.resolve(createNotification(db, {
          user_id: toUserId,
          title: 'Вам передана карта',
          message: `${entityLabel} #${card.entity_id} перешла к вам${note ? ': ' + note : ''}`,
          type: 'personal_kanban_transfer',
          link: `#/personal-kanban?card=${id}`
        })).catch(err => request.log.warn({ err }, '[personal-kanban] transfer notify failed'));
      } catch (e) {
        request.log.warn({ err: e }, '[personal-kanban] transfer notify sync-throw');
      }

      try {
        broadcast('personal_kanban:card_transferred', {
          card_id: id,
          from_user_id: card.owner_user_id,
          to_user_id: toUserId,
          by_user_id: actorId
        });
      } catch (_) {}

      return { success: true, item: upd.rows[0] };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      request.log.error({ err: e }, '[personal-kanban] transfer failed');
      return reply.code(500).send({ error: 'transfer_failed', message: e.message });
    } finally {
      client.release();
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /cards/:id/history — слияние history+notes
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/cards/:id/history', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const userRole = request.user.role;
    const id = asInt(request.params.id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });

    const cur = await db.query(
      `SELECT owner_user_id FROM personal_kanban_cards WHERE id = $1`, [id]);
    if (!cur.rows[0]) return reply.code(404).send({ error: 'not_found' });
    const isOwner = cur.rows[0].owner_user_id === userId;
    const isManager = ['HEAD_PM', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(userRole);
    if (!isOwner && !isManager) return reply.code(403).send({ error: 'forbidden' });

    const histRes = await db.query(
      `SELECT h.id, h.card_id, h.from_substage_id, h.to_substage_id,
              h.from_main_status, h.to_main_status, h.moved_by, h.moved_at,
              h.note, h.action,
              u.name AS moved_by_name,
              fs.title AS from_substage_title, ts.title AS to_substage_title
         FROM personal_kanban_card_history h
         LEFT JOIN users u ON u.id = h.moved_by
         LEFT JOIN kanban_substages fs ON fs.id = h.from_substage_id
         LEFT JOIN kanban_substages ts ON ts.id = h.to_substage_id
        WHERE h.card_id = $1
        ORDER BY h.moved_at DESC`, [id]);

    const notesRes = await db.query(
      `SELECT n.id, n.card_id, n.author_id, n.body, n.created_at,
              u.name AS author_name
         FROM personal_kanban_card_notes n
         LEFT JOIN users u ON u.id = n.author_id
        WHERE n.card_id = $1
        ORDER BY n.created_at DESC`, [id]);

    const merged = []
      .concat(histRes.rows.map(r => ({ kind: 'history', at: r.moved_at, ...r })))
      .concat(notesRes.rows.map(r => ({ kind: 'note', at: r.created_at, ...r })))
      .sort((a, b) => new Date(b.at) - new Date(a.at));

    return { success: true, items: merged, history: histRes.rows, notes: notesRes.rows };
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /cards/:id/notes  {body}
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/cards/:id/notes', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const userRole = request.user.role;
    const id = asInt(request.params.id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });
    const body = (request.body && request.body.body) ? String(request.body.body).trim() : '';
    if (body.length < 1 || body.length > 4000) {
      return reply.code(400).send({ error: 'invalid_body', message: 'body 1..4000 символов' });
    }

    const cur = await db.query(
      `SELECT owner_user_id FROM personal_kanban_cards WHERE id = $1`, [id]);
    if (!cur.rows[0]) return reply.code(404).send({ error: 'not_found' });
    const isOwner = cur.rows[0].owner_user_id === userId;
    const isManager = ['HEAD_PM', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(userRole);
    if (!isOwner && !isManager) return reply.code(403).send({ error: 'forbidden' });

    const ins = await db.query(
      `INSERT INTO personal_kanban_card_notes (card_id, author_id, body)
       VALUES ($1, $2, $3) RETURNING id, card_id, author_id, body, created_at`,
      [id, userId, body]);
    return { success: true, item: ins.rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /cards/:id/reminders  {remind_at, message?}
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/cards/:id/reminders', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const id = asInt(request.params.id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });
    const body = request.body || {};
    const remindAt = body.remind_at ? new Date(body.remind_at) : null;
    if (!remindAt || isNaN(remindAt.getTime())) {
      return reply.code(400).send({ error: 'invalid_remind_at' });
    }
    if (remindAt.getTime() < Date.now() - 60000) {
      return reply.code(400).send({ error: 'remind_at_in_past' });
    }
    const msg = body.message ? String(body.message).slice(0, 500) : null;

    const cur = await db.query(
      `SELECT owner_user_id FROM personal_kanban_cards WHERE id = $1`, [id]);
    if (!cur.rows[0]) return reply.code(404).send({ error: 'not_found' });
    if (cur.rows[0].owner_user_id !== userId) return reply.code(403).send({ error: 'forbidden' });

    const ins = await db.query(
      `INSERT INTO personal_kanban_card_reminders (card_id, user_id, remind_at, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, card_id, user_id, remind_at, message, is_done, fired_at, created_at`,
      [id, userId, remindAt.toISOString(), msg]);
    return { success: true, item: ins.rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /cards/:id/reminders/:rid  {is_done?}
  // ═══════════════════════════════════════════════════════════════════
  fastify.patch('/cards/:id/reminders/:rid', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const id = asInt(request.params.id);
    const rid = asInt(request.params.rid);
    if (id === null || rid === null) return reply.code(400).send({ error: 'invalid_id' });
    const body = request.body || {};
    if (body.is_done === undefined) return reply.code(400).send({ error: 'nothing_to_update' });

    const r = await db.query(
      `UPDATE personal_kanban_card_reminders
          SET is_done = $1
        WHERE id = $2 AND card_id = $3 AND user_id = $4
        RETURNING id, card_id, user_id, remind_at, message, is_done, fired_at, created_at`,
      [!!body.is_done, rid, id, userId]);
    if (r.rowCount === 0) return reply.code(404).send({ error: 'not_found_or_forbidden' });
    return { success: true, item: r.rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════════
  // DELETE /cards/:id/reminders/:rid
  // ═══════════════════════════════════════════════════════════════════
  fastify.delete('/cards/:id/reminders/:rid', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const id = asInt(request.params.id);
    const rid = asInt(request.params.rid);
    if (id === null || rid === null) return reply.code(400).send({ error: 'invalid_id' });
    const r = await db.query(
      `DELETE FROM personal_kanban_card_reminders
        WHERE id = $1 AND card_id = $2 AND user_id = $3 RETURNING id`,
      [rid, id, userId]);
    if (r.rowCount === 0) return reply.code(404).send({ error: 'not_found_or_forbidden' });
    return { success: true };
  });

};

// Экспорт констант для тестов и других модулей (assign-pm берёт каноник)
module.exports.CANONICAL_MAIN_STATUSES = CANONICAL_MAIN_STATUSES;
module.exports.VALID_FLOW_TYPES = VALID_FLOW_TYPES;
module.exports.VALID_ENTITY_KINDS = VALID_ENTITY_KINDS;
module.exports.isValidMainStatus = isValidMainStatus;
module.exports.loadFirstActiveSubstage = loadFirstActiveSubstage;
module.exports.closeKanbanCardsForEntity = closeKanbanCardsForEntity;
