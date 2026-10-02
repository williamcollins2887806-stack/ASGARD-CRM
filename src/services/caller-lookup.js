'use strict';

const { normalizePhone } = require('./mango');

function digitsOnly(phone) {
  return String(phone || '').replace(/[^0-9]/g, '');
}

function last10(phone) {
  const d = digitsOnly(phone);
  return d.length >= 10 ? d.slice(-10) : d;
}

/**
 * Поиск звонящего: коллега → полевой → клиент → заявка → unknown (+ region stub).
 * @param {object} db — fastify.db (query)
 * @param {string} phone
 * @returns {Promise<object>}
 */
async function lookupCaller(db, phone) {
  const normalized = normalizePhone(phone);
  const tail = last10(normalized || phone);
  if (!tail || tail.length < 10) {
    return {
      type: 'unknown',
      name: 'Неизвестный номер',
      company: null,
      responsible_name: null,
      last_tender_title: null,
      region: null,
    };
  }

  const likeTail = `%${tail}`;

  // 1. Коллега: users.phone
  try {
    const u = await db.query(
      `SELECT u.id AS user_id, u.name
       FROM users u
       WHERE u.is_active = true
         AND RIGHT(REGEXP_REPLACE(COALESCE(u.phone, ''), '[^0-9]', '', 'g'), 10) = $1
       LIMIT 1`,
      [tail]
    );
    if (u.rows.length) {
      return {
        type: 'colleague',
        user_id: u.rows[0].user_id,
        name: u.rows[0].name,
        company: 'Асgard CRM',
        responsible_name: null,
        last_tender_title: null,
        region: null,
      };
    }
  } catch (_) { /* schema drift */ }

  // employees.phone / phone2
  try {
    const e = await db.query(
      `SELECT u.id AS user_id, u.name, e.full_name
       FROM employees e
       JOIN users u ON u.id = e.user_id AND u.is_active = true
       WHERE e.user_id IS NOT NULL
         AND (
           RIGHT(REGEXP_REPLACE(COALESCE(e.phone, ''), '[^0-9]', '', 'g'), 10) = $1
           OR RIGHT(REGEXP_REPLACE(COALESCE(e.phone2, ''), '[^0-9]', '', 'g'), 10) = $1
         )
       LIMIT 1`,
      [tail]
    );
    if (e.rows.length) {
      return {
        type: 'colleague',
        user_id: e.rows[0].user_id,
        name: e.rows[0].full_name || e.rows[0].name,
        company: 'Асgard CRM',
        responsible_name: null,
        last_tender_title: null,
        region: null,
      };
    }
  } catch (_) { /* employees columns */ }

  // user_call_status.fallback_mobile
  try {
    const ucs = await db.query(
      `SELECT ucs.user_id, u.name
       FROM user_call_status ucs
       JOIN users u ON u.id = ucs.user_id AND u.is_active = true
       WHERE RIGHT(REGEXP_REPLACE(COALESCE(ucs.fallback_mobile, ''), '[^0-9]', '', 'g'), 10) = $1
       LIMIT 1`,
      [tail]
    );
    if (ucs.rows.length) {
      return {
        type: 'colleague',
        user_id: ucs.rows[0].user_id,
        name: ucs.rows[0].name,
        company: 'Асgard CRM',
        responsible_name: null,
        last_tender_title: null,
        region: null,
      };
    }
  } catch (_) { /* optional */ }

  // 2. Полевой рабочий (employees.role_tag = field_worker, без user или с user)
  try {
    const fw = await db.query(
      `SELECT e.id AS employee_id, e.full_name, e.user_id, u.name AS user_name
       FROM employees e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE e.role_tag = 'field_worker'
         AND (
           RIGHT(REGEXP_REPLACE(COALESCE(e.phone, ''), '[^0-9]', '', 'g'), 10) = $1
           OR RIGHT(REGEXP_REPLACE(COALESCE(e.phone2, ''), '[^0-9]', '', 'g'), 10) = $1
         )
       LIMIT 1`,
      [tail]
    );
    if (fw.rows.length) {
      return {
        type: 'field_worker',
        user_id: fw.rows[0].user_id || undefined,
        name: fw.rows[0].full_name || fw.rows[0].user_name || 'Полевой сотрудник',
        company: null,
        responsible_name: null,
        last_tender_title: null,
        region: null,
      };
    }
  } catch (_) { /* role_tag */ }

  // 3. Клиент
  let customerRow = null;
  try {
    const c = await db.query(
      `SELECT id, inn, name, contact_person, phone, city, region
       FROM customers
       WHERE phone LIKE $1
          OR RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = $2
       LIMIT 1`,
      [likeTail, tail]
    );
    customerRow = c.rows[0] || null;
  } catch (_) {
    try {
      const c2 = await db.query(
        `SELECT id, inn, name, contact_person, phone
         FROM customers
         WHERE phone LIKE $1 OR phone LIKE $2
         LIMIT 1`,
        [likeTail, likeTail]
      );
      customerRow = c2.rows[0] || null;
    } catch (_) { /* ignore */ }
  }

  if (customerRow) {
    let responsible_name = null;
    let last_tender_title = null;
    try {
      const t = await db.query(
        `SELECT t.title, t.customer_name, u.name AS pm_name
         FROM tenders t
         LEFT JOIN users u ON u.id = t.pm_id
         WHERE (t.inn = $1 OR t.customer_inn = $1)
         ORDER BY t.created_at DESC NULLS LAST
         LIMIT 1`,
        [customerRow.inn]
      );
      if (t.rows.length) {
        responsible_name = t.rows[0].pm_name;
        last_tender_title = t.rows[0].title || t.rows[0].customer_name;
      }
    } catch (_) { /* tenders columns */ }

    return {
      type: 'customer',
      customer_id: customerRow.id,
      inn: customerRow.inn || undefined,
      name: customerRow.contact_person || customerRow.name,
      company: customerRow.name,
      responsible_name,
      last_tender_title,
      region: customerRow.region || customerRow.city || null,
    };
  }

  // 4. Контакт из заявок (inbox / pre_tender)
  try {
    const app = await db.query(
      `SELECT id, customer_inn, customer_name, contact_person, contact_phone, customer_city
       FROM inbox_applications
       WHERE RIGHT(REGEXP_REPLACE(COALESCE(contact_phone, ''), '[^0-9]', '', 'g'), 10) = $1
       ORDER BY created_at DESC NULLS LAST
       LIMIT 1`,
      [tail]
    );
    if (app.rows.length) {
      const row = app.rows[0];
      return {
        type: 'application_contact',
        inn: row.customer_inn || undefined,
        name: row.contact_person || row.customer_name || 'Контакт из заявки',
        company: row.customer_name,
        responsible_name: null,
        last_tender_title: null,
        region: row.customer_city || null,
      };
    }
  } catch (_) { /* table */ }

  try {
    const pt = await db.query(
      `SELECT id, customer_inn, customer_name, contact_person, contact_phone
       FROM pre_tender_requests
       WHERE RIGHT(REGEXP_REPLACE(COALESCE(contact_phone, ''), '[^0-9]', '', 'g'), 10) = $1
       ORDER BY created_at DESC NULLS LAST
       LIMIT 1`,
      [tail]
    );
    if (pt.rows.length) {
      const row = pt.rows[0];
      return {
        type: 'application_contact',
        inn: row.customer_inn || undefined,
        name: row.contact_person || row.customer_name || 'Контакт из заявки',
        company: row.customer_name,
        responsible_name: null,
        last_tender_title: null,
        region: null,
      };
    }
  } catch (_) { /* table */ }

  // 5. Unknown + region stub из прошлых звонков / DaData
  let region = null;
  try {
    const prev = await db.query(
      `SELECT dadata_region, dadata_city FROM call_history
       WHERE from_number LIKE $1 OR caller_number LIKE $1
       ORDER BY created_at DESC NULLS LAST
       LIMIT 1`,
      [likeTail]
    );
    if (prev.rows.length) {
      region = prev.rows[0].dadata_region || prev.rows[0].dadata_city || null;
    }
  } catch (_) { /* columns */ }

  return {
    type: 'unknown',
    name: normalized || phone || 'Неизвестный',
    company: null,
    responsible_name: null,
    last_tender_title: null,
    region,
  };
}

module.exports = { lookupCaller, last10, digitsOnly };
