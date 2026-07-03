'use strict';

const DEFAULT_START_NUMBER = 1;
const OUTGOING_PREFIX = '';
const OUTGOING_START_SETTING_KEY = 'correspondence_outgoing_start_number';
const COMPANY_PROFILE_SETTING_KEY = 'company_profile';
const DEFAULT_OUTGOING_PREFIX = 'АС-';

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

function normalizeDateParts(input) {
  if (typeof input === 'string') {
    const match = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return {
        date: `${match[1]}-${match[2]}-${match[3]}`,
        period: match[1],
        month: match[2]
      };
    }
  }

  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return {
      date: `${input.getFullYear()}-${pad(input.getMonth() + 1)}-${pad(input.getDate())}`,
      period: String(input.getFullYear()),
      month: pad(input.getMonth() + 1)
    };
  }

  return normalizeDateParts(new Date());
}

function normalizeDirection(direction) {
  return direction === 'incoming' || direction === 'outgoing' ? direction : null;
}

function normalizeInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw createHttpError(400, 'Некорректный числовой идентификатор');
  }
  return parsed;
}

function normalizeString(value, maxLength) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return maxLength ? normalized.slice(0, maxLength) : normalized;
}

function parseStartNumber(valueJson) {
  if (valueJson === undefined || valueJson === null || valueJson === '') {
    return DEFAULT_START_NUMBER;
  }

  let parsed = valueJson;
  try {
    parsed = JSON.parse(valueJson);
  } catch (error) {
    parsed = valueJson;
  }

  const startNumber = Number(parsed);
  return Number.isInteger(startNumber) && startNumber > 0
    ? startNumber
    : DEFAULT_START_NUMBER;
}

async function getConfiguredStartNumber(client) {
  const result = await client.query(
    `SELECT value_json
     FROM settings
     WHERE key = $1
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [OUTGOING_START_SETTING_KEY]
  );

  return parseStartNumber(result.rows[0]?.value_json);
}

/**
 * Прочитать префикс исходящих писем из settings.company_profile.
 * S-7/V251: префикс хранится в company_profile.outgoing_number_prefix.
 * Fallback: 'АС-'.
 *
 * @param {object} client — pg-pool или клиент транзакции
 * @returns {Promise<string>}
 */
async function getOutgoingNumberPrefix(client) {
  try {
    const r = await client.query(
      "SELECT (value_json::jsonb) AS j FROM settings WHERE key = $1 LIMIT 1",
      [COMPANY_PROFILE_SETTING_KEY]
    );
    const raw = (r.rows[0] && r.rows[0].j) || {};
    const prefix = (raw.outgoing_number_prefix || '').trim();
    return prefix || DEFAULT_OUTGOING_PREFIX;
  } catch (_) {
    return DEFAULT_OUTGOING_PREFIX;
  }
}

function formatOutgoingNumber(periodKey, month, sequenceNumber, prefix) {
  const p = prefix || '';
  // Формат: {prefix}{YYYY}-{MM}-{NNN}, например "АС-2026-06-125".
  // sequenceNumber оставляем как число (без padStart) — историческое поведение
  // совместимо с существующими данными.
  return `${p}${periodKey}-${month}-${Number(sequenceNumber)}`;
}

async function ensureCounterRow(client, periodKey, startNumber) {
  await client.query(
    `INSERT INTO correspondence_outgoing_counters (period_key, last_number, created_at, updated_at)
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (period_key) DO NOTHING`,
    [periodKey, startNumber - 1]
  );
}

async function getNextOutgoingNumberPreview(queryable, options = {}) {
  const normalizedDate = normalizeDateParts(options.date);
  const [startNumber, prefix] = await Promise.all([
    getConfiguredStartNumber(queryable),
    getOutgoingNumberPrefix(queryable)
  ]);
  const counterResult = await queryable.query(
    'SELECT last_number FROM correspondence_outgoing_counters WHERE period_key = $1',
    [normalizedDate.period]
  );

  const lastNumber = counterResult.rows.length > 0
    ? Number(counterResult.rows[0].last_number)
    : startNumber - 1;
  const nextNumber = Math.max(lastNumber + 1, startNumber);

  return {
    number: formatOutgoingNumber(normalizedDate.period, normalizedDate.month, nextNumber, prefix),
    period: normalizedDate.period,
    sequence: nextNumber,
    start_number: startNumber,
    prefix,
    date: normalizedDate.date,
    preview: true
  };
}

async function allocateOutgoingNumber(client, options = {}) {
  const normalizedDate = normalizeDateParts(options.date);
  const [startNumber, prefix] = await Promise.all([
    getConfiguredStartNumber(client),
    getOutgoingNumberPrefix(client)
  ]);

  await ensureCounterRow(client, normalizedDate.period, startNumber);

  const counterResult = await client.query(
    'SELECT last_number FROM correspondence_outgoing_counters WHERE period_key = $1 FOR UPDATE',
    [normalizedDate.period]
  );

  const lastNumber = counterResult.rows.length > 0
    ? Number(counterResult.rows[0].last_number)
    : startNumber - 1;
  const nextNumber = Math.max(lastNumber + 1, startNumber);

  await client.query(
    `UPDATE correspondence_outgoing_counters
     SET last_number = $2, updated_at = NOW()
     WHERE period_key = $1`,
    [normalizedDate.period, nextNumber]
  );

  return {
    number: formatOutgoingNumber(normalizedDate.period, normalizedDate.month, nextNumber, prefix),
    period: normalizedDate.period,
    sequence: nextNumber,
    start_number: startNumber,
    prefix,
    date: normalizedDate.date
  };
}

function buildBodyValue(payload) {
  if (payload.body !== undefined) return normalizeString(payload.body);
  if (payload.content !== undefined) return normalizeString(payload.content);
  return undefined;
}

function normalizeSigningStatus(value) {
  const allowed = ['draft', 'finalized', 'sent'];
  const v = normalizeString(value);
  if (!v) return 'draft';
  if (!allowed.includes(v)) {
    throw createHttpError(400, `signing_status должен быть один из: ${allowed.join(', ')}`);
  }
  return v;
}

function normalizeBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

function normalizeJsonField(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_) { return null; }
  }
  return null;
}

async function createCorrespondence(database, payload = {}, options = {}) {
  const direction = normalizeDirection(payload.direction);
  if (!direction) {
    throw createHttpError(400, 'direction должен быть incoming или outgoing');
  }

  const subject = normalizeString(payload.subject);
  if (!subject) {
    throw createHttpError(400, 'subject обязателен');
  }

  // S-7/V252: для outgoing+draft номер НЕ аллоцируется.
  // Аллокация — только при finalize. Для incoming — номер берётся из payload (это
  // внешний входящий номер от контрагента, не наш).
  const signingStatus = direction === 'outgoing'
    ? normalizeSigningStatus(payload.signing_status)
    : 'finalized'; // incoming считается «принятым» сразу

  return database.transaction(async (client) => {
    const normalizedDate = normalizeDateParts(payload.date);
    const body = buildBodyValue(payload);
    const bodyHtml = normalizeString(payload.body_html);
    const bodyJson = normalizeJsonField(payload.body_json);

    let number = null;
    let allocation = null;
    if (direction === 'incoming') {
      number = normalizeString(payload.number, 100);
    } else if (signingStatus !== 'draft') {
      // Каноничный путь outgoing → finalize. Но если фронт зачем-то создаёт уже
      // finalized — поддерживаем (backward-compat с текущим UI, который мог
      // делать POST + сразу send).
      allocation = await allocateOutgoingNumber(client, { date: normalizedDate.date });
      number = allocation.number;
    }

    const finalizedAt = (direction === 'outgoing' && signingStatus !== 'draft') ? 'NOW()' : 'NULL';

    const result = await client.query(
      `INSERT INTO correspondence (
        direction, date, number, doc_type, subject, body, content, body_html, body_json,
        counterparty, contact_person, note, file_path, status,
        created_by, created_at, updated_at,
        tender_id, work_id, email_id, linked_inbox_application_id, customer_id,
        letter_kind, doc_title, doc_sub, header_subline,
        procedure_number, lot_number, lot_title,
        calc_id, pre_tender_id, conductor_run_id,
        signer_snapshot, signature_on, stamp_on,
        ai_model, ai_thread_id,
        signing_status, version_no, parent_correspondence_id, is_current,
        finalized_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, NOW(), NOW(),
        $16, $17, $18, $19, $20,
        $21, $22, $23, $24,
        $25, $26, $27,
        $28, $29, $30,
        $31, $32, $33,
        $34, $35,
        $36, 1, NULL, true,
        ${finalizedAt}
      )
      RETURNING *`,
      [
        direction,
        normalizedDate.date,
        number,
        normalizeString(payload.doc_type, 100) || 'letter',
        subject,
        body ?? null,
        body ?? null,
        bodyHtml ?? null,
        bodyJson === undefined ? null : (bodyJson === null ? null : JSON.stringify(bodyJson)),
        normalizeString(payload.counterparty, 500),
        normalizeString(payload.contact_person, 255),
        normalizeString(payload.note),
        normalizeString(payload.file_path),
        normalizeString(payload.status, 50) || (direction === 'outgoing' ? (signingStatus === 'draft' ? 'draft' : 'sent') : null),
        normalizeInteger(payload.created_by ?? options.userId),
        normalizeInteger(payload.tender_id),
        normalizeInteger(payload.work_id),
        normalizeInteger(payload.email_id),
        normalizeInteger(payload.linked_inbox_application_id),
        normalizeInteger(payload.customer_id),
        normalizeString(payload.letter_kind, 60),
        normalizeString(payload.doc_title, 500),
        normalizeString(payload.doc_sub),
        normalizeString(payload.header_subline),
        normalizeString(payload.procedure_number, 100),
        normalizeString(payload.lot_number, 100),
        normalizeString(payload.lot_title),
        normalizeInteger(payload.calc_id),
        normalizeInteger(payload.pre_tender_id),
        normalizeInteger(payload.conductor_run_id),
        payload.signer_snapshot ? JSON.stringify(payload.signer_snapshot) : null,
        normalizeBoolean(payload.signature_on, true),
        normalizeBoolean(payload.stamp_on, true),
        normalizeString(payload.ai_model, 60),
        normalizeInteger(payload.ai_thread_id),
        signingStatus
      ]
    );

    return {
      item: result.rows[0],
      allocation
    };
  });
}

async function updateCorrespondence(database, id, payload = {}) {
  const correspondenceId = normalizeInteger(id);

  return database.transaction(async (client) => {
    const existingResult = await client.query(
      'SELECT * FROM correspondence WHERE id = $1 FOR UPDATE',
      [correspondenceId]
    );

    if (existingResult.rows.length === 0) {
      throw createHttpError(404, 'Запись не найдена');
    }

    const existing = existingResult.rows[0];

    if (existing.deleted_at) {
      throw createHttpError(400, 'Запись удалена');
    }
    if (payload.direction && payload.direction !== existing.direction) {
      throw createHttpError(400, 'Смена направления корреспонденции не поддерживается');
    }
    // S-7/state machine: finalized/sent редактировать нельзя — только new-revision.
    if (existing.direction === 'outgoing' && ['finalized', 'sent'].includes(existing.signing_status)) {
      throw createHttpError(403,
        'Финализированное письмо нельзя редактировать. Создайте новую редакцию.');
    }

    const body = buildBodyValue(payload);
    const effectiveDate = existing.direction === 'outgoing' && existing.number
      ? normalizeDateParts(existing.date).date
      : (payload.date !== undefined ? normalizeDateParts(payload.date).date : normalizeDateParts(existing.date).date);
    const effectiveNumber = existing.direction === 'incoming' && Object.prototype.hasOwnProperty.call(payload, 'number')
      ? normalizeString(payload.number, 100)
      : existing.number;

    const bodyHtmlNew = payload.body_html !== undefined ? normalizeString(payload.body_html) : undefined;
    const bodyJsonNew = payload.body_json !== undefined ? normalizeJsonField(payload.body_json) : undefined;

    const result = await client.query(
      `UPDATE correspondence
       SET date = $1,
           number = $2,
           doc_type = $3,
           subject = $4,
           body = $5,
           content = $6,
           body_html = $7,
           body_json = $8,
           counterparty = $9,
           contact_person = $10,
           note = $11,
           file_path = $12,
           status = $13,
           tender_id = $14,
           work_id = $15,
           email_id = $16,
           linked_inbox_application_id = $17,
           customer_id = $18,
           letter_kind = $19,
           doc_title = $20,
           doc_sub = $21,
           header_subline = $22,
           procedure_number = $23,
           lot_number = $24,
           lot_title = $25,
           calc_id = $26,
           pre_tender_id = $27,
           signature_on = $28,
           stamp_on = $29,
           ai_model = $30,
           ai_thread_id = $31,
           updated_at = NOW()
       WHERE id = $32
       RETURNING *`,
      [
        effectiveDate,
        effectiveNumber,
        normalizeString(payload.doc_type, 100) ?? existing.doc_type,
        normalizeString(payload.subject) ?? existing.subject,
        body !== undefined ? body : existing.body,
        body !== undefined ? body : (existing.content ?? existing.body),
        bodyHtmlNew !== undefined ? bodyHtmlNew : existing.body_html,
        bodyJsonNew === undefined
          ? existing.body_json
          : (bodyJsonNew === null ? null : JSON.stringify(bodyJsonNew)),
        normalizeString(payload.counterparty, 500) ?? existing.counterparty,
        normalizeString(payload.contact_person, 255) ?? existing.contact_person,
        normalizeString(payload.note) ?? existing.note,
        normalizeString(payload.file_path) ?? existing.file_path,
        normalizeString(payload.status, 50) ?? existing.status,
        payload.tender_id !== undefined ? normalizeInteger(payload.tender_id) : existing.tender_id,
        payload.work_id !== undefined ? normalizeInteger(payload.work_id) : existing.work_id,
        payload.email_id !== undefined ? normalizeInteger(payload.email_id) : existing.email_id,
        payload.linked_inbox_application_id !== undefined ? normalizeInteger(payload.linked_inbox_application_id) : existing.linked_inbox_application_id,
        payload.customer_id !== undefined ? normalizeInteger(payload.customer_id) : existing.customer_id,
        normalizeString(payload.letter_kind, 60) ?? existing.letter_kind,
        normalizeString(payload.doc_title, 500) ?? existing.doc_title,
        normalizeString(payload.doc_sub) ?? existing.doc_sub,
        normalizeString(payload.header_subline) ?? existing.header_subline,
        normalizeString(payload.procedure_number, 100) ?? existing.procedure_number,
        normalizeString(payload.lot_number, 100) ?? existing.lot_number,
        normalizeString(payload.lot_title) ?? existing.lot_title,
        payload.calc_id !== undefined ? normalizeInteger(payload.calc_id) : existing.calc_id,
        payload.pre_tender_id !== undefined ? normalizeInteger(payload.pre_tender_id) : existing.pre_tender_id,
        normalizeBoolean(payload.signature_on, existing.signature_on),
        normalizeBoolean(payload.stamp_on, existing.stamp_on),
        normalizeString(payload.ai_model, 60) ?? existing.ai_model,
        payload.ai_thread_id !== undefined ? normalizeInteger(payload.ai_thread_id) : existing.ai_thread_id,
        correspondenceId
      ]
    );

    return {
      item: result.rows[0]
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// S-7 (Stage 2.4) additions: finalize / new-revision / soft-delete / by-parent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Финализация письма: аллокация номера + snapshot подписанта + блокировка
 * на дальнейшее редактирование (переходим в state 'finalized').
 *
 * @param {object} database — fastify.db (с .transaction)
 * @param {number|string} id
 * @param {object} options
 * @param {number} options.userId
 * @returns {Promise<{id:number, number:string, finalized_at:Date, signer_snapshot:object}>}
 */
async function finalizeCorrespondence(database, id, options = {}) {
  const correspondenceId = normalizeInteger(id);
  if (!correspondenceId) throw createHttpError(400, 'id обязателен');

  // Loaded из _shared — снапшот подписанта на момент finalize.
  const letterShared = require('./letter/_shared');

  return database.transaction(async (client) => {
    const existingResult = await client.query(
      'SELECT * FROM correspondence WHERE id = $1 FOR UPDATE',
      [correspondenceId]
    );
    if (existingResult.rows.length === 0) {
      throw createHttpError(404, 'Корреспонденция не найдена');
    }
    const row = existingResult.rows[0];

    if (row.deleted_at) {
      throw createHttpError(400, 'Корреспонденция удалена');
    }
    if (row.direction !== 'outgoing') {
      throw createHttpError(400, 'Финализация доступна только для исходящих писем');
    }
    if (row.signing_status !== 'draft') {
      throw createHttpError(400, `Письмо уже финализировано (status=${row.signing_status})`);
    }

    const allocation = await allocateOutgoingNumber(client, { date: row.date });

    const gendir = await letterShared.loadAsgardGendir(client);
    const signerSnapshot = {
      name: gendir.name,
      full_name: gendir.full_name,
      position: gendir.position,
      org: gendir.org,
      finalized_at: new Date().toISOString(),
      finalized_by: options.userId || null
    };

    const updated = await client.query(
      `UPDATE correspondence
         SET number = $1,
             signing_status = 'finalized',
             finalized_at = NOW(),
             signer_snapshot = $2::jsonb,
             status = COALESCE(status, 'finalized'),
             updated_at = NOW()
       WHERE id = $3
       RETURNING id, number, finalized_at, signer_snapshot, signing_status, version_no`,
      [allocation.number, JSON.stringify(signerSnapshot), correspondenceId]
    );

    return updated.rows[0];
  });
}

/**
 * Создание новой редакции от финализированного/отправленного письма.
 * Старая редакция помечается is_current=false (остаётся read-only),
 * новая — draft, version_no+1, parent_correspondence_id=<old.id>.
 *
 * @param {object} database
 * @param {number|string} id  — id parent-correspondence
 * @param {object} payload    — {revision_note}
 * @param {object} options    — {userId}
 * @returns {Promise<{new_id:number, version_no:number, parent_correspondence_id:number}>}
 */
async function createNewRevision(database, id, payload = {}, options = {}) {
  const parentId = normalizeInteger(id);
  if (!parentId) throw createHttpError(400, 'id обязателен');

  return database.transaction(async (client) => {
    const parentRes = await client.query(
      'SELECT * FROM correspondence WHERE id = $1 FOR UPDATE',
      [parentId]
    );
    if (parentRes.rows.length === 0) {
      throw createHttpError(404, 'Родительская корреспонденция не найдена');
    }
    const parent = parentRes.rows[0];

    if (parent.deleted_at) {
      throw createHttpError(400, 'Родительская корреспонденция удалена');
    }
    if (!['finalized', 'sent'].includes(parent.signing_status)) {
      throw createHttpError(400,
        `Новая редакция возможна только от finalized/sent (текущий: ${parent.signing_status})`);
    }
    if (parent.is_current === false) {
      throw createHttpError(400, 'Эта редакция уже не актуальная — создавайте новую от последней (is_current=true)');
    }

    const revisionNote = normalizeString(payload.revision_note);
    const userId = normalizeInteger(options.userId);

    // Снимаем флаг с родителя
    await client.query(
      `UPDATE correspondence SET is_current = false, updated_at = NOW() WHERE id = $1`,
      [parentId]
    );

    // Копируем строку как новую draft-редакцию
    const inserted = await client.query(
      `INSERT INTO correspondence (
         direction, date, number, doc_type, subject, body, content, body_html, body_json,
         counterparty, contact_person, note, file_path, status,
         created_by, created_at, updated_at,
         tender_id, work_id, email_id, linked_inbox_application_id, customer_id,
         letter_kind, doc_title, doc_sub, header_subline,
         procedure_number, lot_number, lot_title,
         calc_id, pre_tender_id, conductor_run_id,
         signer_snapshot, signature_on, stamp_on,
         ai_model, ai_thread_id,
         signing_status, version_no, parent_correspondence_id, is_current,
         finalized_at, sent_at, revision_note
       ) VALUES (
         $1, $2, NULL, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13,
         $14, NOW(), NOW(),
         $15, $16, NULL, $17, $18,
         $19, $20, $21, $22,
         $23, $24, $25,
         $26, $27, $28,
         NULL, $29, $30,
         $31, $32,
         'draft', $33, $34, true,
         NULL, NULL, $35
       )
       RETURNING id, version_no, parent_correspondence_id`,
      [
        parent.direction,
        parent.date,
        parent.doc_type,
        parent.subject,
        parent.body,
        parent.content,
        parent.body_html,
        parent.body_json ? JSON.stringify(parent.body_json) : null,
        parent.counterparty,
        parent.contact_person,
        parent.note,
        parent.file_path,
        'draft',
        userId || parent.created_by,
        parent.tender_id,
        parent.work_id,
        parent.linked_inbox_application_id,
        parent.customer_id,
        parent.letter_kind,
        parent.doc_title,
        parent.doc_sub,
        parent.header_subline,
        parent.procedure_number,
        parent.lot_number,
        parent.lot_title,
        parent.calc_id,
        parent.pre_tender_id,
        parent.conductor_run_id,
        parent.signature_on,
        parent.stamp_on,
        parent.ai_model,
        parent.ai_thread_id,
        Number(parent.version_no || 1) + 1,
        parentId,
        revisionNote
      ]
    );

    return inserted.rows[0];
  });
}

/**
 * Soft-delete: ставит deleted_at=NOW(), deleted_by=userId.
 * Не трогает запись если уже deleted.
 *
 * @returns {Promise<{id:number, deleted_at:Date}|null>} null если уже удалено
 */
async function softDeleteCorrespondence(database, id, options = {}) {
  const correspondenceId = normalizeInteger(id);
  if (!correspondenceId) throw createHttpError(400, 'id обязателен');

  const userId = normalizeInteger(options.userId);
  const r = await database.query(
    `UPDATE correspondence
        SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, deleted_at`,
    [correspondenceId, userId]
  );
  return r.rows[0] || null;
}

const PARENT_TYPE_COLUMN = {
  tender: 'tender_id',
  work: 'work_id',
  calc: 'calc_id',
  pre_tender: 'pre_tender_id',
  request: 'linked_inbox_application_id'
};

/**
 * Список писем по родительской сущности (тендер/работа/КП/пре-тендер/заявка).
 * RBAC: PM/HEAD_PM/TO/HEAD_TO — только свои created_by ИЛИ родитель — их сущность;
 * OFFICE_MANAGER/DIRECTOR_* /ADMIN — все.
 *
 * @param {object} database
 * @param {object} opts
 * @param {string} opts.parent_type
 * @param {number} opts.parent_id
 * @param {string} [opts.direction]      — 'incoming' | 'outgoing' | 'all' (default)
 * @param {string} [opts.signing_status] — 'draft' | 'finalized' | 'sent' | 'all' (default)
 * @param {boolean} [opts.only_current]  — default true (только is_current=true редакции)
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @param {object} opts.user             — {id, role} для RBAC
 * @returns {Promise<{items:Array,total:number}>}
 */
async function listCorrespondenceByParent(database, opts = {}) {
  const parentType = normalizeString(opts.parent_type);
  if (!parentType || !PARENT_TYPE_COLUMN[parentType]) {
    throw createHttpError(400, `parent_type должен быть один из: ${Object.keys(PARENT_TYPE_COLUMN).join(', ')}`);
  }
  const parentId = normalizeInteger(opts.parent_id);
  if (!parentId) throw createHttpError(400, 'parent_id обязателен');

  const col = PARENT_TYPE_COLUMN[parentType];
  const where = [`c.${col} = $1`, 'c.deleted_at IS NULL'];
  const params = [parentId];
  let idx = 2;

  if (opts.direction && opts.direction !== 'all') {
    const dir = normalizeDirection(opts.direction);
    if (!dir) throw createHttpError(400, 'direction должен быть incoming/outgoing/all');
    where.push(`c.direction = $${idx++}`);
    params.push(dir);
  }
  if (opts.signing_status && opts.signing_status !== 'all') {
    where.push(`c.signing_status = $${idx++}`);
    params.push(opts.signing_status);
  }
  const onlyCurrent = opts.only_current !== false;
  if (onlyCurrent) {
    where.push('c.is_current = true');
  }

  // RBAC: для PM/HEAD_PM/TO/HEAD_TO — created_by = me ИЛИ родитель в моём поле
  // ответственности. Для простоты S-7 — только created_by=me + parent owner check.
  // Полный team-aware RBAC (HEAD_*) — TODO Finding для S-10 AUD.
  const user = opts.user || {};
  const userId = normalizeInteger(user.id);
  const RESTRICTED = ['PM', 'TO', 'HEAD_PM', 'HEAD_TO'];
  if (user.role && RESTRICTED.includes(user.role)) {
    // PM/TO видит свои письма + письма по сущностям, где он PM/calculator.
    // По parent_type=tender: tenders.responsible_pm_id OR tenders.calculator_user_id
    // По work: works.pm_id (колонки `head_pm_id` в схеме works НЕТ — schema-drift убран 23.06.2026).
    // По calc: pm_calcs.pm_id
    // По pre_tender: pre_tender_requests.assigned_pm_id
    let parentOwnerExpr = 'FALSE';
    if (parentType === 'tender') {
      parentOwnerExpr = `EXISTS (SELECT 1 FROM tenders t WHERE t.id = c.tender_id AND (t.responsible_pm_id = $${idx} OR t.calculator_user_id = $${idx}))`;
    } else if (parentType === 'work') {
      // 23.06.2026 BUG-FIX (Works R12): `works.head_pm_id` нет в миграциях V001/V050.
      // До фикса на чистом клоне выборка падала column does not exist; на проде работало
      // только из-за ручного ALTER (schema-drift).
      parentOwnerExpr = `EXISTS (SELECT 1 FROM works w WHERE w.id = c.work_id AND w.pm_id = $${idx})`;
    } else if (parentType === 'calc') {
      parentOwnerExpr = `EXISTS (SELECT 1 FROM pm_calcs pc WHERE pc.id = c.calc_id AND pc.pm_id = $${idx})`;
    } else if (parentType === 'pre_tender') {
      // 23.06.2026 BUG-FIX (Pre-Tender R12+): канон поля — `pre_tender_requests.assigned_to`,
      // колонки `assigned_pm_id` в схеме pre_tender_requests НЕТ — schema-drift убран.
      parentOwnerExpr = `EXISTS (SELECT 1 FROM pre_tender_requests pt WHERE pt.id = c.pre_tender_id AND pt.assigned_to = $${idx})`;
    }
    where.push(`(c.created_by = $${idx} OR ${parentOwnerExpr})`);
    params.push(userId);
    idx += 1;
  }

  const whereSql = where.join(' AND ');

  const totalRes = await database.query(
    `SELECT COUNT(*)::int AS cnt FROM correspondence c WHERE ${whereSql}`,
    params
  );
  const total = totalRes.rows[0]?.cnt || 0;

  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 500);
  const offset = Math.max(Number(opts.offset) || 0, 0);

  const itemsRes = await database.query(
    `SELECT c.id, c.direction, c.date, c.number, c.subject, c.counterparty,
            c.signing_status, c.version_no, c.is_current, c.letter_kind,
            c.ai_model, c.doc_type, c.parent_correspondence_id,
            c.tender_id, c.work_id, c.calc_id, c.pre_tender_id,
            c.finalized_at, c.sent_at, c.created_at,
            c.created_by,
            u.name AS created_by_name,
            (SELECT COUNT(*)::int FROM documents d WHERE d.correspondence_id = c.id) AS attachment_count
       FROM correspondence c
       LEFT JOIN users u ON u.id = c.created_by
      WHERE ${whereSql}
      ORDER BY c.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  const items = itemsRes.rows.map(r => ({
    id: r.id,
    direction: r.direction,
    date: r.date,
    number: r.number,
    subject: r.subject,
    counterparty: r.counterparty,
    signing_status: r.signing_status,
    version_no: r.version_no,
    is_current: r.is_current,
    letter_kind: r.letter_kind,
    ai_model: r.ai_model,
    doc_type: r.doc_type,
    parent_correspondence_id: r.parent_correspondence_id,
    parent_ids: {
      tender_id: r.tender_id,
      work_id: r.work_id,
      calc_id: r.calc_id,
      pre_tender_id: r.pre_tender_id
    },
    finalized_at: r.finalized_at,
    sent_at: r.sent_at,
    created_at: r.created_at,
    created_by: r.created_by ? { id: r.created_by, name: r.created_by_name || `user#${r.created_by}` } : null,
    has_attachments: r.attachment_count > 0,
    attachment_count: r.attachment_count
  }));

  return { items, total };
}

/**
 * Получить одно письмо по id (с проверкой deleted_at).
 *
 * @returns {Promise<object|null>}
 */
async function getCorrespondenceById(database, id) {
  const correspondenceId = normalizeInteger(id);
  if (!correspondenceId) return null;
  const r = await database.query(
    'SELECT * FROM correspondence WHERE id = $1 AND deleted_at IS NULL',
    [correspondenceId]
  );
  return r.rows[0] || null;
}

/**
 * Relink — переставить parent-ссылки на корреспонденции (для исправления
 * addendum_response mis-match'а). Доступно ADMIN/DIRECTOR_* /OFFICE_MANAGER.
 *
 * @param {object} database
 * @param {number} id
 * @param {object} body — {tender_id?, work_id?, calc_id?, pre_tender_id?}
 * @returns {Promise<object>} обновлённая строка
 */
async function relinkCorrespondence(database, id, body = {}) {
  const correspondenceId = normalizeInteger(id);
  if (!correspondenceId) throw createHttpError(400, 'id обязателен');

  const sets = [];
  const params = [correspondenceId];
  let idx = 2;
  for (const f of ['tender_id', 'work_id', 'calc_id', 'pre_tender_id']) {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      sets.push(`${f} = $${idx++}`);
      params.push(normalizeInteger(body[f]));
    }
  }
  if (!sets.length) throw createHttpError(400, 'Нужно указать хотя бы одно поле: tender_id/work_id/calc_id/pre_tender_id');

  sets.push('updated_at = NOW()');
  const r = await database.query(
    `UPDATE correspondence SET ${sets.join(', ')} WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, tender_id, work_id, calc_id, pre_tender_id, updated_at`,
    params
  );
  if (r.rows.length === 0) throw createHttpError(404, 'Корреспонденция не найдена');
  return r.rows[0];
}

module.exports = {
  OUTGOING_PREFIX,
  OUTGOING_START_SETTING_KEY,
  COMPANY_PROFILE_SETTING_KEY,
  DEFAULT_OUTGOING_PREFIX,
  PARENT_TYPE_COLUMN,
  getOutgoingNumberPrefix,
  getNextOutgoingNumberPreview,
  allocateOutgoingNumber,
  createCorrespondence,
  updateCorrespondence,
  // S-7 additions:
  finalizeCorrespondence,
  createNewRevision,
  softDeleteCorrespondence,
  listCorrespondenceByParent,
  getCorrespondenceById,
  relinkCorrespondence
};
