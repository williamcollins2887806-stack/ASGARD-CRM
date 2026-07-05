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
 *   GET    /cards/:id/reminders
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
    'new', 'in_review', 'need_docs', 'addendum', 'accepted', 'rejected', 'expired',
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

const REMINDER_KINDS = ['call', 'sms', 'meeting', 'task', 'email', 'other'];
const REMINDER_CHANNELS = ['inapp', 'whatsapp', 'max', 'email'];
const REMINDER_SELECT = `id, card_id, user_id, reminder_kind, event_at, lead_minutes, channels,
  title, remind_at, message, is_done, fired_at, notify_status, created_at`;

function normalizeReminderKind(v) {
  const k = String(v || 'task').toLowerCase();
  return REMINDER_KINDS.includes(k) ? k : null;
}

function normalizeReminderChannels(arr) {
  if (!Array.isArray(arr) || !arr.length) return ['inapp'];
  const uniq = [...new Set(
    arr.map((c) => String(c).toLowerCase()).filter((c) => REMINDER_CHANNELS.includes(c))
  )];
  return uniq.length ? uniq : ['inapp'];
}

function clampLeadMinutes(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 10080);
}

function computeRemindAt({ eventAt, leadMinutes, remindAt }) {
  const lead = clampLeadMinutes(leadMinutes);
  if (eventAt) {
    const ev = new Date(eventAt);
    if (!isNaN(ev.getTime())) return new Date(ev.getTime() - lead * 60000);
  }
  if (remindAt) {
    const ra = new Date(remindAt);
    if (!isNaN(ra.getTime())) return ra;
  }
  return null;
}

function parseReminderPayload(body) {
  const b = body || {};
  const kind = normalizeReminderKind(b.reminder_kind);
  if (!kind) return { error: 'invalid_reminder_kind' };

  const leadMinutes = clampLeadMinutes(b.lead_minutes);
  const eventAt = b.event_at ? new Date(b.event_at) : null;
  if (b.event_at && (!eventAt || isNaN(eventAt.getTime()))) {
    return { error: 'invalid_event_at' };
  }

  const remindAt = computeRemindAt({
    eventAt: eventAt ? eventAt.toISOString() : null,
    leadMinutes,
    remindAt: b.remind_at || null
  });
  if (!remindAt || isNaN(remindAt.getTime())) {
    return { error: 'invalid_remind_at' };
  }
  if (remindAt.getTime() < Date.now() - 60000) {
    return { error: 'remind_at_in_past' };
  }

  const channels = normalizeReminderChannels(b.channels);
  const message = b.message ? String(b.message).trim().slice(0, 500) : null;
  const title = b.title ? String(b.title).trim().slice(0, 200) : null;

  return {
    reminder_kind: kind,
    event_at: eventAt ? eventAt.toISOString() : remindAt.toISOString(),
    lead_minutes: leadMinutes,
    channels,
    remind_at: remindAt.toISOString(),
    message: message || null,
    title: title || null
  };
}

async function assertCardReminderAccess(db, cardId, userId, userRole) {
  const cur = await db.query(
    `SELECT owner_user_id FROM personal_kanban_cards WHERE id = $1`, [cardId]);
  if (!cur.rows[0]) return { error: 'not_found', status: 404 };
  const isOwner = cur.rows[0].owner_user_id === userId;
  const isManager = ['HEAD_PM', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(userRole);
  if (!isOwner && !isManager) return { error: 'forbidden', status: 403 };
  return { ownerUserId: cur.rows[0].owner_user_id, isOwner, isManager };
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
      // F2 + Wave B + v3 fix: вложения тоже отдаём (jsonb_agg), чтобы drawer не делал
      // второй запрос — иначе v3 канбан видит has_documents=true, но без имён файлов
      // блок «Документы» просто пуст.
      const r = await db.query(
        `SELECT pt.id,
                COALESCE(NULLIF(pt.work_description, ''),
                         NULLIF(pt.work_location, ''),
                         NULLIF(pt.customer_name, ''),
                         'Запрос #' || pt.id::text) AS title,
                pt.customer_name, pt.customer_email, pt.customer_inn,
                pt.contact_person, pt.contact_phone,
                pt.work_description, pt.work_location, pt.work_deadline,
                pt.estimated_sum,
                pt.ai_summary, pt.ai_color, pt.ai_recommendation, pt.ai_work_match_score,
                pt.has_documents, pt.manual_documents, pt.document_folders,
                pt.cost_planned, pt.kp_price_without_vat, pt.kp_price_with_vat,
                pt.vat_rate_pct, pt.margin_planned_pct,
                pt.email_id,
                pt.status, pt.created_tender_id, pt.assigned_to, pt.decision_comment, pt.reject_reason,
                pt.created_at,
                EXTRACT(EPOCH FROM (NOW() - pt.created_at))/86400 AS days_since_created,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'id', ea.id,
                    'filename', ea.filename,
                    'original_filename', ea.original_filename,
                    'mime_type', ea.mime_type,
                    'size', ea.size,
                    'file_path', ea.file_path
                  ) ORDER BY ea.id)
                  FROM email_attachments ea WHERE ea.email_id = pt.email_id
                ), '[]'::jsonb) AS email_attachments,
                (SELECT COUNT(*)::int FROM email_attachments ea WHERE ea.email_id = pt.email_id) AS email_attachments_count
           FROM pre_tender_requests pt WHERE pt.id = $1`, [entityId]);
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
      sql = `SELECT pt.id,
                    COALESCE(NULLIF(pt.work_description, ''),
                             NULLIF(pt.work_location, ''),
                             NULLIF(pt.customer_name, ''),
                             'Запрос #' || pt.id::text) AS title,
                    pt.customer_name, pt.customer_email, pt.customer_inn,
                    pt.contact_person, pt.contact_phone,
                    pt.work_description, pt.work_location, pt.work_deadline,
                    pt.estimated_sum,
                    pt.ai_summary, pt.ai_color, pt.ai_recommendation, pt.ai_work_match_score,
                    pt.has_documents, pt.manual_documents, pt.document_folders,
                pt.cost_planned, pt.kp_price_without_vat, pt.kp_price_with_vat,
                pt.vat_rate_pct, pt.margin_planned_pct,
                    pt.email_id,
                    pt.status, pt.created_tender_id, pt.assigned_to,
                    pt.created_at,
                    EXTRACT(EPOCH FROM (NOW() - pt.created_at))/86400 AS days_since_created,
                    -- JOIN email_attachments чтобы drawer v3 не делал второй fetch:
                    -- без этого UI видел has_documents=true, но не имел списка файлов.
                    COALESCE((
                      SELECT jsonb_agg(jsonb_build_object(
                        'id', ea.id,
                        'filename', ea.filename,
                        'original_filename', ea.original_filename,
                        'mime_type', ea.mime_type,
                        'size', ea.size,
                        'file_path', ea.file_path
                      ) ORDER BY ea.id)
                      FROM email_attachments ea WHERE ea.email_id = pt.email_id
                    ), '[]'::jsonb) AS email_attachments,
                    (SELECT COUNT(*)::int FROM email_attachments ea WHERE ea.email_id = pt.email_id) AS email_attachments_count
               FROM pre_tender_requests pt WHERE pt.id = ANY($1::int[])`;
    } else if (entityKind === 'work') {
      sql = `SELECT id, work_title AS title, customer_name,
                    work_status AS status, created_at,
                    EXTRACT(EPOCH FROM (NOW() - created_at))/86400 AS days_since_created
               FROM works WHERE id = ANY($1::int[])`;
    } else {
      return map;
    }
    const r = await db.query(sql, [cleanIds]);
    for (const row of r.rows) {
      if (entityKind === 'pre_tender') {
        const manual = Array.isArray(row.manual_documents) ? row.manual_documents : [];
        row.pm_documents = manual
          .map((d, idx) => ({ ...d, _idx: idx }))
          .filter((d) => d && d.generated_by !== 'mimir' && d.source !== 'mimir');
        row.finance = {
          cost_planned: row.cost_planned,
          kp_price_without_vat: row.kp_price_without_vat,
          kp_price_with_vat: row.kp_price_with_vat,
          vat_rate_pct: row.vat_rate_pct,
          margin_planned_pct: row.margin_planned_pct
        };
      }
      map.set(row.id, row);
    }
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
const V3_COLUMNS = ['new', 'calc', 'addendum', 'kp_prep', 'approval', 'sent', 'win', 'lose', 'work'];

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
      case 'addendum': return 'addendum';
      case 'kp_prep':  return 'approved';
      case 'approval': return 'pending_approval';
      case 'sent':     return 'pending_payment';
      case 'win':      return 'paid';
      case 'lose':     return 'rejected';
      default:         return undefined;
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
          AND (t_scope.calculator_user_id = $${params.length}
            OR t_scope.created_by_user_id = $${params.length}
            OR t_scope.created_by = $${params.length})
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
  // POST /cards/:cardId/update — inline-редактирование сущности через карту
  // ───────────────────────────────────────────────────────────────────
  // Карта v3 канбана даёт inline-форму (Клиент / Работа / Финансы).
  // Раньше UI шёл сюда POST'ом, но endpoint не существовал → 404 → данные не сохранялись
  // (это объясняло «карточка контрагента не заполнена» — Путков печатал и нажимал
  // 💾, но ничего не приходило в БД).
  // Прокси UPDATE на entity по типу: pre_tender → pre_tender_requests, tender → tenders.
  // RBAC: владелец карты или директор/HEAD_PM/HEAD_TO.
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/cards/:cardId/update', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const userRole = request.user.role;
    const cardId = asInt(request.params.cardId);
    if (cardId === null) return reply.code(400).send({ error: 'invalid_card_id' });

    const c = await db.query(
      `SELECT id, owner_user_id, entity_kind, entity_id FROM personal_kanban_cards WHERE id = $1`,
      [cardId]);
    if (!c.rows.length) return reply.code(404).send({ error: 'card_not_found' });
    const card = c.rows[0];

    const isPrivileged = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM', 'HEAD_TO'].includes(userRole);
    if (!isPrivileged && card.owner_user_id !== userId) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const body = request.body || {};
    let allowed;
    let table;
    let statusGuard = '';

    if (card.entity_kind === 'pre_tender') {
      table = 'pre_tender_requests';
      allowed = ['customer_name', 'customer_inn', 'customer_email',
                 'contact_person', 'contact_phone',
                 'work_description', 'work_location', 'work_deadline',
                 'estimated_sum',
                 'cost_planned', 'kp_price_without_vat', 'kp_price_with_vat',
                 'vat_rate_pct', 'margin_planned_pct'];
      const financeOnly = ['cost_planned', 'kp_price_without_vat', 'kp_price_with_vat',
                           'vat_rate_pct', 'margin_planned_pct']
        .some((k) => Object.prototype.hasOwnProperty.call(body, k));
      statusGuard = financeOnly
        ? ` AND status IN ('new','in_review','need_docs','addendum','approved','accepted','pending_approval')`
        : ` AND status IN ('new','in_review','need_docs','addendum')`;
    } else if (card.entity_kind === 'tender') {
      table = 'tenders';
      allowed = ['customer_name', 'customer_inn', 'customer_email',
                 'contact_person', 'contact_phone',
                 'work_description', 'work_location'];
    } else {
      // inbox_application / work — пока не правим через карту.
      return reply.code(400).send({ error: 'entity_not_editable', entity_kind: card.entity_kind });
    }

    const fields = [];
    const vals = [];
    let idx = 1;
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        let v = body[key];
        if (v === '' || v === undefined) v = null;
        fields.push(`${key} = $${idx++}`);
        vals.push(v);
      }
    }
    if (!fields.length) return reply.code(400).send({ error: 'no_fields' });

    fields.push(`updated_at = NOW()`);
    vals.push(card.entity_id);
    const res = await db.query(
      `UPDATE ${table} SET ${fields.join(', ')} WHERE id = $${idx}${statusGuard} RETURNING id`,
      vals);
    if (!res.rows.length) {
      return reply.code(409).send({ error: 'wrong_status_for_edit' });
    }

    // SSE — переиспользуем существующий канал.
    try {
      if (card.entity_kind === 'pre_tender') {
        broadcast('pre_tender:updated', { id: card.entity_id, updated_fields: fields });
      }
      broadcast('personal_kanban:card_updated', { card_id: cardId });
    } catch (_) {}

    return { ok: true, card_id: cardId, entity_kind: card.entity_kind, entity_id: card.entity_id };
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
              n.pos_x, n.pos_y, n.z_index, n.color_variant,
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

    // Случайные начальные координаты + следующий z_index
    const inB = request.body || {};
    const posX = Number.isFinite(Number(inB.pos_x)) ? Number(inB.pos_x) : Math.floor(Math.random()*120);
    const posY = Number.isFinite(Number(inB.pos_y)) ? Number(inB.pos_y) : Math.floor(Math.random()*160);
    const cv   = Number.isFinite(Number(inB.color_variant)) ? Number(inB.color_variant) % 5 : Math.floor(Math.random()*5);
    const zMax = await db.query(
      `SELECT COALESCE(MAX(z_index),0) AS z FROM personal_kanban_card_notes WHERE card_id=$1`, [id]);
    const zNext = Number(zMax.rows[0]?.z || 0) + 1;
    const ins = await db.query(
      `INSERT INTO personal_kanban_card_notes (card_id, author_id, body, pos_x, pos_y, z_index, color_variant)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, card_id, author_id, body, created_at, pos_x, pos_y, z_index, color_variant,
         (SELECT name FROM users WHERE id=$2) AS author_name`,
      [id, userId, body, posX, posY, zNext, cv]);
    return { success: true, item: ins.rows[0] };
  });

  // 22.06.2026: PATCH /cards/:cardId/notes/:noteId/position — drag-and-drop сохранение
  fastify.patch('/cards/:cardId/notes/:noteId/position', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const cardId = asInt(request.params.cardId);
    const noteId = asInt(request.params.noteId);
    if (cardId === null || noteId === null) return reply.code(400).send({ error: 'invalid_id' });
    const body = request.body || {};
    const posX = Number(body.pos_x);
    const posY = Number(body.pos_y);
    if (!Number.isFinite(posX) || !Number.isFinite(posY)) return reply.code(400).send({ error: 'pos_required' });
    // Поднимаем z-index чтобы перемещённый стикер был сверху
    const zMax = await db.query(
      `SELECT COALESCE(MAX(z_index),0) AS z FROM personal_kanban_card_notes WHERE card_id=$1`, [cardId]);
    const zNext = Number(zMax.rows[0]?.z || 0) + 1;
    const upd = await db.query(
      `UPDATE personal_kanban_card_notes
          SET pos_x=$1, pos_y=$2, z_index=$3
        WHERE id=$4 AND card_id=$5
        RETURNING id, pos_x, pos_y, z_index`,
      [Math.round(posX), Math.round(posY), zNext, noteId, cardId]);
    if (!upd.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return { success: true, item: upd.rows[0] };
  });

  // 22.06.2026: PUT /cards/:cardId/notes/:noteId — редактирование заметки
  fastify.put('/cards/:cardId/notes/:noteId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const userRole = request.user.role;
    const cardId = asInt(request.params.cardId);
    const noteId = asInt(request.params.noteId);
    if (cardId === null || noteId === null) return reply.code(400).send({ error: 'invalid_id' });
    const body = (request.body && request.body.body) ? String(request.body.body).trim() : '';
    if (body.length < 1 || body.length > 4000) {
      return reply.code(400).send({ error: 'invalid_body' });
    }
    const cur = await db.query(
      `SELECT n.author_id, pkc.owner_user_id FROM personal_kanban_card_notes n
        JOIN personal_kanban_cards pkc ON pkc.id = n.card_id
        WHERE n.id = $1 AND n.card_id = $2`, [noteId, cardId]);
    if (!cur.rows[0]) return reply.code(404).send({ error: 'not_found' });
    const isAuthor  = cur.rows[0].author_id === userId;
    const isOwner   = cur.rows[0].owner_user_id === userId;
    const isManager = ['HEAD_PM', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(userRole);
    if (!isAuthor && !isOwner && !isManager) return reply.code(403).send({ error: 'forbidden' });
    const upd = await db.query(
      `UPDATE personal_kanban_card_notes SET body=$1 WHERE id=$2
       RETURNING id, card_id, author_id, body, created_at, pos_x, pos_y, z_index, color_variant,
         (SELECT name FROM users WHERE id=author_id) AS author_name`,
      [body, noteId]);
    return { success: true, item: upd.rows[0] };
  });

  // 22.06.2026: DELETE /cards/:cardId/notes/:noteId — удаление заметки
  fastify.delete('/cards/:cardId/notes/:noteId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const userRole = request.user.role;
    const cardId = asInt(request.params.cardId);
    const noteId = asInt(request.params.noteId);
    if (cardId === null || noteId === null) return reply.code(400).send({ error: 'invalid_id' });
    const cur = await db.query(
      `SELECT n.author_id, pkc.owner_user_id FROM personal_kanban_card_notes n
        JOIN personal_kanban_cards pkc ON pkc.id = n.card_id
        WHERE n.id = $1 AND n.card_id = $2`, [noteId, cardId]);
    if (!cur.rows[0]) return reply.code(404).send({ error: 'not_found' });
    const isAuthor  = cur.rows[0].author_id === userId;
    const isOwner   = cur.rows[0].owner_user_id === userId;
    const isManager = ['HEAD_PM', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(userRole);
    if (!isAuthor && !isOwner && !isManager) return reply.code(403).send({ error: 'forbidden' });
    await db.query(`DELETE FROM personal_kanban_card_notes WHERE id = $1`, [noteId]);
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /cards/:id/reminders
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/cards/:id/reminders', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const userRole = request.user.role;
    const id = asInt(request.params.id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });

    const access = await assertCardReminderAccess(db, id, userId, userRole);
    if (access.error) return reply.code(access.status).send({ error: access.error });

    const r = await db.query(
      `SELECT ${REMINDER_SELECT}
         FROM personal_kanban_card_reminders
        WHERE card_id = $1
        ORDER BY is_done ASC, remind_at ASC`,
      [id]);
    return { success: true, items: r.rows };
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /cards/:id/reminders
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/cards/:id/reminders', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const id = asInt(request.params.id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });

    const access = await assertCardReminderAccess(db, id, userId, request.user.role);
    if (access.error) return reply.code(access.status).send({ error: access.error });
    if (!access.isOwner) return reply.code(403).send({ error: 'forbidden' });

    const parsed = parseReminderPayload(request.body);
    if (parsed.error) return reply.code(400).send({ error: parsed.error });

    const ins = await db.query(
      `INSERT INTO personal_kanban_card_reminders
         (card_id, user_id, reminder_kind, event_at, lead_minutes, channels, title, remind_at, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${REMINDER_SELECT}`,
      [
        id, userId, parsed.reminder_kind, parsed.event_at, parsed.lead_minutes,
        parsed.channels, parsed.title, parsed.remind_at, parsed.message
      ]);
    return { success: true, item: ins.rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /cards/:id/reminders/:rid
  // ═══════════════════════════════════════════════════════════════════
  fastify.patch('/cards/:id/reminders/:rid', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const id = asInt(request.params.id);
    const rid = asInt(request.params.rid);
    if (id === null || rid === null) return reply.code(400).send({ error: 'invalid_id' });
    const body = request.body || {};

    const cur = await db.query(
      `SELECT ${REMINDER_SELECT}
         FROM personal_kanban_card_reminders
        WHERE id = $1 AND card_id = $2 AND user_id = $3`,
      [rid, id, userId]);
    if (!cur.rows[0]) return reply.code(404).send({ error: 'not_found_or_forbidden' });

    const existing = cur.rows[0];
    const sets = [];
    const vals = [];
    let idx = 1;

    if (body.is_done !== undefined) {
      sets.push(`is_done = $${idx++}`);
      vals.push(!!body.is_done);
    }

    const hasScheduleEdit = ['reminder_kind', 'event_at', 'lead_minutes', 'channels', 'message', 'title', 'remind_at']
      .some((k) => body[k] !== undefined);

    if (hasScheduleEdit) {
      const merged = {
        reminder_kind: body.reminder_kind !== undefined ? body.reminder_kind : existing.reminder_kind,
        event_at: body.event_at !== undefined ? body.event_at : existing.event_at,
        lead_minutes: body.lead_minutes !== undefined ? body.lead_minutes : existing.lead_minutes,
        channels: body.channels !== undefined ? body.channels : existing.channels,
        message: body.message !== undefined ? body.message : existing.message,
        title: body.title !== undefined ? body.title : existing.title,
        remind_at: body.remind_at !== undefined ? body.remind_at : null
      };
      const parsed = parseReminderPayload(merged);
      if (parsed.error) return reply.code(400).send({ error: parsed.error });

      sets.push(`reminder_kind = $${idx++}`); vals.push(parsed.reminder_kind);
      sets.push(`event_at = $${idx++}`); vals.push(parsed.event_at);
      sets.push(`lead_minutes = $${idx++}`); vals.push(parsed.lead_minutes);
      sets.push(`channels = $${idx++}`); vals.push(parsed.channels);
      sets.push(`title = $${idx++}`); vals.push(parsed.title);
      sets.push(`remind_at = $${idx++}`); vals.push(parsed.remind_at);
      sets.push(`message = $${idx++}`); vals.push(parsed.message);

      const remindChanged = new Date(parsed.remind_at).getTime() !== new Date(existing.remind_at).getTime();
      if (remindChanged && !existing.is_done) {
        sets.push(`fired_at = NULL`);
        sets.push(`notify_status = NULL`);
      }
    }

    if (!sets.length) return reply.code(400).send({ error: 'nothing_to_update' });

    vals.push(rid, id, userId);
    const r = await db.query(
      `UPDATE personal_kanban_card_reminders
          SET ${sets.join(', ')}
        WHERE id = $${idx++} AND card_id = $${idx++} AND user_id = $${idx}
        RETURNING ${REMINDER_SELECT}`,
      vals);
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

    // 3. ДЕДУПЛИКАЦИЯ: ищем активную сессию по pre_tender_id / tender_id.
    //    Если есть в неконечном статусе (не finalized/abandoned) — возвращаем её,
    //    чтобы PM продолжил с того места. Если body.fresh=true — сначала помечаем
    //    старую как 'abandoned' и создаём новую (кнопка «Пересчёт с нуля»).
    const fresh = !!(request.body && request.body.fresh);
    if (!fresh && (preTenderId || tenderId)) {
      try {
        const dedupeCol = preTenderId ? 'pre_tender_id' : 'tender_id';
        const dedupeVal = preTenderId || tenderId;
        const exist = await db.query(
          `SELECT id, session_uid, status FROM tkp_quick_sessions
            WHERE author_id = $1 AND ${dedupeCol} = $2
              AND status NOT IN ('finalized','abandoned')
            ORDER BY id DESC LIMIT 1`,
          [card.owner_user_id, dedupeVal]);
        if (exist.rows[0]) {
          return {
            success: true,
            session_uid: exist.rows[0].session_uid,
            session_id: Number(exist.rows[0].id),
            status: 'existing',
            session_status: exist.rows[0].status
          };
        }
      } catch (e) {
        request.log.warn({ err: e }, '[personal-kanban] start-quick: dedupe lookup failed');
      }
    }
    if (fresh && (preTenderId || tenderId)) {
      // Помечаем все активные сессии этого автора по entity как abandoned —
      // чтобы дедуп-лукап выше не возвращал их в будущем.
      try {
        const dedupeCol = preTenderId ? 'pre_tender_id' : 'tender_id';
        const dedupeVal = preTenderId || tenderId;
        await db.query(
          `UPDATE tkp_quick_sessions
              SET status = 'abandoned', updated_at = NOW()
            WHERE author_id = $1 AND ${dedupeCol} = $2
              AND status NOT IN ('finalized','abandoned')`,
          [card.owner_user_id, dedupeVal]);
      } catch (e) {
        request.log.warn({ err: e }, '[personal-kanban] start-quick: abandon previous failed');
      }
    }

    // 4. INSERT новой tkp_quick_sessions.
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
        session_id: Number(ins.rows[0].id),
        status: 'created'
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
    //    Для pre_tender — если ещё нет linked tender, создаём draft tender прямо здесь:
    //    runConductor работает с tender_id (агенты лезут в tenders), pre_tender для него
    //    непригоден. Без этого conductor возвращал DRAFT и зависал.
    let tenderId = null;
    let workId = null;
    let preTenderId = null;
    if (card.entity_kind === 'tender') tenderId = card.entity_id;
    else if (card.entity_kind === 'work') workId = card.entity_id;
    else if (card.entity_kind === 'pre_tender') {
      preTenderId = card.entity_id;
      let pt = null;
      try {
        const r = await db.query(
          `SELECT id, created_tender_id, customer_name, customer_inn, work_description,
                  work_location, work_deadline, estimated_sum, assigned_to, contact_person, contact_phone
             FROM pre_tender_requests WHERE id = $1`, [card.entity_id]);
        pt = r.rows[0] || null;
      } catch (_) {}

      if (pt && pt.created_tender_id) {
        tenderId = pt.created_tender_id;
      } else if (pt) {
        // Создаём минимальный draft tender — Mimir-Кондуктору нужен tender_id.
        // Все обязательные поля заполняем из pre_tender_request с разумными дефолтами.
        try {
          // tenders.period — varchar(20). Берём только месяц-год запроса или ставим пусто.
          // (раньше пихал work_description ~250 chars → 22001 value too long)
          const periodShort = (new Date()).toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' }).slice(0, 20);
          const customerInn20 = pt.customer_inn ? String(pt.customer_inn).slice(0, 20) : null;
          const ins = await db.query(
            `INSERT INTO tenders
              (customer_name, customer_inn, tender_type, tender_status,
               tender_price, docs_deadline, responsible_pm_id,
               comment_to, period, created_by, created_at)
             VALUES ($1, $2, $3, 'Новый', $4, $5, $6, $7, $8, $9, NOW())
             RETURNING id`,
            [
              pt.customer_name || 'Не указан',
              customerInn20,
              'Прямой запрос',
              pt.estimated_sum || null,
              pt.work_deadline || null,
              pt.assigned_to || userId,
              `Авто-tender из pre_tender #${pt.id} (Mimir-Conductor)`,
              periodShort,
              userId
            ]);
          tenderId = Number(ins.rows[0].id);
          // Связываем обратно.
          try {
            await db.query(
              `UPDATE pre_tender_requests SET created_tender_id = $1, updated_at = NOW() WHERE id = $2`,
              [tenderId, preTenderId]);
          } catch (e) {
            request.log.warn({ err: e }, '[personal-kanban] start-conductor: link pre_tender→tender failed');
          }
          // КОПИРУЕМ email_attachments как documents для tender — иначе Mimir-Conductor
          // (work_scope_researcher) не видит ТЗ из письма и задаёт ложный вопрос
          // «не удалось извлечь перечень работ — пришлите ТЗ» при том что ТЗ уже есть.
          try {
            const eaRes = await db.query(
              `SELECT ea.id, ea.original_filename, ea.filename, ea.mime_type, ea.size, ea.file_path
                 FROM email_attachments ea
                 JOIN pre_tender_requests pt ON pt.email_id = ea.email_id
                WHERE pt.id = $1`, [preTenderId]);
            for (const att of eaRes.rows) {
              await db.query(
                `INSERT INTO documents
                   (filename, original_name, mime_type, size, type, tender_id, uploaded_by_user_id, file_url, created_at)
                 VALUES ($1, $2, $3, $4, 'attachment', $5, $6, $7, NOW())
                 ON CONFLICT DO NOTHING`,
                [att.filename || att.original_filename,
                 att.original_filename || att.filename,
                 att.mime_type, att.size, tenderId, userId,
                 ('/' + String(att.file_path || '').replace(/^\/+/, ''))]);
            }
            request.log.info(
              `[personal-kanban] start-conductor: copied ${eaRes.rows.length} email_attachments → documents for tender #${tenderId}`);
          } catch (e) {
            request.log.warn({ err: e },
              '[personal-kanban] start-conductor: copy email_attachments → documents failed');
          }
        } catch (e) {
          request.log.error({ err: e }, '[personal-kanban] start-conductor: tender draft create failed');
          return reply.code(500).send({
            error: 'tender_draft_failed',
            message: 'Не удалось создать tender draft для Conductor: ' + e.message
          });
        }
      }
    }

    // 3. Проверяем активный run по (tender_id | work_id).
    //    body.fresh=true — кнопка «Пересчёт с нуля»: отменяем активный run и создаём новый.
    const cFresh = !!(request.body && request.body.fresh);
    if (!cFresh && (tenderId || workId)) {
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
    if (cFresh && (tenderId || workId)) {
      const dedupeCol = tenderId ? 'tender_id' : 'work_id';
      const dedupeVal = tenderId || workId;
      try {
        await db.query(
          `UPDATE mimir_conductor_runs
              SET status='CANCELLED', updated_at=NOW()
            WHERE ${dedupeCol} = $1
              AND status NOT IN ('READY_FOR_REVIEW','ERROR','APPROVED','REJECTED','CANCELLED')`,
          [dedupeVal]);
      } catch (e) {
        request.log.warn({ err: e }, '[personal-kanban] start-conductor: cancel previous failed');
      }
    }

    // 4. INSERT нового run'a + ЗАПУСК runConductor (fire-and-forget).
    //    Без runConductor запись зависала в DRAFT — фронт получал run_id, но AI-цикл
    //    не стартовал, журнал SSE оставался пустым. Теперь повторяем паттерн из
    //    /api/mimir/conductor/start: setImmediate + try/catch с записью ERROR.
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
      const runId = Number(ins.rows[0].id);

      // Запускаем AI-цикл — асинхронно, не блокируем ответ.
      // Берём require лениво, чтобы не валить инициализацию роута если сервис недоступен.
      setImmediate(() => {
        let runConductor;
        try { ({ runConductor } = require('../services/mimir-conductor/conductor')); }
        catch (e) {
          request.log.error({ err: e }, '[personal-kanban] start-conductor: load conductor service failed');
          return;
        }
        const mode = String(request.body?.mode || '').toLowerCase() === 'deterministic'
          ? 'deterministic' : 'conductor';
        runConductor(runId, { mode }).catch(async (err) => {
          const cr = require('../services/mimir-conductor/conductor-run');
          try {
            await cr.updateRunStatus(runId, 'ERROR', {
              errorMessage: String(err && err.message ? err.message : err)
            });
            await cr.addEvent(runId, null, 'error', {
              message: String(err && err.message ? err.message : err),
              stage: 'runConductor'
            });
          } catch (inner) {
            request.log.error(`[personal-kanban] не удалось записать ERROR для run ${runId}: ${inner.message}`);
          }
        });
      });

      return {
        success: true,
        run_id: runId,
        status: 'created',
        run_status: ins.rows[0].status,
        tender_id: tenderId,
        ...(preTenderId ? { pre_tender_id: preTenderId } : {})
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
                c.substage_title, c.substage_color, c.substage_sort_order,
                u.name as owner_name,
                ('#' || c.id::text) as code
           FROM v_unified_kanban_cards c
           LEFT JOIN users u ON u.id = c.owner_user_id
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

    // Группировка по 8 колонкам.
    // Снимок сущности (snap) сплющиваем в верхний уровень карты, чтобы UI vanilla v3
    // и React BoardV3 могли читать card.customer_name / card.email_attachments / etc.
    // напрямую (без card.entity.*). До этого фикса drawer открывался с пустыми инпутами
    // и пустой секцией «Документы», хотя SQL-аггрегат уже отдавал данные правильно —
    // они просто оседали в card.entity и UI до них не доходил.
    // row побеждает по конфликтным ключам (id/entity_id/v3_column).
    // Группировка по 9 колонкам (V250 добавил 'addendum').
    const columns = { new: [], calc: [], approval: [], kp_prep: [], sent: [], addendum: [], win: [], lose: [], work: [] };
    for (const row of rows) {
      const map = snapshotsByKind[row.entity_kind];
      const snap = (map && row.entity_id != null) ? (map.get(row.entity_id) || null) : null;
      const card = { ...(snap || {}), ...row, entity: snap };
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
    let toCol = body.to_v3_column ? String(body.to_v3_column) : null;
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
      let newMainStatus = mapped === null ? card.current_main_status : mapped;

      // 22.06.2026: ПОРОГ СОГЛАСОВАНИЯ 50 МЛН + проверка наличия ТКП.
      // При попытке РП перевести pre_tender в approval — backend сам решает:
      //   - нет ни одного ТКП → 400 "Сначала создайте ТКП"
      //   - есть ТКП и max(total_sum) < 50M → автопереход в kp_prep (директор не нужен)
      //   - есть ТКП и max(total_sum) >= 50M → продолжаем в approval + уведомления
      let priceUsed = null;
      let autoPromotedFromApproval = false;
      const APPROVAL_THRESHOLD_RUB = 50_000_000;
      if (toCol === 'approval' && card.entity_kind === 'pre_tender' && card.entity_id) {
        const tkpRes = await client.query(
          `SELECT COALESCE(MAX(total_sum), 0)::numeric AS max_sum, COUNT(*)::int AS cnt
             FROM tkp WHERE pre_tender_id = $1`, [card.entity_id]);
        const tkpCnt = tkpRes.rows[0].cnt;
        const tkpMax = Number(tkpRes.rows[0].max_sum) || 0;
        if (tkpCnt === 0) {
          const finRes = await client.query(
            `SELECT cost_planned, kp_price_without_vat, kp_price_with_vat
               FROM pre_tender_requests WHERE id = $1`, [card.entity_id]);
          const fin = finRes.rows[0] || {};
          const manualOk = (fin.cost_planned != null && fin.kp_price_without_vat != null);
          if (!manualOk) {
            await client.query('ROLLBACK');
            return reply.code(400).send({
              error: 'tkp_required',
              message: 'Сначала создайте ТКП или заполните финансы вручную (с/с и цена КП)'
            });
          }
        }
        if (tkpCnt > 0) {
          const ptRes = await client.query(
            `SELECT COALESCE(estimated_sum, 0)::numeric AS est_sum
               FROM pre_tender_requests WHERE id = $1`, [card.entity_id]);
          const ptEst = Number(ptRes.rows[0]?.est_sum) || 0;
          priceUsed = Math.max(tkpMax, ptEst);
          if (priceUsed < APPROVAL_THRESHOLD_RUB) {
            toCol = 'kp_prep';
            newMainStatus = v3ColumnToMainStatus('kp_prep', card.flow_type, card.current_main_status);
            autoPromotedFromApproval = true;
          }
        }
      }

      // Текущая колонка (для cross-column гарда). Используем функцию pk_v3_column из V238.
      // FIX B3: SAVEPOINT — если pk_v3_column не существует, не валим транзакцию.
      let currentCol = null;
      try {
        await client.query(`SAVEPOINT sp_v3col`);
        const curColRes = await client.query(
          `SELECT pk_v3_column($1, $2) AS col`,
          [card.flow_type, card.current_main_status]);
        currentCol = curColRes.rows[0]?.col || null;
        await client.query(`RELEASE SAVEPOINT sp_v3col`);
      } catch (e) {
        await client.query(`ROLLBACK TO SAVEPOINT sp_v3col`).catch(() => {});
        console.warn('[transition] pk_v3_column unavailable, force confirm:', e.message);
        // Без функции v3 — всегда требуем confirm, чтобы не было ложных переходов.
      }
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
            // Tenders: tender_status + registry_status + кэш дат (kp_sent_at, won_at, lost_at — V117/V236).
            const { syncRegistryStatus } = require('../services/tender-registry-helpers');
            const regSt = syncRegistryStatus(newMainStatus);
            const sets = ['tender_status = $1', 'updated_at = now()'];
            const ps = [newMainStatus];
            if (regSt) {
              sets.push(`registry_status = $${ps.length + 1}`);
              ps.push(regSt);
            }
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

      // NEW: Авто-создание работы при переходе tender → win.
      // Пользовательское требование: "клиент согласился, выиграли → автоматическое
      // создание работы на данного РП". Получает карта канбана РП на работу.
      if (toCol === 'win' && card.entity_kind === 'tender' && card.entity_id) {
        try {
          await client.query(`SAVEPOINT sp_autowork`);
          // 1. Не дублировать: если работа уже привязана к тендеру — пропускаем.
          const existsW = await client.query(
            `SELECT id FROM works WHERE tender_id = $1 AND deleted_at IS NULL LIMIT 1`,
            [card.entity_id]);
          if (existsW.rows.length === 0) {
            // 2. Подтянуть данные тендера для prefill works.
            const tRes = await client.query(
              `SELECT id, tender_title, customer_name, customer_inn,
                      customer_email, contact_person, contact_phone,
                      responsible_pm_id, work_assigned_pm_id,
                      tender_price, kp_price_without_vat, kp_price_with_vat,
                      cost_planned, work_start_plan, work_end_plan, period,
                      source_pre_tender_id
                 FROM tenders WHERE id = $1`,
              [card.entity_id]);
            const t = tRes.rows[0];
            if (t) {
              const pmId = t.work_assigned_pm_id || t.responsible_pm_id || card.owner_user_id;
              // 3. INSERT работы — только реально существующие колонки `works` (V001 + V117 + V235).
              // FIX (post-audit): в works НЕТ колонок kp_price_without_vat/kp_price_with_vat/cost_planned/
              // end_date_plan — они в pre_tender_requests/tenders (V236), а works ещё не расширяли.
              // Кладём финансы в contract_value (норма для works).
              const wIns = await client.query(`
                INSERT INTO works (
                  tender_id, pm_id,
                  work_title, work_status, work_number,
                  customer_name, customer_inn, customer_email, contact_person, contact_phone,
                  contract_value,
                  start_plan, end_plan,
                  source_pre_tender_id,
                  created_by, created_at
                ) VALUES (
                  $1, $2,
                  $3, 'Новая', $4,
                  $5, $6, $7, $8, $9,
                  $10,
                  $11, $12,
                  $13,
                  $14, now()
                ) RETURNING id, work_title
              `, [
                t.id, pmId,
                t.tender_title || 'Работа из тендера #' + t.id, 'W-' + Date.now(),
                t.customer_name, t.customer_inn, t.customer_email, t.contact_person, t.contact_phone,
                t.kp_price_with_vat || t.kp_price_without_vat || t.tender_price || null,
                t.work_start_plan, t.work_end_plan,
                t.source_pre_tender_id || null,
                userId,
              ]);
              const newWorkId = wIns.rows[0].id;
              sideEffects.auto_created_work_id = newWorkId;
              sideEffects.auto_created_work_title = wIns.rows[0].work_title;

              // 4. UPDATE tenders.work_assigned_pm_id (для согласованности с tenders.js:1839 паттерном).
              try {
                await client.query(`SAVEPOINT sp_twapm`);
                await client.query(
                  `UPDATE tenders SET work_assigned_pm_id = $1, work_assigned_at = now(), work_assigned_by_user_id = $2 WHERE id = $3`,
                  [pmId, userId, t.id]);
                await client.query(`RELEASE SAVEPOINT sp_twapm`);
              } catch (_) {
                await client.query(`ROLLBACK TO SAVEPOINT sp_twapm`).catch(() => {});
              }

              request.log.info({ tender_id: t.id, work_id: newWorkId, pm_id: pmId },
                '[personal-kanban v3] auto-created work on tender win');

              // 30.06.2026 FIX: создаём work-карточку в личном канбане PM, иначе работа
              // существует в БД, но в колонке «В работе» её нет. Паритет с tenders.js
              // assign-work-pm (CONVERT/CREATE). Берём текущую tender-карту PM и конвертим,
              // иначе создаём новую work-карту.
              try {
                await client.query(`SAVEPOINT sp_workcard`);
                const firstSub = await loadFirstActiveSubstage(client, pmId, 'work', 'Подготовка');
                if (pmId === card.owner_user_id) {
                  // Конвертируем эту же tender-карту в work-карту.
                  await client.query(
                    `UPDATE personal_kanban_cards
                        SET entity_kind='work', entity_id=$1, flow_type='work',
                            current_main_status='Подготовка', current_substage_id=$2,
                            last_moved_at=now(), version=version+1, updated_at=now()
                      WHERE id=$3`,
                    [newWorkId, firstSub, id]);
                  await client.query(
                    `INSERT INTO personal_kanban_card_history
                      (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, note, action)
                     VALUES ($1, $2, $3, $4, 'Подготовка', $5, $6, 'convert')`,
                    [id, card.current_substage_id, firstSub, newMainStatus, userId,
                     `auto: tender ${t.id} win → work ${newWorkId}`]);
                  sideEffects.work_card_id = id;
                  sideEffects.work_card_action = 'convert';
                } else {
                  // Работа назначена другому PM — создаём ему отдельную work-карту.
                  const wc = await client.query(
                    `INSERT INTO personal_kanban_cards
                      (owner_user_id, flow_type, entity_kind, entity_id,
                       current_main_status, current_substage_id, last_moved_at, version)
                     VALUES ($1, 'work', 'work', $2, 'Подготовка', $3, now(), 1)
                     ON CONFLICT (owner_user_id, entity_kind, entity_id) DO NOTHING
                     RETURNING id`,
                    [pmId, newWorkId, firstSub]);
                  if (wc.rows[0]) {
                    await client.query(
                      `INSERT INTO personal_kanban_card_history
                        (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, note, action)
                       VALUES ($1, NULL, $2, NULL, 'Подготовка', $3, $4, 'create')`,
                      [wc.rows[0].id, firstSub, userId, `auto: tender ${t.id} win → work ${newWorkId}`]);
                    sideEffects.work_card_id = wc.rows[0].id;
                    sideEffects.work_card_action = 'create';
                  }
                }
                await client.query(`RELEASE SAVEPOINT sp_workcard`);
              } catch (wcErr) {
                await client.query(`ROLLBACK TO SAVEPOINT sp_workcard`).catch(() => {});
                request.log.warn({ err: wcErr, work_id: newWorkId },
                  '[personal-kanban v3] work-card create failed (tender win)');
                sideEffects.work_card_error = wcErr.message;
              }
            }
          } else {
            sideEffects.auto_work_skipped = 'already_exists';
          }
          await client.query(`RELEASE SAVEPOINT sp_autowork`);
        } catch (e) {
          await client.query(`ROLLBACK TO SAVEPOINT sp_autowork`).catch(() => {});
          request.log.warn({ err: e, card_id: id, tender_id: card.entity_id },
            '[personal-kanban v3] auto-create work failed');
          sideEffects.auto_work_error = e.message;
        }
      }

      // NEW (30.06.2026): Авто-создание работы при переходе pre_tender → win.
      // Пользовательское требование: заявка остаётся заявкой (НЕ конвертируется в тендер),
      // проходит весь путь сама, а "клиент согласился → Выиграли" создаёт работу напрямую
      // из заявки. Связь — works.source_pre_tender_id (tender_id остаётся NULL).
      if (toCol === 'win' && card.entity_kind === 'pre_tender' && card.entity_id) {
        try {
          await client.query(`SAVEPOINT sp_autowork_pt`);
          // 1. Не дублировать: работа уже привязана к этой заявке?
          const existsW = await client.query(
            `SELECT id FROM works WHERE source_pre_tender_id = $1 AND deleted_at IS NULL LIMIT 1`,
            [card.entity_id]);
          if (existsW.rows.length === 0) {
            // 2. Подтянуть данные заявки для prefill works.
            const ptRes = await client.query(
              `SELECT id, customer_name, customer_inn, customer_email,
                      contact_person, contact_phone, work_description,
                      work_location, work_deadline, estimated_sum, assigned_to
                 FROM pre_tender_requests WHERE id = $1`,
              [card.entity_id]);
            const pt = ptRes.rows[0];
            if (pt) {
              const pmId = pt.assigned_to || card.owner_user_id;
              const wIns = await client.query(`
                INSERT INTO works (
                  tender_id, pm_id,
                  work_title, work_status, work_number,
                  customer_name, customer_inn, customer_email, contact_person, contact_phone,
                  contract_value,
                  end_plan,
                  source_pre_tender_id,
                  created_by, created_at
                ) VALUES (
                  NULL, $1,
                  $2, 'Новая', $3,
                  $4, $5, $6, $7, $8,
                  $9,
                  $10,
                  $11,
                  $12, now()
                ) RETURNING id, work_title
              `, [
                pmId,
                pt.work_description || ('Работа из заявки #' + pt.id), 'W-' + Date.now(),
                pt.customer_name, pt.customer_inn, pt.customer_email, pt.contact_person, pt.contact_phone,
                pt.estimated_sum || null,
                pt.work_deadline || null,
                pt.id,
                userId,
              ]);
              const newWorkId = wIns.rows[0].id;
              sideEffects.auto_created_work_id = newWorkId;
              sideEffects.auto_created_work_title = wIns.rows[0].work_title;
              request.log.info({ pre_tender_id: pt.id, work_id: newWorkId, pm_id: pmId },
                '[personal-kanban v3] auto-created work on pre_tender win');

              // 30.06.2026 FIX: создаём work-карточку в личном канбане PM, иначе работа
              // не появится в колонке «В работе». Конвертируем эту же pre_tender-карту,
              // если работа назначена тому же владельцу, иначе создаём новую.
              try {
                await client.query(`SAVEPOINT sp_workcard_pt`);
                const firstSub = await loadFirstActiveSubstage(client, pmId, 'work', 'Подготовка');
                if (pmId === card.owner_user_id) {
                  await client.query(
                    `UPDATE personal_kanban_cards
                        SET entity_kind='work', entity_id=$1, flow_type='work',
                            current_main_status='Подготовка', current_substage_id=$2,
                            last_moved_at=now(), version=version+1, updated_at=now()
                      WHERE id=$3`,
                    [newWorkId, firstSub, id]);
                  await client.query(
                    `INSERT INTO personal_kanban_card_history
                      (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, note, action)
                     VALUES ($1, $2, $3, $4, 'Подготовка', $5, $6, 'convert')`,
                    [id, card.current_substage_id, firstSub, newMainStatus, userId,
                     `auto: заявка ${pt.id} win → work ${newWorkId}`]);
                  sideEffects.work_card_id = id;
                  sideEffects.work_card_action = 'convert';
                } else {
                  const wc = await client.query(
                    `INSERT INTO personal_kanban_cards
                      (owner_user_id, flow_type, entity_kind, entity_id,
                       current_main_status, current_substage_id, last_moved_at, version)
                     VALUES ($1, 'work', 'work', $2, 'Подготовка', $3, now(), 1)
                     ON CONFLICT (owner_user_id, entity_kind, entity_id) DO NOTHING
                     RETURNING id`,
                    [pmId, newWorkId, firstSub]);
                  if (wc.rows[0]) {
                    await client.query(
                      `INSERT INTO personal_kanban_card_history
                        (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, note, action)
                       VALUES ($1, NULL, $2, NULL, 'Подготовка', $3, $4, 'create')`,
                      [wc.rows[0].id, firstSub, userId, `auto: заявка ${pt.id} win → work ${newWorkId}`]);
                    sideEffects.work_card_id = wc.rows[0].id;
                    sideEffects.work_card_action = 'create';
                  }
                }
                await client.query(`RELEASE SAVEPOINT sp_workcard_pt`);
              } catch (wcErr) {
                await client.query(`ROLLBACK TO SAVEPOINT sp_workcard_pt`).catch(() => {});
                request.log.warn({ err: wcErr, work_id: newWorkId },
                  '[personal-kanban v3] work-card create failed (pre_tender win)');
                sideEffects.work_card_error = wcErr.message;
              }
            }
          } else {
            sideEffects.auto_work_skipped = 'already_exists';
          }
          await client.query(`RELEASE SAVEPOINT sp_autowork_pt`);
        } catch (e) {
          await client.query(`ROLLBACK TO SAVEPOINT sp_autowork_pt`).catch(() => {});
          request.log.warn({ err: e, card_id: id, pre_tender_id: card.entity_id },
            '[personal-kanban v3] auto-create work (pre_tender) failed');
          sideEffects.auto_work_error = e.message;
        }
      }

      // 22.06.2026: при переходе в approval — записать approval_requested_by/at
      // и уведомить всех директоров + HEAD_PM, чтобы они увидели карту в очереди.
      if (toCol === 'approval' && card.entity_kind === 'pre_tender' && card.entity_id) {
        try {
          await client.query(`SAVEPOINT sp_approval_meta`);
          await client.query(
            `UPDATE pre_tender_requests
                SET approval_requested_by = $1,
                    approval_requested_at = NOW(),
                    approval_comment = COALESCE($2, approval_comment)
              WHERE id = $3`,
            [userId, note, card.entity_id]);
          await client.query(`RELEASE SAVEPOINT sp_approval_meta`);
        } catch (e) {
          await client.query(`ROLLBACK TO SAVEPOINT sp_approval_meta`).catch(() => {});
          request.log.warn({ err: e }, '[transition] approval_meta update failed');
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

      // Уведомления директорам/HEAD_PM при подаче на согласование
      if (toCol === 'approval' && card.entity_kind === 'pre_tender' && card.entity_id) {
        try {
          const dirRes = await db.query(
            `SELECT id FROM users
              WHERE role = ANY($1::text[]) AND is_active = true AND COALESCE(is_blocked,false) = false`,
            [['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM']]);
          const ptInfo = await db.query(
            `SELECT customer_name, work_description FROM pre_tender_requests WHERE id=$1`,
            [card.entity_id]);
          const meta = ptInfo.rows[0] || {};
          const priceStr = priceUsed != null
            ? Math.round(priceUsed).toLocaleString('ru-RU') + ' ₽'
            : null;
          const titleStr = `⚖️ Заявка №${card.entity_id} на согласовании`;
          const msgStr = (meta.customer_name || meta.work_description?.slice(0, 100) || '—')
            + (priceStr ? ` · ${priceStr}` : '');
          for (const r of dirRes.rows) {
            Promise.resolve(createNotification(db, {
              user_id: r.id,
              title: titleStr,
              message: msgStr,
              type: 'pre_tender_approval_required',
              link: `#/personal-kanban?card=${id}&col=approval`,
            })).catch(() => {});
          }
          broadcast('pre_tender:approval_requested', {
            card_id: id, pre_tender_id: card.entity_id,
            requested_by: userId, price: priceUsed
          });
        } catch (e) {
          request.log.warn({ err: e }, '[transition] approval notify failed');
        }
      }

      return {
        success: true,
        item: upd.rows[0],
        to_v3_column: toCol,
        side_effects: sideEffects,
        price_used: priceUsed,
        auto_promoted_from_approval: autoPromotedFromApproval || undefined,
      };
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
      // FIX B2: SAVEPOINT — без него Postgres переводит транзакцию в aborted state.
      if (app.email_id) {
        try {
          await client.query(`SAVEPOINT sp_emails_link`);
          await client.query(`UPDATE emails SET pre_tender_id = $1 WHERE id = $2`, [preTenderId, app.email_id]);
          await client.query(`RELEASE SAVEPOINT sp_emails_link`);
        } catch (_) {
          await client.query(`ROLLBACK TO SAVEPOINT sp_emails_link`).catch(() => {});
        }
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
      // FIX B2: SAVEPOINT — без него ROLLBACK всей транзакции.
      try {
        await client.query(`SAVEPOINT sp_inbox_link`);
        await client.query(
          `UPDATE inbox_applications SET linked_pre_tender_id = $1 WHERE id = $2`,
          [preTenderId, app.id]);
        await client.query(`RELEASE SAVEPOINT sp_inbox_link`);
      } catch (_) {
        await client.query(`ROLLBACK TO SAVEPOINT sp_inbox_link`).catch(() => {});
      }

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
