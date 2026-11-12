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

  // 2. Сотрудник из справочника employees — любой role_tag (РП, мастер,
  // слесарь…). Раньше искали ТОЛЬКО role_tag='field_worker', поэтому
  // телефоны РП и офисных сотрудников в карточке не находились вовсе.
  try {
    const fw = await db.query(
      `SELECT e.id AS employee_id, COALESCE(NULLIF(e.fio,''), e.full_name) AS emp_name,
              e.user_id, e.role_tag, u.name AS user_name
       FROM employees e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE COALESCE(e.is_active, true) = true
         AND (
           RIGHT(REGEXP_REPLACE(COALESCE(e.phone, ''), '[^0-9]', '', 'g'), 10) = $1
           OR RIGHT(REGEXP_REPLACE(COALESCE(e.phone2, ''), '[^0-9]', '', 'g'), 10) = $1
         )
       ORDER BY (e.user_id IS NOT NULL) DESC, e.id ASC
       LIMIT 1`,
      [tail]
    );
    if (fw.rows.length) {
      const row = fw.rows[0];
      const isField = row.role_tag === 'field_worker';
      return {
        type: isField ? 'field_worker' : 'colleague',
        user_id: row.user_id || undefined,
        name: row.emp_name || row.user_name || 'Сотрудник',
        company: isField ? null : 'Асгард Сервис',
        role_tag: row.role_tag || null,
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

  // 3b. Контакт из карточки компании (customers.contacts jsonb: [{name, phone, phone2, ...}])
  try {
    const cc = await db.query(
      `SELECT c.id AS customer_id, c.inn, c.name AS company,
              ce->>'name' AS contact_name
         FROM customers c, jsonb_array_elements(COALESCE(c.contacts, '[]'::jsonb)) ce
        WHERE RIGHT(REGEXP_REPLACE(COALESCE(ce->>'phone', ''), '[^0-9]', '', 'g'), 10) = $1
           OR RIGHT(REGEXP_REPLACE(COALESCE(ce->>'phone2', ''), '[^0-9]', '', 'g'), 10) = $1
        LIMIT 1`,
      [tail]
    );
    if (cc.rows.length) {
      const row = cc.rows[0];
      return {
        type: 'customer_contact',
        customer_id: row.customer_id,
        inn: row.inn || undefined,
        name: row.contact_name || row.company,
        company: row.company,
        responsible_name: null,
        last_tender_title: null,
        region: null,
      };
    }
  } catch (_) { /* jsonb contacts */ }

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

  // 4.5. ПАМЯТЬ НОМЕРА (12.11.2026): раньше номер, введённый в справочник
  // ПОСЛЕ первого звонка, оставался «неизвестным» навсегда. Если по этому
  // номеру уже был звонок с распознанным именем/компанией — берём оттуда.
  // Так «Дима Путков» подхватывается, даже если его мобильный появился
  // в справочнике позже первого звонка.
  try {
    const memo = await db.query(
      `SELECT ch.id, ch.client_inn, ch.ai_lead_data,
              c.name AS customer_name, c.contact_person AS customer_contact
         FROM call_history ch
         LEFT JOIN customers c ON c.inn = ch.client_inn
        WHERE RIGHT(REGEXP_REPLACE(COALESCE(ch.client_number, ch.from_number, ''), '[^0-9]', '', 'g'), 10) = $1
          AND ch.client_number IS NOT NULL
          AND (
            c.name IS NOT NULL
            OR (ch.ai_lead_data->>'company_name') IS NOT NULL
            OR (ch.ai_lead_data->>'contact_person') IS NOT NULL
          )
        ORDER BY ch.created_at DESC NULLS LAST
        LIMIT 1`,
      [tail]
    );
    if (memo.rows.length) {
      const row = memo.rows[0];
      let ld = {};
      try { ld = typeof row.ai_lead_data === 'string' ? JSON.parse(row.ai_lead_data) : (row.ai_lead_data || {}); } catch (_) { ld = {}; }
      const company = row.customer_name || ld.company_name || null;
      const person = row.customer_contact || ld.contact_person || null;
      if (company || person) {
        return {
          type: 'call_memory',
          inn: row.client_inn || ld.customer_inn || undefined,
          name: person || company,
          company: company || null,
          responsible_name: null,
          last_tender_title: null,
          region: ld.location || null,
        };
      }
    }
  } catch (_) { /* таблицы/колонки */ }

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

/**
 * Батч-резолв номеров → имена. Один проход по уникальным хвостам номеров,
 * ограниченная параллельность, ключ результата — последние 10 цифр.
 * @param {object} db
 * @param {Array<string>} phones
 * @returns {Promise<Object<string, object>>} map[last10] = lookup-результат
 */
async function enrichCallers(db, phones) {
  const tails = [];
  const seen = new Set();
  (phones || []).forEach((p) => {
    const t = last10(p);
    if (t && t.length >= 10 && !seen.has(t)) { seen.add(t); tails.push(t); }
  });
  const out = {};
  const CONC = 6;
  let idx = 0;
  async function worker() {
    while (idx < tails.length) {
      const t = tails[idx++];
      try { out[t] = await lookupCaller(db, t); }
      catch (_) { out[t] = { type: 'unknown', name: 'Неизвестный номер' }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, tails.length) }, worker));
  return out;
}

/**
 * Обогащение строк журнала именем звонящего по ВСЕМ справочникам CRM.
 * Поле client_name меняется только если справочник дал осмысленное имя;
 * всегда добавляются caller_name / caller_company / caller_type.
 * @param {object} db
 * @param {Array<object>} rows
 * @returns {Promise<Array<object>>}
 */
async function enrichCallRows(db, rows) {
  if (!Array.isArray(rows) || !rows.length) return rows || [];
  const nums = rows.map((r) => {
    const out = r.direction === 'outbound' || r.call_type === 'out' || r.call_type === 'outbound';
    return out
      ? (r.to_number || r.called_number)
      : (r.from_number || r.caller_number);
  });
  let map = {};
  try { map = await enrichCallers(db, nums); } catch (_) { map = {}; }
  return rows.map((r, i) => {
    const t = last10(nums[i]);
    const info = t && map[t];
    if (!info || info.type === 'unknown') return r;
    const name = info.name || info.company || '';
    if (!name) return r;
    return {
      ...r,
      caller_name: name,
      caller_company: info.company || null,
      caller_type: info.type,
      client_name: (r.client_name && String(r.client_name).trim())
        ? r.client_name
        : (name || r.client_name),
    };
  });
}

module.exports = { lookupCaller, enrichCallers, enrichCallRows, last10, digitsOnly };
