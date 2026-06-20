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
 *
 *   v3 (8 колонок, V238 view):
 *   GET    /board?flow_filter=             — alias /cards-by-column
 *   GET    /cards-by-column?flow_filter=   — { columns:{new,calc,approval,kp_prep,sent,win,lose,work}, total }
 *   GET    /columns/counts?flow_filter=    — { counts:{...}, total } cache 10s
 *   POST   /cards/:id/transition           — { to_v3_column, note?, confirm? } + side effects
 *   POST   /cards/:cardId/convert-to-pretender — inbox_application → pre_tender_request
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
      // F2 + Wave B: расширенный snapshot — customer + work details + AI + financials,
      // чтобы карта канбана могла нарисовать богатую деталь без второго запроса.
      const r = await db.query(
        `SELECT id,
                COALESCE(NULLIF(work_description, ''),
                         NULLIF(work_location, ''),
                         NULLIF(customer_name, ''),
                         'Запрос #' || id::text) AS title,
                customer_name, customer_email, customer_inn,
                contact_person, contact_phone,
                work_description, work_location, work_deadline,
                estimated_sum,
                ai_summary, ai_color, ai_recommendation, ai_work_match_score,
                has_documents, manual_documents,
                status, created_tender_id, assigned_to, decision_comment, reject_reason,
                created_at,
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
                    customer_name, customer_email, customer_inn,
                    contact_person, contact_phone,
                    work_description, work_location, work_deadline,
                    estimated_sum,
                    ai_summary, ai_color, ai_recommendation, ai_work_match_score,
                    has_documents, manual_documents,
                    status, created_tender_id, assigned_to,
                    created_at,
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

// Wave D — BUG-7: дефолтные наборы подэтапов по (flow_type, main_status).
// Цель: PM не должен начинать с пустой колонки «Не размещено».
// При первом получении карты — авто-создание 3 подэтапов из шаблона.
const DEFAULT_SUBSTAGE_TEMPLATES = {
  'application': {
    'assigned':         ['📥 Изучить заявку',     '📞 Связаться с клиентом',   '📤 Передать в просчёт'],
    'under_review':     ['📋 Анализ',              '💭 Обсуждение',             '✓ Решение'],
    'new':              ['📥 Новые',               '🔍 На просмотре',           '📋 К работе'],
  },
  'pre_tender': {
    'new':              ['🔍 Изучить ТЗ',          '📞 Уточнить детали',        '📊 К расчёту'],
    'in_review':        ['📊 Расчёт',              '💰 Согласование суммы',     '✓ Готов к согласованию'],
    'need_docs':        ['📄 Запрошены доки',      '🔄 Доки получены',          '✓ Готов'],
    'pending_approval': ['⏳ Ожидает директора',   '💬 На обсуждении',          '✓ Согласовано'],
    'approved':         ['🏆 Создать тендер',      '⏰ В ожидании',             '✓ Передан в тендер'],
  },
  'tender': {
    'Новый':                  ['🎯 Принять',         '👥 Команда',             '📋 К просчёту'],
    'Согласование ТКП':       ['📊 Расчёт ТКП',      '🧮 Проверка',           '💼 С директором'],
    'Готово к отправке КП':   ['📝 Подготовка КП',   '✓ Проверка',            '📤 Отправить'],
    'КП отправлено':          ['⏳ Ожидание ответа', '📞 Дозвон клиента',      '🏆 Победа/проигрыш'],
  },
  'work': {
    'Подготовка':       ['📄 Документы',           '🚚 Мобилизация',            '👷 Команда готова'],
    'Мобилизация':      ['🛒 Закупки',             '🚚 Перевозка',              '✓ На месте'],
    'В работе':         ['📊 Контроль',            '📞 Связь с клиентом',       '⚠ Риски'],
    'Подписание акта':  ['📝 Подготовка акта',     '🤝 Согласование',           '✓ Подписан'],
  },
};

async function ensureDefaultSubstages(client, ownerUserId, flowType, mainStatus) {
  const existing = await client.query(
    `SELECT id FROM kanban_substages
      WHERE owner_user_id=$1 AND flow_type=$2 AND main_status=$3 AND is_active=TRUE
      ORDER BY sort_order ASC, id ASC LIMIT 1`,
    [ownerUserId, flowType, mainStatus]);
  if (existing.rows[0]) return existing.rows[0].id;

  // Нет подэтапов — пробуем дефолтный шаблон.
  const template = DEFAULT_SUBSTAGE_TEMPLATES[flowType]?.[mainStatus];
  if (!template || !template.length) return null;

  let firstId = null;
  const colors = ['#5b8def', '#f39c12', '#27ae60', '#9b59b6', '#e74c3c', '#c8a84e'];
  for (let i = 0; i < template.length; i++) {
    try {
      const ins = await client.query(
        `INSERT INTO kanban_substages (owner_user_id, flow_type, main_status, title, sort_order, color, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         RETURNING id`,
        [ownerUserId, flowType, mainStatus, template[i], 1000 * (i + 1), colors[i % colors.length]]);
      if (i === 0) firstId = ins.rows[0].id;
    } catch (e) {
      // не валим вызывающий код — substages best-effort
      try { console.warn(`[personal-kanban] ensureDefaultSubstages insert failed:`, e.message); } catch (_) {}
    }
  }
  return firstId;
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

// ─────────────────────────────────────────────────────────────────────────────
// v3 канбан: 8 каноничных колонок (V238 миграция, pk_v3_column())
//   new       — поступление (application:new/under_review/assigned, pre_tender:new/need_docs, tender:Черновик/Новый/На анализе)
//   calc      — расчёт   (application:accepted, pre_tender:in_review, tender:Отправлено на просчёт/Согласование ТКП)
//   approval  — согласование (pre_tender:pending_approval, tender:ТКП согласовано)
//   kp_prep   — подготовка КП (pre_tender:approved, tender:Готово к отправке КП)
//   sent      — КП отправлено (tender:КП отправлено)
//   win       — выигран (tender:Выиграли)
//   lose      — проигран/отклонён (application:rejected/archived, pre_tender:rejected/expired, tender:Проиграли/Не подходит)
//   work      — в работе (всегда для flow_type='work')
// ─────────────────────────────────────────────────────────────────────────────
// S-2/V250: добавлена 9-я колонка 'addendum' (статус «Дозапрос» — заказчик
// прислал дозапрос после «КП отправлено», карта временно туда до ответа).
const V3_COLUMNS = ['new', 'calc', 'approval', 'kp_prep', 'sent', 'addendum', 'win', 'lose', 'work'];

// Маппинг (toColumn, flow_type) → canonical main_status (целевой при transition).
// Возвращает строку или null если переход недопустим для данного flow.
// Логика отражает обратное соответствие к pk_v3_column() из V238.
// Для work — в колонку 'work' не меняем статус (любой work-статус остаётся), null = «keep current».
function v3ColumnToMainStatus(toColumn, flowType, currentMainStatus) {
  if (!V3_COLUMNS.includes(toColumn)) return undefined;

  if (flowType === 'application') {
    switch (toColumn) {
      case 'new':      return 'new';
      case 'calc':     return 'accepted';
      case 'lose':     return 'rejected';
      default:         return null; // approval/kp_prep/sent/win/work — не применимо к application
    }
  }
  if (flowType === 'pre_tender') {
    switch (toColumn) {
      case 'new':      return 'new';
      case 'calc':     return 'in_review';
      case 'approval': return 'pending_approval';
      case 'kp_prep':  return 'approved';
      case 'lose':     return 'rejected';
      default:         return null; // sent/win/work — не применимо к pre_tender (тендер уже)
    }
  }
  if (flowType === 'tender') {
    switch (toColumn) {
      case 'new':      return 'Новый';
      case 'calc':     return 'Согласование ТКП';
      case 'approval': return 'ТКП согласовано';
      case 'kp_prep':  return 'Готово к отправке КП';
      case 'sent':     return 'КП отправлено';
      case 'addendum': return 'Дозапрос';   // S-2/V250: дозапрос от заказчика
      case 'win':      return 'Выиграли';
      case 'lose':     return 'Проиграли';
      default:         return null; // work — не применимо к tender (только после конверсии в work)
    }
  }
  if (flowType === 'work') {
    // BUG-W1-01: НЕ затирать work_status. work-колонка = noop для work-flow.
    // Возврат null = «оставить текущий main_status», а transition по-прежнему
    // обновит карту (substage может смениться) + history запись.
    if (toColumn === 'work') return null;
    return undefined; // другие колонки для work-flow не допускаются
  }
  return undefined;
}

const DIRECTOR_ROLES = ['HEAD_PM', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

// ─────────────────────────────────────────────────────────────────────────────
// S-9: scope-режимы канбана.
//   auto         — резолвится из роли (PM/HEAD_PM→owner, TO→to_personal,
//                  HEAD_TO→to_team, DIRECTOR/ADMIN→all)
//   owner        — карты конкретного пользователя (по умолчанию request.user.id;
//                  HEAD_TO+ могут указать ?owner_id=N чтобы посмотреть чей-то канбан)
//   to_personal  — только tender-карты, где tender.calculator_user_id=user.id
//                  OR tender.created_by_user_id=user.id
//   to_team      — только tender-карты всего тендерного отдела (TO + HEAD_TO active)
//   all          — без owner-фильтра (для директоров и аудита)
// ─────────────────────────────────────────────────────────────────────────────
const VALID_SCOPES = ['auto', 'owner', 'to_personal', 'to_team', 'all'];
const ADMIN_LIKE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

function resolveAutoScope(userRole) {
  if (ADMIN_LIKE_ROLES.includes(userRole)) return 'all';
  if (userRole === 'HEAD_TO') return 'to_team';
  if (userRole === 'TO') return 'to_personal';
  // HEAD_PM, PM, остальные — свой персональный канбан
  return 'owner';
}

// RBAC: можно ли роли userRole запросить scope (помимо auto).
// Возвращает {ok: true} или {ok: false, code, error}.
//   PM: только owner для себя (owner_id игнорируется в RBAC — но 403 если не = self ниже)
//   TO: owner (только себя) + to_personal
//   HEAD_TO: owner (с любым owner_id), to_personal, to_team, all (анализ отдела)
//   HEAD_PM: owner + all (видит свою команду PM)
//   ADMIN, DIRECTOR_*: всё
function canUserUseScope(userRole, scope) {
  if (!VALID_SCOPES.includes(scope)) {
    return { ok: false, code: 400, error: 'invalid_scope', valid: VALID_SCOPES };
  }
  if (scope === 'auto') return { ok: true };
  if (ADMIN_LIKE_ROLES.includes(userRole)) return { ok: true };
  if (userRole === 'HEAD_TO') {
    // HEAD_TO видит всё (owner/to_personal/to_team/all)
    return { ok: true };
  }
  if (userRole === 'HEAD_PM') {
    if (scope === 'to_team' || scope === 'to_personal') {
      return { ok: false, code: 403, error: 'forbidden_scope_for_role', role: userRole, scope };
    }
    return { ok: true }; // owner + all
  }
  if (userRole === 'TO') {
    if (scope === 'to_team' || scope === 'all') {
      return { ok: false, code: 403, error: 'forbidden_scope_for_role', role: userRole, scope };
    }
    return { ok: true }; // owner + to_personal
  }
  // PM, прочие
  if (scope !== 'owner') {
    return { ok: false, code: 403, error: 'forbidden_scope_for_role', role: userRole, scope };
  }
  return { ok: true };
}

// Для scope='owner' с owner_id: проверить что request.user может смотреть на чей-то канбан.
//   Свой канбан (owner_id == user.id) — всегда ok.
//   Чужой канбан — только ADMIN/DIRECTOR_*/HEAD_TO/HEAD_PM.
function canUserViewOwnerBoard(user, requestedOwnerId) {
  if (requestedOwnerId === user.id) return true;
  if (ADMIN_LIKE_ROLES.includes(user.role)) return true;
  if (user.role === 'HEAD_TO' || user.role === 'HEAD_PM') return true;
  return false;
}

// Строит WHERE-фрагмент для personal_kanban_cards (или для view).
// Возвращает { where: ['...', '...'], params: [...] }.
// tableAlias — 'c' для view-aliased v_unified_kanban_cards, '' для прямого
// personal_kanban_cards (без JOIN).
async function buildScopeWhere(db, user, scope, ownerId, tableAlias = 'c') {
  const a = tableAlias ? tableAlias + '.' : '';
  const where = [];
  const params = [];

  if (scope === 'all') {
    // Без owner-фильтра — только базовое условие (is_closed добавляется отдельно)
    return { where, params };
  }

  if (scope === 'owner') {
    const uid = (typeof ownerId === 'number' && ownerId > 0) ? ownerId : user.id;
    params.push(uid);
    where.push(`${a}owner_user_id = $${params.length}`);
    return { where, params };
  }

  if (scope === 'to_personal') {
    // Только тендерные карты, где tender.calculator_user_id=$ OR created_by_user_id=$
    params.push(user.id);
    where.push(`${a}entity_kind = 'tender'`);
    where.push(`EXISTS (
      SELECT 1 FROM tenders t_scope
        WHERE t_scope.id = ${a}entity_id
          AND (t_scope.calculator_user_id = $${params.length} OR t_scope.created_by_user_id = $${params.length})
    )`);
    return { where, params };
  }

  if (scope === 'to_team') {
    // Только тендерные карты всего отдела (TO + HEAD_TO active users).
    // Считаем «отделом» всех активных пользователей с ролью TO или HEAD_TO.
    const teamRes = await db.query(
      `SELECT id FROM users WHERE role IN ('TO','HEAD_TO') AND is_active = true`);
    const teamIds = teamRes.rows.map(r => r.id);
    if (teamIds.length === 0) {
      // Пустая команда → ничего не показываем
      params.push(-1);
      where.push(`1 = $${params.length}`); // never true
      return { where, params };
    }
    params.push(teamIds);
    where.push(`${a}entity_kind = 'tender'`);
    where.push(`EXISTS (
      SELECT 1 FROM tenders t_scope
        WHERE t_scope.id = ${a}entity_id
          AND (t_scope.calculator_user_id = ANY($${params.length}::int[])
            OR t_scope.created_by_user_id = ANY($${params.length}::int[])
            OR t_scope.responsible_pm_id   = ANY($${params.length}::int[]))
    )`);
    return { where, params };
  }

  // Не должен сюда попасть — VALID_SCOPES уже проверен.
  return { where: [], params: [] };
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

  // ═══════════════════════════════════════════════════════════════════
  // POST /cards/:cardId/start-quick — открыть Quick-сессию ТКП из карты
  // ─────────────────────────────────────────────────────────────────
  // Создаёт tkp_quick_sessions (V129) с session_uid=uuid и привязкой к
  // entity-источнику карты (pre_tender/tender/inbox_application). Возвращает
  // { session_uid, session_id }. RBAC: владелец карты ИЛИ TO/HEAD_TO/HEAD_PM/
  // ADMIN/DIRECTOR_*. Идемпотентности нет — каждый клик = новая сессия
  // (Quick-сессии короткоживущие, повторное создание это нормально).
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/cards/:cardId/start-quick', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const userRole = request.user.role;
    const cardId = asInt(request.params.cardId);
    if (cardId === null) return reply.code(400).send({ error: 'invalid_id' });

    // 1. Карта + entity.
    const cardRes = await db.query(
      `SELECT id, owner_user_id, entity_kind, entity_id, flow_type, is_closed
         FROM personal_kanban_cards WHERE id = $1`,
      [cardId]);
    if (!cardRes.rows[0]) return reply.code(404).send({ error: 'card_not_found' });
    const card = cardRes.rows[0];

    const isOwner = card.owner_user_id === userId;
    const isManager = ['HEAD_PM', 'HEAD_TO', 'TO', 'ADMIN',
                       'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(userRole);
    if (!isOwner && !isManager) return reply.code(403).send({ error: 'forbidden' });
    if (card.is_closed) return reply.code(409).send({ error: 'card_closed' });

    // 2. Подтягиваем customer/tz из источника (best-effort).
    let customerInn = null;
    let customerName = null;
    let tzText = null;
    let preTenderId = null;
    let tenderId = null;
    try {
      if (card.entity_kind === 'pre_tender' && card.entity_id) {
        const r = await db.query(
          `SELECT customer_inn, customer_name, work_description
             FROM pre_tender_requests WHERE id = $1`, [card.entity_id]);
        if (r.rows[0]) {
          customerInn = r.rows[0].customer_inn || null;
          customerName = r.rows[0].customer_name || null;
          tzText = r.rows[0].work_description || null;
          preTenderId = card.entity_id;
        }
      } else if (card.entity_kind === 'tender' && card.entity_id) {
        const r = await db.query(
          `SELECT customer_inn, customer_name, tender_title
             FROM tenders WHERE id = $1`, [card.entity_id]);
        if (r.rows[0]) {
          customerInn = r.rows[0].customer_inn || null;
          customerName = r.rows[0].customer_name || null;
          tzText = r.rows[0].tender_title || null;
          tenderId = card.entity_id;
        }
      } else if (card.entity_kind === 'inbox_application' && card.entity_id) {
        const r = await db.query(
          `SELECT subject, source_name FROM inbox_applications WHERE id = $1`, [card.entity_id]);
        if (r.rows[0]) {
          customerName = r.rows[0].source_name || null;
          tzText = r.rows[0].subject || null;
        }
      }
    } catch (e) {
      request.log.warn({ err: e }, '[personal-kanban] start-quick: entity snapshot failed');
    }

    // 3. INSERT tkp_quick_sessions.
    const sessionUid = require('crypto').randomUUID();
    try {
      const ins = await db.query(
        `INSERT INTO tkp_quick_sessions
          (session_uid, author_id, customer_inn, customer_name,
           pre_tender_id, tender_id, tz_text, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
         RETURNING id, session_uid`,
        [sessionUid, card.owner_user_id, customerInn, customerName,
         preTenderId, tenderId, tzText]);
      return {
        success: true,
        session_uid: ins.rows[0].session_uid,
        session_id: ins.rows[0].id
      };
    } catch (e) {
      request.log.error({ err: e }, '[personal-kanban] start-quick failed');
      return reply.code(500).send({ error: 'start_quick_failed', message: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /cards/:cardId/start-conductor — запустить Conductor из карты
  // ─────────────────────────────────────────────────────────────────
  // Создаёт mimir_conductor_runs (V133) status='DRAFT'. Если по этому
  // tender_id уже есть активный run (status NOT IN терминальных) — возвращает
  // существующий run_id (idempotency). Связки card_id / pre_tender_id /
  // entity пишем в complexity_flags JSONB (отдельных колонок в V133 нет).
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/cards/:cardId/start-conductor', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const userRole = request.user.role;
    const cardId = asInt(request.params.cardId);
    if (cardId === null) return reply.code(400).send({ error: 'invalid_id' });

    // 1. Карта + entity.
    const cardRes = await db.query(
      `SELECT id, owner_user_id, entity_kind, entity_id, flow_type, is_closed
         FROM personal_kanban_cards WHERE id = $1`,
      [cardId]);
    if (!cardRes.rows[0]) return reply.code(404).send({ error: 'card_not_found' });
    const card = cardRes.rows[0];

    const isOwner = card.owner_user_id === userId;
    const isManager = ['HEAD_PM', 'HEAD_TO', 'TO', 'ADMIN',
                       'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(userRole);
    if (!isOwner && !isManager) return reply.code(403).send({ error: 'forbidden' });
    if (card.is_closed) return reply.code(409).send({ error: 'card_closed' });

    // 2. Разворачиваем entity_kind в (tender_id, work_id) + сохраняем pre_tender_id для flags.
    let tenderId = null;
    let workId = null;
    let preTenderId = null;
    if (card.entity_kind === 'tender') tenderId = card.entity_id;
    else if (card.entity_kind === 'work') workId = card.entity_id;
    else if (card.entity_kind === 'pre_tender') {
      preTenderId = card.entity_id;
      // pre_tender мог уже породить tender → подцепляем для дедупа.
      try {
        const r = await db.query(
          `SELECT created_tender_id FROM pre_tender_requests WHERE id = $1`, [card.entity_id]);
        if (r.rows[0] && r.rows[0].created_tender_id) tenderId = r.rows[0].created_tender_id;
      } catch (_) {}
    }

    // 3. Проверяем активный run по (tender_id | work_id).
    if (tenderId || workId) {
      const dedupeCol = tenderId ? 'tender_id' : 'work_id';
      const dedupeVal = tenderId || workId;
      try {
        const exist = await db.query(
          `SELECT id, status FROM mimir_conductor_runs
            WHERE ${dedupeCol} = $1
              AND status NOT IN ('READY_FOR_REVIEW','ERROR','APPROVED','REJECTED','CANCELLED')
            ORDER BY id DESC LIMIT 1`,
          [dedupeVal]);
        if (exist.rows[0]) {
          return {
            success: true,
            run_id: Number(exist.rows[0].id),
            status: 'existing',
            run_status: exist.rows[0].status
          };
        }
      } catch (e) {
        request.log.warn({ err: e }, '[personal-kanban] start-conductor: dedupe lookup failed');
      }
    }

    // 4. INSERT нового run'a.
    const complexityFlags = {
      card_id: cardId,
      entity_kind: card.entity_kind,
      entity_id: card.entity_id,
      ...(preTenderId ? { pre_tender_id: preTenderId } : {})
    };
    try {
      const ins = await db.query(
        `INSERT INTO mimir_conductor_runs
          (work_id, tender_id, initiated_by, status, profile, complexity_flags)
         VALUES ($1, $2, $3, 'DRAFT', 'STANDARD', $4::jsonb)
         RETURNING id, status`,
        [workId, tenderId, userId, JSON.stringify(complexityFlags)]);
      return {
        success: true,
        run_id: Number(ins.rows[0].id),
        status: 'created',
        run_status: ins.rows[0].status
      };
    } catch (e) {
      request.log.error({ err: e }, '[personal-kanban] start-conductor failed');
      return reply.code(500).send({ error: 'start_conductor_failed', message: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // v3 endpoints: 8-колоночный канбан (V238 view + pk_v3_column())
  // ═══════════════════════════════════════════════════════════════════════════

  // Внутренний handler для /board и /cards-by-column (один и тот же ответ).
  //
  // Параметры:
  //   flow_filter: 'all' (по умолч.) | 'application' | 'tender' | 'pre_tender' | 'work'.
  //   scope:       'auto' (default) | 'owner' | 'to_personal' | 'to_team' | 'all'.
  //                Auto резолвится в зависимости от роли (см. resolveAutoScope).
  //   owner_id:    integer, только при scope='owner' — смотрим чей-то канбан.
  //                Свой = всегда ok. Чужой — только ADMIN/DIRECTOR_*/HEAD_TO/HEAD_PM.
  //
  // Для scope='to_personal'/'to_team' автоматически фильтруется flow_type='tender'
  // (это требование S-9: канбан ТО показывает только тендеры, заявки и работы — в общем
  // списке хаба).
  async function _v3LoadBoard(request, reply) {
    const user = request.user;
    const userId = user.id;
    const userRole = user.role;
    const flowFilter = (request.query && request.query.flow_filter) ? String(request.query.flow_filter) : 'all';
    let scope = (request.query && request.query.scope) ? String(request.query.scope) : 'auto';

    // Резолвим auto → конкретный scope.
    if (scope === 'auto') scope = resolveAutoScope(userRole);

    // RBAC: может ли роль использовать этот scope?
    const rbac = canUserUseScope(userRole, scope);
    if (!rbac.ok) return reply.code(rbac.code).send({ error: rbac.error, role: rbac.role, scope: rbac.scope, valid: rbac.valid });

    // owner_id: только осмысленно при scope='owner'.
    let ownerId = null;
    if (scope === 'owner' && request.query && request.query.owner_id !== undefined) {
      const oid = parseInt(request.query.owner_id, 10);
      if (isNaN(oid) || oid <= 0) {
        return reply.code(400).send({ error: 'invalid_owner_id' });
      }
      if (!canUserViewOwnerBoard(user, oid)) {
        return reply.code(403).send({ error: 'forbidden_owner_board', owner_id: oid });
      }
      ownerId = oid;
    }

    // Строим WHERE по scope.
    const scopeRes = await buildScopeWhere(db, user, scope, ownerId, 'c');
    const where = ['c.is_closed = FALSE', ...scopeRes.where];
    const params = [...scopeRes.params];

    // flow_filter: пользовательский. Для to_personal/to_team всегда форсим 'tender'
    // (S-9 требование: канбан ТО показывает только тендеры).
    let effectiveFlowFilter = flowFilter;
    if (scope === 'to_personal' || scope === 'to_team') {
      effectiveFlowFilter = 'tender';
    }
    if (effectiveFlowFilter !== 'all') {
      if (!VALID_FLOW_TYPES.includes(effectiveFlowFilter)) {
        return reply.code(400).send({ error: 'invalid_flow_filter', valid: ['all', ...VALID_FLOW_TYPES] });
      }
      params.push(effectiveFlowFilter);
      where.push(`c.flow_type = $${params.length}`);
    }

    let rows;
    try {
      const r = await db.query(
        `SELECT c.id, c.owner_user_id, c.flow_type, c.entity_kind, c.entity_id,
                c.current_main_status, c.current_substage_id,
                c.v3_column, c.is_closed, c.version,
                c.last_moved_at, c.created_at, c.updated_at,
                c.substage_title, c.substage_color, c.substage_sort_order
           FROM v_unified_kanban_cards c
          WHERE ${where.join(' AND ')}
          ORDER BY c.v3_column, c.substage_sort_order NULLS FIRST, c.last_moved_at DESC`,
        params);
      rows = r.rows;
    } catch (e) {
      // VIEW отсутствует (миграция V238 не накатана) → честная 503, не 500.
      if (e && (e.code === '42P01' || /v_unified_kanban_cards/i.test(e.message || ''))) {
        request.log.warn('[personal-kanban v3] view v_unified_kanban_cards missing, run V238 migration');
        return reply.code(503).send({ error: 'v3_view_missing', message: 'apply migration V238' });
      }
      throw e;
    }

    // Батч-загрузка snapshot по entity_kind (переиспользуем существующий helper).
    const idsByKind = {};
    for (const row of rows) {
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

    // Группировка по 9 колонкам (V250 добавил 'addendum').
    const columns = { new: [], calc: [], approval: [], kp_prep: [], sent: [], addendum: [], win: [], lose: [], work: [] };
    for (const row of rows) {
      const map = snapshotsByKind[row.entity_kind];
      const snap = (map && row.entity_id != null) ? (map.get(row.entity_id) || null) : null;
      const card = { ...row, entity: snap };
      const col = V3_COLUMNS.includes(row.v3_column) ? row.v3_column : 'new';
      columns[col].push(card);
    }

    return {
      success: true,
      columns,
      total: rows.length,
      flow_filter: effectiveFlowFilter,
      scope,                       // S-9: явный scope в ответе для фронта
      owner_id: ownerId,           // null если scope!='owner' или owner_id не указан
      viewer_role: userRole
    };
  }

  // GET /board?flow_filter=
  fastify.get('/board', { preHandler: [fastify.authenticate] }, _v3LoadBoard);

  // GET /cards-by-column?flow_filter=  (alias /board, оба возвращают одинаковую структуру)
  fastify.get('/cards-by-column', { preHandler: [fastify.authenticate] }, _v3LoadBoard);

  // ═══════════════════════════════════════════════════════════════════
  // GET /columns/counts?flow_filter=&scope=&owner_id=
  // S-9: тот же scope-механизм что и в /board (RBAC + WHERE по scope).
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/columns/counts', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;
    const userId = user.id;
    const userRole = user.role;
    const flowFilter = (request.query && request.query.flow_filter) ? String(request.query.flow_filter) : 'all';
    let scope = (request.query && request.query.scope) ? String(request.query.scope) : 'auto';
    if (scope === 'auto') scope = resolveAutoScope(userRole);

    const rbac = canUserUseScope(userRole, scope);
    if (!rbac.ok) return reply.code(rbac.code).send({ error: rbac.error, role: rbac.role, scope: rbac.scope, valid: rbac.valid });

    let ownerId = null;
    if (scope === 'owner' && request.query && request.query.owner_id !== undefined) {
      const oid = parseInt(request.query.owner_id, 10);
      if (isNaN(oid) || oid <= 0) return reply.code(400).send({ error: 'invalid_owner_id' });
      if (!canUserViewOwnerBoard(user, oid)) return reply.code(403).send({ error: 'forbidden_owner_board', owner_id: oid });
      ownerId = oid;
    }

    // VIEW v_unified_kanban_cards без алиаса — используем 'c.' для совместимости с buildScopeWhere.
    // (counts работает на view, как и /board, потому что нужна вычисляемая v3_column через функцию.)
    const scopeRes = await buildScopeWhere(db, user, scope, ownerId, 'c');
    const where = ['c.is_closed = FALSE', ...scopeRes.where];
    const params = [...scopeRes.params];

    let effectiveFlowFilter = flowFilter;
    if (scope === 'to_personal' || scope === 'to_team') effectiveFlowFilter = 'tender';
    if (effectiveFlowFilter !== 'all') {
      if (!VALID_FLOW_TYPES.includes(effectiveFlowFilter)) {
        return reply.code(400).send({ error: 'invalid_flow_filter', valid: ['all', ...VALID_FLOW_TYPES] });
      }
      params.push(effectiveFlowFilter);
      where.push(`c.flow_type = $${params.length}`);
    }

    try {
      const r = await db.query(
        `SELECT c.v3_column, COUNT(*)::int AS cnt
           FROM v_unified_kanban_cards c
          WHERE ${where.join(' AND ')}
          GROUP BY c.v3_column`,
        params);
      // 9 колонок (V250 добавил 'addendum').
      const counts = { new: 0, calc: 0, approval: 0, kp_prep: 0, sent: 0, addendum: 0, win: 0, lose: 0, work: 0 };
      let total = 0;
      for (const row of r.rows) {
        if (V3_COLUMNS.includes(row.v3_column)) {
          counts[row.v3_column] = row.cnt;
          total += row.cnt;
        }
      }
      reply.header('Cache-Control', 'private, max-age=10');
      return {
        success: true,
        counts,
        total,
        flow_filter: effectiveFlowFilter,
        scope,
        owner_id: ownerId,
        viewer_role: userRole
      };
    } catch (e) {
      if (e && (e.code === '42P01' || /v_unified_kanban_cards/i.test(e.message || ''))) {
        return reply.code(503).send({ error: 'v3_view_missing', message: 'apply migration V238' });
      }
      throw e;
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /cards/:id/transition  { to_v3_column, note?, confirm?, version? }
  //
  // Маппит v3-колонку → канонический main_status по (flow_type),
  // обновляет карту + main_status в source-entity (tenders/pre_tender_requests/
  // inbox_applications), пишет history(action='move'), делает SSE-broadcast.
  // Cross-column переход требует confirm:true (как и /cards/:id/move).
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/cards/:id/transition', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const userRole = request.user.role;
    const id = asInt(request.params.id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });
    const body = request.body || {};
    const toCol = body.to_v3_column ? String(body.to_v3_column) : null;
    const note = body.note ? String(body.note).slice(0, 2000) : null;
    const confirm = body.confirm === true;
    if (!toCol || !V3_COLUMNS.includes(toCol)) {
      return reply.code(400).send({ error: 'invalid_to_v3_column', valid: V3_COLUMNS });
    }

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
      const isManager = DIRECTOR_ROLES.includes(userRole);
      if (!isOwner && !isManager) {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (card.is_closed) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'card_closed' });
      }
      // Version check опциональный (для оптимистической блокировки фронта).
      const reqVersion = asInt(body.version);
      if (reqVersion !== null && card.version !== reqVersion) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'version_conflict', current_version: card.version });
      }

      // Маппинг колонки → main_status.
      const mapped = v3ColumnToMainStatus(toCol, card.flow_type, card.current_main_status);
      if (mapped === undefined) {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'transition_not_allowed',
          message: `flow_type=${card.flow_type} → column=${toCol} недопустимо`,
          flow_type: card.flow_type, to_v3_column: toCol
        });
      }
      // mapped === null → keep current main_status (work→work no-op для main_status,
      // BUG-W1-01: НЕ ставим 'Новая' для work-flow, чтобы не затирать 'В работе' и т.п.
      // карта всё равно обновится (last_moved_at, version), history запишется.
      const newMainStatus = mapped === null ? card.current_main_status : mapped;

      // Текущая колонка (для cross-column гарда). Используем функцию pk_v3_column из V238.
      const curColRes = await client.query(
        `SELECT pk_v3_column($1, $2) AS col`,
        [card.flow_type, card.current_main_status]);
      const currentCol = curColRes.rows[0]?.col || null;
      if (currentCol !== toCol && !confirm) {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'confirm_required',
          code: 'cross_v3_column',
          message: 'Переход между колонками требует confirm:true',
          from_v3_column: currentCol,
          to_v3_column: toCol
        });
      }

      // Перенос substage: если main_status поменялся — берём первый активный
      // подэтап у текущего owner (с auto-default если нет), иначе оставляем.
      let newSubstageId = card.current_substage_id;
      if (newMainStatus !== card.current_main_status) {
        newSubstageId = await ensureDefaultSubstages(client, card.owner_user_id, card.flow_type, newMainStatus);
        // ensureDefaultSubstages может вернуть null если шаблона нет — оставляем NULL (unplaced).
      }

      // UPDATE карты.
      const upd = await client.query(
        `UPDATE personal_kanban_cards
            SET current_substage_id = $1, current_main_status = $2,
                last_moved_at = now(), version = version + 1, updated_at = now()
          WHERE id = $3
          RETURNING id, owner_user_id, flow_type, current_main_status, current_substage_id, version`,
        [newSubstageId, newMainStatus, id]);

      // INSERT history (action='move').
      await client.query(
        `INSERT INTO personal_kanban_card_history
          (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, note, action)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'move')`,
        [id, card.current_substage_id, newSubstageId, card.current_main_status, newMainStatus, userId,
         note ? `v3:${toCol} ${note}` : `v3:${toCol}`]);

      // Side effects: синхронизируем main_status в source-entity (best-effort).
      const sideEffects = { updated_entity: false };
      if (newMainStatus !== card.current_main_status && card.entity_id) {
        try {
          if (card.entity_kind === 'tender') {
            // Tenders: tender_status + кэш дат (kp_sent_at, won_at, lost_at — V117/V236).
            const sets = ['tender_status = $1', 'updated_at = now()'];
            const ps = [newMainStatus];
            if (newMainStatus === 'КП отправлено') sets.push(`kp_sent_at = COALESCE(kp_sent_at, now())`);
            if (newMainStatus === 'Выиграли')     sets.push(`won_at      = COALESCE(won_at, now())`);
            if (newMainStatus === 'Проиграли')    sets.push(`lost_at     = COALESCE(lost_at, now())`);
            ps.push(card.entity_id);
            const eu = await client.query(
              `UPDATE tenders SET ${sets.join(', ')} WHERE id = $${ps.length}`,
              ps);
            sideEffects.updated_entity = eu.rowCount > 0;
          } else if (card.entity_kind === 'pre_tender') {
            const eu = await client.query(
              `UPDATE pre_tender_requests SET status = $1, updated_at = now() WHERE id = $2`,
              [newMainStatus, card.entity_id]);
            sideEffects.updated_entity = eu.rowCount > 0;
          } else if (card.entity_kind === 'inbox_application') {
            const eu = await client.query(
              `UPDATE inbox_applications SET status = $1, updated_at = now() WHERE id = $2`,
              [newMainStatus, card.entity_id]);
            sideEffects.updated_entity = eu.rowCount > 0;
          }
          // work: main_status не меняется (mapped===null для work→work), works.work_status не трогаем.
        } catch (e) {
          // Side effect не блокирует transition — карта уже UPDATEd. Логируем.
          request.log.warn({ err: e, card_id: id, kind: card.entity_kind, status: newMainStatus },
            '[personal-kanban v3] entity status sync failed');
          sideEffects.entity_error = e.message;
        }
      }

      await client.query('COMMIT');

      try {
        broadcast('personal_kanban:card_moved', {
          card_id: id,
          owner_user_id: card.owner_user_id,
          to_substage_id: newSubstageId,
          to_main_status: newMainStatus,
          to_v3_column: toCol,
          from_v3_column: currentCol,
          by_user_id: userId,
          v3: true
        });
      } catch (_) {}

      return { success: true, item: upd.rows[0], to_v3_column: toCol, side_effects: sideEffects };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      request.log.error({ err: e }, '[personal-kanban v3] transition failed');
      return reply.code(500).send({ error: 'transition_failed', message: e.message });
    } finally {
      client.release();
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /cards/:cardId/convert-to-pretender  { note? }
  //
  // Конверсия карты inbox_application → pre_tender. Создаёт pre_tender_request,
  // переключает карту на новый entity (kind='pre_tender'), пишет history(action='convert'),
  // помечает inbox_application как 'accepted' с decision_notes.
  // ВНИМАНИЕ: inbox_applications.linked_pre_tender_id в схеме НЕТ (есть только linked_tender_id),
  // UPDATE сделан в try/catch — если колонка появится миграцией, заработает автоматически.
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/cards/:cardId/convert-to-pretender', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const userRole = request.user.role;
    const cardId = asInt(request.params.cardId);
    if (cardId === null) return reply.code(400).send({ error: 'invalid_id' });
    const body = request.body || {};
    const note = body.note ? String(body.note).slice(0, 2000) : null;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock карты.
      const curRes = await client.query(
        `SELECT id, owner_user_id, flow_type, entity_kind, entity_id,
                current_substage_id, current_main_status, version, is_closed
           FROM personal_kanban_cards WHERE id = $1 FOR UPDATE`, [cardId]);
      const card = curRes.rows[0];
      if (!card) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'not_found' }); }
      if (card.is_closed) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'card_closed' }); }
      if (card.entity_kind !== 'inbox_application') {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'invalid_entity_kind',
          message: 'convert-to-pretender работает только для entity_kind=inbox_application',
          current_entity_kind: card.entity_kind
        });
      }

      // RBAC: owner или директор.
      const isOwner = card.owner_user_id === userId;
      const isManager = DIRECTOR_ROLES.includes(userRole);
      if (!isOwner && !isManager) {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'forbidden' });
      }

      // 2. Lock inbox_application (для дубль-проверки и UPDATE).
      const appRes = await client.query(
        `SELECT id, email_id, subject, body_preview, source_kind, source_email, source_name,
                forwarded_from_email, original_sender_email, original_sender_name,
                ai_summary, ai_color, ai_classification, ai_recommendation,
                ai_estimated_budget, ai_keywords,
                assigned_pm_id, status, attachment_count
           FROM inbox_applications WHERE id = $1 FOR UPDATE`,
        [card.entity_id]);
      const app = appRes.rows[0];
      if (!app) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'application_not_found' });
      }

      // 3. Дубль pre_tender по email_id?
      if (app.email_id) {
        const dup = await client.query(
          `SELECT id FROM pre_tender_requests WHERE email_id = $1 LIMIT 1`, [app.email_id]);
        if (dup.rows[0]) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'pre_tender_exists', pre_tender_id: dup.rows[0].id });
        }
      }

      // 4. Customer detection (forward-aware, как в inbox_applications_ai.to-pre-tender).
      const customerName  = (app.source_kind === 'corporate_forward' && app.original_sender_name)
        ? app.original_sender_name
        : (app.source_name || app.original_sender_name || '');
      const customerEmail = (app.source_kind === 'corporate_forward' && app.original_sender_email)
        ? app.original_sender_email
        : (app.source_email || app.original_sender_email || '');
      const workDescription = [
        app.ai_summary || '',
        '',
        (app.body_preview || '').slice(0, 1500)
      ].filter(Boolean).join('\n');

      // 5. INSERT pre_tender_request.
      const ptIns = await client.query(`
        INSERT INTO pre_tender_requests
          (email_id, source_type,
           customer_name, customer_email,
           work_description,
           estimated_sum,
           ai_summary, ai_color, ai_recommendation,
           has_documents,
           status, assigned_to, created_by)
        VALUES ($1, 'email', $2, $3, $4, $5, $6, $7, $8, $9, 'new', $10, $11)
        RETURNING id, status, customer_name`,
        [
          app.email_id || null,
          (customerName || '').slice(0, 255),
          (customerEmail || '').slice(0, 255),
          workDescription,
          app.ai_estimated_budget || null,
          app.ai_summary || null,
          app.ai_color || 'yellow',
          app.ai_recommendation || null,
          (app.attachment_count || 0) > 0,
          app.assigned_pm_id || card.owner_user_id || null,
          userId,
        ]);
      const preTenderId = ptIns.rows[0].id;

      // 6. Обратная ссылка emails.pre_tender_id (best-effort, поле может отсутствовать).
      if (app.email_id) {
        try { await client.query(`UPDATE emails SET pre_tender_id = $1 WHERE id = $2`, [preTenderId, app.email_id]); }
        catch (_) {}
      }

      // 7. UPDATE inbox_application: status='accepted', decision_notes, попытка linked_pre_tender_id.
      await client.query(
        `UPDATE inbox_applications
            SET status = 'accepted',
                decision_by = $1, decision_at = now(),
                decision_notes = $2,
                updated_at = now()
          WHERE id = $3`,
        [userId,
         `Конвертирована в pre_tender_request #${preTenderId} (kanban)` + (note ? '. ' + note : ''),
         app.id]);
      try {
        // best-effort: если колонка существует — заполнить.
        await client.query(
          `UPDATE inbox_applications SET linked_pre_tender_id = $1 WHERE id = $2`,
          [preTenderId, app.id]);
      } catch (_) { /* колонки нет — игнор */ }

      // 8. Конвертим саму карту: kind→pre_tender, entity_id→preTenderId, main_status='new',
      //    substage = первый активный/auto-default для (pre_tender,'new').
      const newSubstageId = await ensureDefaultSubstages(
        client, card.owner_user_id, 'pre_tender', 'new');

      const upd = await client.query(
        `UPDATE personal_kanban_cards
            SET entity_kind = 'pre_tender', entity_id = $1, flow_type = 'pre_tender',
                current_main_status = 'new', current_substage_id = $2,
                last_moved_at = now(), version = version + 1, updated_at = now()
          WHERE id = $3
          RETURNING id, owner_user_id, flow_type, entity_kind, entity_id,
                    current_main_status, current_substage_id, version`,
        [preTenderId, newSubstageId, cardId]);

      // 9. history запись (action='convert', разрешён CHECK V221:117).
      await client.query(
        `INSERT INTO personal_kanban_card_history
          (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, action, note)
         VALUES ($1, $2, $3, $4, 'new', $5, 'convert', $6)`,
        [cardId, card.current_substage_id, newSubstageId, card.current_main_status, userId,
         `inbox_application #${app.id} → pre_tender_request #${preTenderId}` + (note ? '. ' + note : '')]);

      await client.query('COMMIT');

      // 10. SSE broadcast (после commit).
      try {
        broadcast('personal_kanban:card_converted', {
          card_id: cardId,
          owner_user_id: card.owner_user_id,
          flow_type: 'pre_tender',
          entity_kind: 'pre_tender',
          entity_id: preTenderId,
          from_entity_kind: 'inbox_application',
          from_entity_id: app.id,
          by_user_id: userId
        });
      } catch (_) {}

      // 11. Notification владельцу (если не сам конвертил).
      if (card.owner_user_id && card.owner_user_id !== userId) {
        try {
          Promise.resolve(createNotification(db, {
            user_id: card.owner_user_id,
            title: `Заявка №${app.id} → Pre-tender #${preTenderId}`,
            message: `Конвертирована в просчёт: ${customerName || 'клиент не указан'}`,
            type: 'pre_tender_created',
            link: `#/personal-kanban?card=${cardId}`,
          })).catch(() => {});
        } catch (_) {}
      }

      return {
        success: true,
        card: upd.rows[0],
        pre_tender_id: preTenderId,
        from_application_id: app.id,
        customer_name: ptIns.rows[0].customer_name
      };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      request.log.error({ err: e }, '[personal-kanban v3] convert-to-pretender failed');
      return reply.code(500).send({ error: 'convert_failed', message: e.message });
    } finally {
      client.release();
    }
  });

};

// Экспорт констант для тестов и других модулей (assign-pm берёт каноник)
module.exports.CANONICAL_MAIN_STATUSES = CANONICAL_MAIN_STATUSES;
module.exports.VALID_FLOW_TYPES = VALID_FLOW_TYPES;
module.exports.VALID_ENTITY_KINDS = VALID_ENTITY_KINDS;
module.exports.isValidMainStatus = isValidMainStatus;
module.exports.loadFirstActiveSubstage = loadFirstActiveSubstage;
module.exports.ensureDefaultSubstages = ensureDefaultSubstages;
module.exports.closeKanbanCardsForEntity = closeKanbanCardsForEntity;
