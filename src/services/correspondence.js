'use strict';

const DEFAULT_START_NUMBER = 1;
const OUTGOING_PREFIX = 'АС-ИСХ';
const OUTGOING_START_SETTING_KEY = 'correspondence_outgoing_start_number';

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
        period: `${match[1]}-${match[2]}`
      };
    }
  }

  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return {
      date: `${input.getFullYear()}-${pad(input.getMonth() + 1)}-${pad(input.getDate())}`,
      period: `${input.getFullYear()}-${pad(input.getMonth() + 1)}`
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

function formatOutgoingNumber(periodKey, sequenceNumber) {
  return `${OUTGOING_PREFIX}-${periodKey}-${Number(sequenceNumber)}`;
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
  const startNumber = await getConfiguredStartNumber(queryable);
  const counterResult = await queryable.query(
    'SELECT last_number FROM correspondence_outgoing_counters WHERE period_key = $1',
    [normalizedDate.period]
  );

  const lastNumber = counterResult.rows.length > 0
    ? Number(counterResult.rows[0].last_number)
    : startNumber - 1;
  const nextNumber = Math.max(lastNumber + 1, startNumber);

  return {
    number: formatOutgoingNumber(normalizedDate.period, nextNumber),
    period: normalizedDate.period,
    sequence: nextNumber,
    start_number: startNumber,
    date: normalizedDate.date,
    preview: true
  };
}

async function allocateOutgoingNumber(client, options = {}) {
  const normalizedDate = normalizeDateParts(options.date);
  const startNumber = await getConfiguredStartNumber(client);

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
    number: formatOutgoingNumber(normalizedDate.period, nextNumber),
    period: normalizedDate.period,
    sequence: nextNumber,
    start_number: startNumber,
    date: normalizedDate.date
  };
}

function buildBodyValue(payload) {
  if (payload.body !== undefined) return normalizeString(payload.body);
  if (payload.content !== undefined) return normalizeString(payload.content);
  return undefined;
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

  return database.transaction(async (client) => {
    const normalizedDate = normalizeDateParts(payload.date);
    const body = buildBodyValue(payload);
    const allocation = direction === 'outgoing'
      ? await allocateOutgoingNumber(client, { date: normalizedDate.date })
      : null;

    const number = direction === 'outgoing'
      ? allocation.number
      : normalizeString(payload.number, 100);

    const result = await client.query(
      `INSERT INTO correspondence (
        direction, date, number, doc_type, subject, body, content,
        counterparty, contact_person, note, file_path, status,
        created_by, created_at, updated_at,
        tender_id, work_id, email_id, linked_inbox_application_id, customer_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, NOW(), NOW(),
        $14, $15, $16, $17, $18
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
        normalizeString(payload.counterparty, 500),
        normalizeString(payload.contact_person, 255),
        normalizeString(payload.note),
        normalizeString(payload.file_path),
        normalizeString(payload.status, 50) || (direction === 'outgoing' ? 'sent' : null),
        normalizeInteger(payload.created_by ?? options.userId),
        normalizeInteger(payload.tender_id),
        normalizeInteger(payload.work_id),
        normalizeInteger(payload.email_id),
        normalizeInteger(payload.linked_inbox_application_id),
        normalizeInteger(payload.customer_id)
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

    if (payload.direction && payload.direction !== existing.direction) {
      throw createHttpError(400, 'Смена направления корреспонденции не поддерживается');
    }

    const body = buildBodyValue(payload);
    const effectiveDate = existing.direction === 'outgoing' && existing.number
      ? normalizeDateParts(existing.date).date
      : (payload.date !== undefined ? normalizeDateParts(payload.date).date : normalizeDateParts(existing.date).date);
    const effectiveNumber = existing.direction === 'incoming' && Object.prototype.hasOwnProperty.call(payload, 'number')
      ? normalizeString(payload.number, 100)
      : existing.number;

    const result = await client.query(
      `UPDATE correspondence
       SET date = $1,
           number = $2,
           doc_type = $3,
           subject = $4,
           body = $5,
           content = $6,
           counterparty = $7,
           contact_person = $8,
           note = $9,
           file_path = $10,
           status = $11,
           tender_id = $12,
           work_id = $13,
           email_id = $14,
           linked_inbox_application_id = $15,
           customer_id = $16,
           updated_at = NOW()
       WHERE id = $17
       RETURNING *`,
      [
        effectiveDate,
        effectiveNumber,
        normalizeString(payload.doc_type, 100) ?? existing.doc_type,
        normalizeString(payload.subject) ?? existing.subject,
        body !== undefined ? body : existing.body,
        body !== undefined ? body : (existing.content ?? existing.body),
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
        correspondenceId
      ]
    );

    return {
      item: result.rows[0]
    };
  });
}

module.exports = {
  OUTGOING_PREFIX,
  OUTGOING_START_SETTING_KEY,
  getNextOutgoingNumberPreview,
  allocateOutgoingNumber,
  createCorrespondence,
  updateCorrespondence
};
