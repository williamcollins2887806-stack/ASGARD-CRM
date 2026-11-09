const { logError } = require('../lib/log-error');
const { toDigitsRu } = require('../lib/phone');
const { visibilitySql } = require('../lib/doc-visibility');
const { validCounterpartyInn, digitsInn } = require('../services/counterparty-inn');
const { mirrorSupplierIdToCustomer } = require('../services/customer-from-supplier');
const { listDirectory, statsForInn } = require('../services/customer-directory');
/**
 * Customers Routes
 */

// SECURITY: Allowlist of columns for customers
const ALLOWED_COLS = new Set([
  'inn', 'name', 'full_name', 'kpp', 'ogrn', 'address', 'phone',
  'email', 'contact_person', 'contacts', 'bank_account', 'bank_name', 'bik',
  'notes', 'category', 'is_active', 'created_at', 'updated_at'
]);

const WRITE_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'OFFICE_MANAGER'];
const PUT_ROLES = [...WRITE_ROLES, 'BUH'];

/**
 * Дата → 'YYYY-MM-DD' или null.
 * pg отдаёт DATE строкой с T12:00 (см. db.js), но TIMESTAMP — объектом Date.
 * `String(x).slice(0,10)` от Date даёт «Wed Jul 29» — так в хронологию
 * контрагента попадали дни недели вместо дат (найдено на клоне 08.11.2026).
 */
function toIsoDate(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const dt = new Date(v);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

// Нормализация массива contacts: чистим строки, фильтруем пустые,
// гарантируем единственный is_primary (если несколько true — оставляем первый;
// если ни одного — первый контакт становится primary).
function normalizeContacts(input) {
  if (!Array.isArray(input)) return [];
  const cleaned = input
    .map((c) => ({
      name:       String(c?.name || '').trim(),
      position:   String(c?.position || '').trim(),
      phone:      String(c?.phone || '').trim(),
      phone2:     String(c?.phone2 || '').trim(),
      email:      String(c?.email || '').trim(),
      is_primary: !!c?.is_primary
    }))
    .filter((c) => c.name || c.phone || c.phone2 || c.email);
  let primaryFound = false;
  for (const c of cleaned) {
    if (c.is_primary && !primaryFound) primaryFound = true;
    else c.is_primary = false;
  }
  if (cleaned.length && !primaryFound) cleaned[0].is_primary = true;
  return cleaned;
}

function filterData(data) {
  const filtered = {};
  for (const [k, v] of Object.entries(data)) {
    if (!ALLOWED_COLS.has(k) || v === undefined) continue;
    if (k === 'contacts') {
      // pg umеет JSONB-приём через JSON.stringify; нормализуем структуру.
      filtered[k] = JSON.stringify(normalizeContacts(v));
    } else if (k === 'phone') {
      // Контрагент — может быть и городской/8-800; канонизируем только уверенные РФ-мобильные.
      filtered[k] = toDigitsRu(v) || v;
    } else {
      filtered[k] = v;
    }
  }
  return filtered;
}

async function routes(fastify, options) {
  const db = fastify.db;

  // Lookup company info by INN (using DaData API)
  fastify.get('/lookup/:inn', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const inn = String(request.params.inn || '').replace(/\D/g, '');
    if (inn.length !== 10 && inn.length !== 12) {
      return reply.code(400).send({ error: 'ИНН должен быть 10 или 12 цифр' });
    }

    const DADATA_TOKEN = process.env.DADATA_TOKEN;
    if (!DADATA_TOKEN) {
      // Fallback: return basic structure without real lookup
      return {
        found: false,
        message: 'DaData API не настроен. Добавьте DADATA_TOKEN в переменные окружения.',
        suggestion: { inn, name: '', full_name: '', kpp: '', ogrn: '', address: '' }
      };
    }

    try {
      const response = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Token ${DADATA_TOKEN}`
        },
        body: JSON.stringify({ query: inn, count: 1 })
      });

      if (!response.ok) {
        throw new Error(`DaData API error: ${response.status}`);
      }

      const data = await response.json();

      if (data.suggestions && data.suggestions.length > 0) {
        const s = data.suggestions[0];
        const d = s.data || {};
        return {
          found: true,
          suggestion: {
            inn: d.inn || inn,
            name: d.name?.short_with_opf || s.value || '',
            full_name: d.name?.full_with_opf || '',
            kpp: d.kpp || '',
            ogrn: d.ogrn || '',
            address: d.address?.unrestricted_value || d.address?.value || ''
          }
        };
      }

      return { found: false, message: 'Организация не найдена', suggestion: { inn } };
    } catch (e) {
      logError(fastify, 'DaData lookup error', e, request);
      return reply.code(500).send({ error: 'Ошибка поиска по ИНН: ' + e.message });
    }
  });

  // Suggest companies by name via DaData API
  fastify.get('/suggest', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { q, type = 'party' } = request.query;
    if (!q || String(q).trim().length < 2) {
      return { suggestions: [] };
    }

    const DADATA_TOKEN = process.env.DADATA_TOKEN;
    if (!DADATA_TOKEN) {
      return { suggestions: [], message: 'DaData API не настроен' };
    }

    try {
      const response = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Token ${DADATA_TOKEN}`
        },
        // Cap: длинная вставка в autocomplete → DaData/nginx 413 (прод).
        body: JSON.stringify({ query: String(q).trim().slice(0, 300), count: 5 })
      });

      if (!response.ok) {
        throw new Error(`DaData API error: ${response.status}`);
      }

      const data = await response.json();
      const suggestions = (data.suggestions || []).map(s => {
        const d = s.data || {};
        return {
          inn: d.inn || '',
          name: d.name?.short_with_opf || s.value || '',
          full_name: d.name?.full_with_opf || '',
          kpp: d.kpp || '',
          ogrn: d.ogrn || '',
          address: d.address?.unrestricted_value || d.address?.value || ''
        };
      });

      return { suggestions };
    } catch (e) {
      logError(fastify, 'DaData suggest error', e, request);
      return { suggestions: [] };
    }
  });

  // ── Подсказки контрагента для Doc Hub: приоритет — поставщики, с которыми
  //    уже работаем (таблица suppliers + статистика по реестру и договорам).
  //    Возвращает: inn, name, phone/email (из карточки, иначе из документов),
  //    docs_count (счетов в реестре), contracts_count (договоров).
  fastify.get('/registry-suggest', { preHandler: [fastify.authenticate] }, async (request) => {
    const q = String((request.query || {}).q || '').trim();
    const limit = Math.min(Math.max(parseInt((request.query || {}).limit, 10) || 12, 1), 30);
    if (q.length < 2) return { suppliers: [] };
    const like = '%' + q.toLowerCase() + '%';
    try {
      // N3: статистика/контакты берутся только из ВИДИМЫХ роли документов,
      // иначе оракул существования чужих счетов (docs_count).
      // ВАЖНО: visibilitySql нумерует параметры от начала массива, поэтому
      // передаём ТОТ ЖЕ массив, что уходит в db.query (иначе $1 конфликтует с like).
      const params = [like, limit];
      const vis = visibilitySql(params, request.user.role, request.user.id, { scope: 'all' });
      const { rows } = await db.query(
        `SELECT s.id, s.name, s.inn, s.kpp, s.ogrn,
                COALESCE(NULLIF(TRIM(s.phone), ''), dc.phone, '') AS phone,
                COALESCE(NULLIF(TRIM(s.email), ''), dc.email, '') AS email,
                COALESCE(dc.docs, 0)::int      AS docs_count,
                COALESCE(ct.contracts, 0)::int AS contracts_count
           FROM suppliers s
           LEFT JOIN LATERAL (
             SELECT count(*) AS docs,
                    max(NULLIF(TRIM(counterparty_phone), '')) AS phone,
                    max(NULLIF(TRIM(counterparty_email), '')) AS email
               FROM doc_registry d
              WHERE d.deleted_at IS NULL AND d.supplier_id = s.id${vis}
           ) dc ON true
           LEFT JOIN LATERAL (
             -- D-402 (08.11.2026): договоры считаем ПО ИНН, а не только по имени.
             -- Имя в договоре и в справочнике расходится на кавычки и регистр
             -- («ООО "ГАЛА ЮГ"» vs «ООО Гала Юг»), из-за чего счётчик показывал 0,
             -- хотя договор есть. ИНН — надёжный ключ; сравнение по имени
             -- оставляем как запасное, для старых записей без customer_inn.
             SELECT count(*) AS contracts FROM contracts c
              WHERE COALESCE(TRIM(c.counterparty_name), '') <> ''
                AND (
                  (s.inn IS NOT NULL AND regexp_replace(COALESCE(s.inn,''), '\D', '', 'g') <> ''
                     AND regexp_replace(COALESCE(c.customer_inn,''), '\D', '', 'g')
                         = regexp_replace(COALESCE(s.inn,''), '\D', '', 'g'))
                  OR lower(TRIM(c.counterparty_name)) = lower(TRIM(s.name))
                )
           ) ct ON true
          WHERE s.deleted_at IS NULL
            AND (s.name ILIKE $1 OR COALESCE(s.inn, '') LIKE $1 OR lower(COALESCE(s.inn, '')) LIKE $1)
          ORDER BY COALESCE(dc.docs, 0) DESC, COALESCE(ct.contracts, 0) DESC, s.name ASC
          LIMIT $2`,
        params
      );
      return { suppliers: rows };
    } catch (e) {
      logError(fastify, 'registry-suggest error', e, request);
      return { suppliers: [] };
    }
  });

  // ── Контакты контрагента для автозаполнения: карточка, при пустых —
  //    из последнего документа реестра (+ backfill карточки).
  fastify.get('/registry-contacts/:inn', { preHandler: [fastify.authenticate] }, async (request) => {
    const inn = String(request.params.inn || '').replace(/\D/g, '');
    if (!inn) return reply.code(400).send({ error: 'ИНН обязателен' });
    try {
      const sup = (await db.query(
        `SELECT id, name, inn, kpp, bik, rs, ks, bank_name,
                COALESCE(TRIM(phone), '') AS phone, COALESCE(TRIM(email), '') AS email
           FROM suppliers WHERE deleted_at IS NULL AND inn = $1 LIMIT 1`, [inn])).rows[0] || null;
      // N3: контакты и docs_count — только из видимых роли документов.
      // visibilitySql нумерует от начала массива → единый массив с запросом.
      const params2 = [sup ? sup.id : -1];
      const vis2 = visibilitySql(params2, request.user.role, request.user.id, { scope: 'all' });
      const doc = (await db.query(
        `SELECT NULLIF(TRIM(counterparty_phone), '') AS phone, NULLIF(TRIM(counterparty_email), '') AS email
           FROM doc_registry d
          WHERE d.deleted_at IS NULL AND d.supplier_id = $1
            AND (COALESCE(TRIM(counterparty_phone), '') <> '' OR COALESCE(TRIM(counterparty_email), '') <> '')${vis2}
          ORDER BY d.invoice_date DESC NULLS LAST, d.id DESC LIMIT 1`, params2)).rows[0] || null;
      const phone = (sup && sup.phone) || (doc && doc.phone) || '';
      const email = (sup && sup.email) || (doc && doc.email) || '';
      // backfill карточки, чтобы в следующий раз отдавать сразу
      if (sup && ((!sup.phone && phone) || (!sup.email && email))) {
        await db.query(
          `UPDATE suppliers SET phone = COALESCE(NULLIF(TRIM(phone), ''), $2),
                                email = COALESCE(NULLIF(TRIM(email), ''), $3),
                                updated_at = NOW()
            WHERE id = $1`, [sup.id, phone || null, email || null]
        ).catch(() => {});
      }
      const docs = sup ? (await db.query(
        `SELECT count(*)::int AS n FROM doc_registry d WHERE d.deleted_at IS NULL AND d.supplier_id = $1${vis2}`, params2
      )).rows[0].n : 0;
      const contracts = sup ? (await db.query(
        `SELECT count(*)::int AS n FROM contracts WHERE COALESCE(TRIM(counterparty_name), '') <> ''
           AND lower(TRIM(counterparty_name)) = lower(TRIM($1))`, [sup.name]
      )).rows[0].n : 0;
      return {
        inn,
        name: sup ? sup.name : '',
        phone, email, docs_count: docs, contracts_count: contracts,
        // D-324: реквизиты для платёжки — из карточки контрагента.
        kpp: (sup && sup.kpp) || '',
        bik: (sup && sup.bik) || '',
        rs: (sup && sup.rs) || '',
        ks: (sup && sup.ks) || '',
        bank_name: (sup && sup.bank_name) || '',
        has_requisites: !!(sup && sup.bik && sup.rs)
      };
    } catch (e) {
      logError(fastify, 'registry-contacts error', e, request);
      return { inn, phone: '', email: '', docs_count: 0, contracts_count: 0 };
    }
  });

  // Единый реестр: покупатели + поставщики, роли, «работаем», счётчики
  fastify.get('/directory', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      return await listDirectory(db, request.query || {});
    } catch (e) {
      // Если миграция V469 ещё не накатана — мягкий фолбэк без meta
      if (e && /customer_dadata_meta/i.test(String(e.message || ''))) {
        logError(fastify, 'directory: meta table missing', e, request);
        return reply.code(503).send({ error: 'Нужна миграция V469 (customer_dadata_meta)' });
      }
      throw e;
    }
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { search, limit = 100, offset = 0 } = request.query;
    let sql = 'SELECT * FROM customers WHERE 1=1';
    const params = [];
    let idx = 1;
    if (search) {
      sql += ` AND (LOWER(name) LIKE $${idx} OR inn LIKE $${idx})`;
      params.push(`%${search.toLowerCase()}%`);
      idx++;
    }
    sql += ` ORDER BY name ASC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    return { customers: result.rows };
  });

  fastify.get('/:inn', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const inn = digitsInn(request.params.inn);
    let result = await db.query('SELECT * FROM customers WHERE inn = $1', [inn]);
    if (!result.rows[0] && validCounterpartyInn(inn)) {
      // Автосоздание карточки из поставщика (deep-link из счетов)
      const sup = await db.query(
        `SELECT * FROM suppliers
          WHERE deleted_at IS NULL
            AND regexp_replace(COALESCE(inn,''), '\\D', '', 'g') = $1
          ORDER BY id LIMIT 1`, [inn]);
      if (sup.rows[0]) {
        try {
          await mirrorSupplierIdToCustomer(db, sup.rows[0].id);
          result = await db.query('SELECT * FROM customers WHERE inn = $1', [inn]);
        } catch (e) {
          logError(fastify, 'auto-ensure customer from supplier', e, request);
        }
      }
    }
    if (!result.rows[0]) return reply.code(404).send({ error: 'Контрагент не найден' });
    const tenders = await db.query('SELECT * FROM tenders WHERE customer_inn = $1 ORDER BY created_at DESC LIMIT 10', [inn]);
    const dirMeta = await statsForInn(db, inn).catch(() => null);
    return { customer: result.rows[0], tenders: tenders.rows, directory: dirMeta };
  });

  // SECURITY B3: Role-based access (+ OFFICE_MANAGER для Карты / Doc Hub)
  fastify.post('/', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    const { inn, name, ...rest } = request.body || {};
    if (!inn || !name) return reply.code(400).send({ error: 'ИНН и наименование обязательны' });

    const cleanInn = digitsInn(inn);
    if (!validCounterpartyInn(cleanInn)) {
      return reply.code(400).send({ error: 'ИНН некорректен (контрольная сумма или мусорный паттерн)' });
    }

    // Метки времени — через NOW() в SQL, а не new Date().toISOString().
    // Верификатор 03.11.2026, D-5: колонки timestamp без зоны, и в одну
    // таблицу писались два формата (UTC из этого места и локальное время
    // из generic CRUD) — разрыв 3 часа внутри customers.
    const data = filterData({ inn: cleanInn, name, ...rest });
    const keys = Object.keys(data);
    const values = Object.values(data);

    // NOW() по часовому поясу сессии PG — тот же, что читают остальные пути.
    const STAMP_COLS = ['created_at', 'updated_at'];
    const insertCols = keys.concat(STAMP_COLS).join(', ');
    const insertVals = keys.map((_, i) => `$${i + 1}`).concat(STAMP_COLS.map(() => 'NOW()')).join(', ');

    // Use upsert to handle re-adding deleted customers (only if inn is non-empty)
    const updateParts = keys.filter(k => k !== 'inn' && k !== 'created_at').map((k) => `${k} = EXCLUDED.${k}`);
    updateParts.push('updated_at = NOW()');
    let sql;
    if (data.inn && data.inn.trim()) {
      sql = `
        INSERT INTO customers (${insertCols})
        VALUES (${insertVals})
        ON CONFLICT (inn) WHERE inn IS NOT NULL AND inn::text <> ''::text DO UPDATE SET ${updateParts.join(', ')}
        RETURNING *
      `;
    } else {
      sql = `
        INSERT INTO customers (${insertCols})
        VALUES (${insertVals})
        RETURNING *
      `;
    }
    let result;
    try {
      result = await db.query(sql, values);
    } catch (err) {
      if (err.code === '23505') {
        // Duplicate key violation — return 409 Conflict
        const detail = err.detail || err.message;
        return reply.code(409).send({ error: 'Запись уже существует', detail });
      }
      throw err;
    }
    return { customer: result.rows[0] };
  });

  // G-12 F8 SECURITY: PUT /:inn — добавлен ролевой гейт (выровнен с POST).
  // Раньше любой залогиненный (включая WAREHOUSE, OFFICE_MANAGER) мог менять реквизиты заказчика.
  fastify.put('/:inn', { preHandler: [fastify.requireRoles(PUT_ROLES)] }, async (request, reply) => {
    const { inn } = request.params;
    const data = filterData(request.body);
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(data)) {
      if (key !== 'inn') { updates.push(`${key} = $${idx}`); values.push(value); idx++; }
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });
    updates.push('updated_at = NOW()');
    values.push(inn);
    const sql = `UPDATE customers SET ${updates.join(', ')} WHERE inn = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { customer: result.rows[0] };
  });

  // ─── GET /:inn/dashboard — сводка-«светофор» контрагента ───────────────────
  // Возвращает агрегат по тендерам, ТКП, прямым запросам, работам и финансам.
  // Результат отдаётся фронту для карточки-светофора и передаётся Мимиру как контекст.
  fastify.get('/:inn/dashboard', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const inn = String(request.params.inn || '').replace(/\D/g, '');
    if (inn.length !== 10 && inn.length !== 12) {
      return reply.code(400).send({ error: 'Некорректный ИНН (должен содержать 10 или 12 цифр)' });
    }

    // Все запросы параллельно для минимального времени отклика
    const [
      profileRes,
      tendersAggRes,
      tendersByStatusRes,
      preTendersRes,
      tkpRes,
      worksRes,
      financeRes
    ] = await Promise.all([

      // Профиль контрагента
      db.query('SELECT * FROM customers WHERE inn = $1', [inn]),

      // Агрегат по тендерам
      db.query(`
        SELECT
          COUNT(*)                                                        AS total,
          COUNT(*) FILTER (WHERE tender_status = 'Выиграли')             AS won,
          COUNT(*) FILTER (WHERE tender_status = 'Проиграли')            AS lost,
          COUNT(*) FILTER (WHERE tender_status = 'Отменён')              AS cancelled,
          COUNT(*) FILTER (WHERE tender_status NOT IN ('Выиграли','Проиграли','Отменён')) AS in_work,
          COALESCE(SUM(tender_price) FILTER (WHERE tender_status = 'Выиграли'), 0)  AS won_sum,
          COALESCE(SUM(tender_price) FILTER (WHERE tender_status = 'Проиграли'), 0) AS lost_sum,
          COALESCE(SUM(tender_price) FILTER (WHERE tender_status NOT IN ('Выиграли','Проиграли','Отменён')), 0) AS in_work_sum,
          MAX(updated_at)                                                 AS last_tender_at
        FROM tenders
        WHERE customer_inn = $1 AND deleted_at IS NULL
      `, [inn]),

      // Разбивка по статусам
      db.query(`
        SELECT tender_status, COUNT(*) AS cnt, COALESCE(SUM(tender_price), 0) AS sum
        FROM tenders
        WHERE customer_inn = $1 AND deleted_at IS NULL
        GROUP BY tender_status
        ORDER BY cnt DESC
      `, [inn]),

      // Прямые запросы (pre_tenders)
      db.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'accepted')  AS accepted,
          COUNT(*) FILTER (WHERE status = 'rejected')  AS rejected,
          COUNT(*) FILTER (WHERE status IN ('new','in_review','need_docs')) AS in_review
        FROM pre_tender_requests
        WHERE customer_inn = $1
      `, [inn]),

      // ТКП
      db.query(`
        SELECT
          COUNT(*)                                                           AS total,
          COUNT(*) FILTER (WHERE client_decision = 'accepted')              AS accepted,
          COUNT(*) FILTER (WHERE client_decision = 'rejected')              AS rejected,
          COUNT(*) FILTER (WHERE status IN ('sent','approved') AND client_decision IS NULL) AS awaiting,
          COALESCE(SUM(total_sum) FILTER (WHERE client_decision = 'accepted'), 0) AS accepted_sum
        FROM tkp
        WHERE customer_inn = $1
      `, [inn]),

      // Работы: через customer_inn напрямую ИЛИ через тендер (UNION чтобы не упустить старые записи)
      db.query(`
        SELECT
          COUNT(DISTINCT id)                                                AS total,
          COUNT(DISTINCT id) FILTER (WHERE work_status NOT IN ('Работы сдали','Закрыт')) AS active,
          COUNT(DISTINCT id) FILTER (WHERE work_status IN ('Работы сдали','Закрыт'))     AS completed,
          COALESCE(SUM(contract_value), 0)                                 AS total_value,
          COALESCE(SUM(contract_value) FILTER (WHERE work_status NOT IN ('Работы сдали','Закрыт')), 0) AS active_value
        FROM works
        WHERE (
          customer_inn = $1
          OR tender_id IN (SELECT id FROM tenders WHERE customer_inn = $1 AND deleted_at IS NULL)
        )
        AND deleted_at IS NULL
      `, [inn]),

      // Финансы: акты и счета
      db.query(`
        SELECT
          (SELECT COALESCE(SUM(amount), 0)  FROM acts    WHERE customer_inn = $1 AND status = 'paid')    AS acts_paid_sum,
          (SELECT COALESCE(SUM(amount), 0)  FROM acts    WHERE customer_inn = $1 AND status != 'paid')   AS acts_unpaid_sum,
          (SELECT COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0)
                                            FROM invoices WHERE customer_inn = $1)                       AS invoices_outstanding,
          (SELECT COUNT(*)                  FROM invoices WHERE customer_inn = $1
             AND due_date < NOW() AND COALESCE(paid_amount, 0) < total_amount)                           AS overdue_invoices_cnt
      `, [inn])
    ]);

    const t  = tendersAggRes.rows[0];
    const pt = preTendersRes.rows[0];
    const k  = tkpRes.rows[0];
    const w  = worksRes.rows[0];
    const f  = financeRes.rows[0];

    // Конверсия = выиграли / (выиграли + проиграли)
    const decided = Number(t.won) + Number(t.lost);
    const conversion_pct = decided > 0 ? Math.round(Number(t.won) / decided * 100) : null;

    // Светофор
    let traffic_color, traffic_label, traffic_reason;
    const overdueCnt = Number(f.overdue_invoices_cnt);

    if (Number(t.total) < 3) {
      traffic_color  = 'gray';
      traffic_label  = 'Новый';
      traffic_reason = 'Недостаточно данных (менее 3 тендеров)';
    } else if (conversion_pct >= 40 && overdueCnt === 0) {
      traffic_color  = 'green';
      traffic_label  = 'Надёжный';
      traffic_reason = `Конверсия ${conversion_pct}%, нет просроченных счетов`;
    } else if (overdueCnt >= 2 || (conversion_pct !== null && conversion_pct < 15)) {
      traffic_color  = 'red';
      traffic_label  = 'Высокий риск';
      const parts = [];
      if (overdueCnt >= 2) parts.push(`${overdueCnt} просроч. счетов`);
      if (conversion_pct !== null && conversion_pct < 15) parts.push(`конверсия ${conversion_pct}%`);
      traffic_reason = parts.join(', ');
    } else {
      traffic_color  = 'yellow';
      traffic_label  = 'Средний риск';
      traffic_reason = `Конверсия ${conversion_pct !== null ? conversion_pct + '%' : '—'}${overdueCnt > 0 ? ', есть просрочка' : ''}`;
    }

    const dirMeta = await statsForInn(db, inn).catch(() => null);

    const contractsRes = await db.query(
      `SELECT COUNT(*)::int AS n FROM contracts ct
        WHERE (
            -- D-402 (08.11.2026): главный ключ — ИНН. По имени договор не
            -- находился, если написание расходилось на кавычки/регистр
            -- («ООО "ГАЛА ЮГ"» vs «ООО Гала Юг») — карточка показывала 0.
            regexp_replace(COALESCE(ct.customer_inn, ''), '\\D', '', 'g') = $1
            -- Запасной путь для старых записей без customer_inn.
            OR (
              COALESCE(TRIM(ct.counterparty_name), '') <> ''
              AND (
                EXISTS (
                  SELECT 1 FROM customers c WHERE c.inn = $1
                    AND lower(TRIM(c.name)) = lower(TRIM(ct.counterparty_name))
                )
                OR EXISTS (
                  SELECT 1 FROM suppliers s
                   WHERE s.deleted_at IS NULL
                     AND regexp_replace(COALESCE(s.inn,''), '\\D', '', 'g') = $1
                     AND lower(TRIM(s.name)) = lower(TRIM(ct.counterparty_name))
                )
              )
            )
          )`, [inn]
    ).catch(() => ({ rows: [{ n: 0 }] }));

    const contractsCnt = +(contractsRes.rows[0] && contractsRes.rows[0].n) || 0;

    // D-402 (08.11.2026): СПИСОК договоров и счетов контрагента, не только цифры.
    // Заказчик: «в карточке контрагента видеть все договора и счета по этому
    // контрагенту». Счётчик без списка не отвечает на вопрос «какие именно» —
    // приходилось идти в реестр договоров и искать вручную.
    //
    // Объекты этого контрагента — по трём признакам, потому что ни один не
    // заполнен у всех работ: ИНН, тендер с его ИНН, совпадение названия.
    // Только так «ООО ГСП Ремонт» видит свою стройку #417: у неё customer_inn
    // пуст, tender_id пуст, а название совпадает.
    const cpNameEarly = (profileRes.rows[0] && profileRes.rows[0].name) || '';
    const worksScopeRes = await db.query(
      `SELECT id FROM works
        WHERE deleted_at IS NULL
          AND (
            regexp_replace(COALESCE(customer_inn,''), '\\D', '', 'g') = $1
            OR tender_id IN (SELECT id FROM tenders WHERE deleted_at IS NULL AND customer_inn = $1)
            OR ($2 <> '' AND lower(trim(COALESCE(customer_name,''))) = lower(trim($2)))
          )`, [inn, cpNameEarly]
    ).catch((e) => { console.warn('[customers] works scope: ' + e.message); return { rows: [] }; });
    const workIds = (worksScopeRes.rows || []).map((r) => r.id);
    const workIdsSql = workIds.length ? `ARRAY[${workIds.join(',')}]::int[]` : 'ARRAY[]::int[]';

    // Счётчик входящих счетов — ТОТ ЖЕ scope, что и docs_list (ИНН + поставщик
    // + объекты заказчика). Раньше KPI считал только по ИНН/supplier_id и для
    // ГСП Ремонт показывал 0 при 300+ счетах по стройке #417.
    const docsInRes = await db.query(
      `SELECT COUNT(*)::int AS n FROM doc_registry d
        WHERE d.deleted_at IS NULL AND d.dir = 'in' AND d.package_type <> 'letter'
          AND (
            regexp_replace(COALESCE(d.counterparty_inn,''), '\\D', '', 'g') = $1
            OR d.supplier_id IN (
              SELECT id FROM suppliers
               WHERE deleted_at IS NULL
                 AND regexp_replace(COALESCE(inn,''), '\\D', '', 'g') = $1
            )
            OR d.work_id = ANY(${workIdsSql})
          )`, [inn]
    ).catch(() => ({ rows: [{ n: 0 }] }));
    const docsIn = +(docsInRes.rows[0] && docsInRes.rows[0].n) || 0;

    // Договоры ищем по ИНН (основной ключ) с запасным путём по имени для
    // старых записей без customer_inn.
    const contractListRes = await db.query(
      `SELECT ct.id, ct.number, ct.type, ct.status, ct.amount, ct.start_date,
              ct.counterparty_name, ct.customer_inn,
              (ct.file_path IS NOT NULL OR ct.file_url IS NOT NULL) AS has_scan,
              (SELECT count(*)::int FROM doc_registry d
                WHERE d.deleted_at IS NULL AND d.contract_id = ct.id) AS docs_count
         FROM contracts ct
        WHERE regexp_replace(COALESCE(ct.customer_inn, ''), '\\D', '', 'g') = $1
           OR (
             COALESCE(TRIM(ct.counterparty_name), '') <> ''
             AND lower(TRIM(ct.counterparty_name)) = lower(TRIM($2))
           )
        ORDER BY ct.start_date DESC NULLS LAST, ct.id DESC
        LIMIT 50`, [inn, (profileRes.rows[0] && profileRes.rows[0].name) || '']
    ).catch(() => ({ rows: [] }));

    // Счета (входящие) контрагента — по ИНН и через справочник поставщиков.
    const docListRes = await db.query(
      `SELECT d.id, d.invoice_number, d.invoice_date, d.amount_gross, d.ops_status,
              d.pay_status, d.contract_id, d.spend_kind,
              COALESCE(w.work_number, '') AS work_number,
              COALESCE(w.object_name, w.work_title, '') AS object_name
         FROM doc_registry d
         LEFT JOIN works w ON w.id = d.work_id
        WHERE d.deleted_at IS NULL AND d.dir = 'in' AND d.package_type <> 'letter'
          AND (
            -- 1. Счёт от этого контрагента (по ИНН или справочнику поставщиков).
            regexp_replace(COALESCE(d.counterparty_inn,''), '\\D', '', 'g') = $1
            OR d.supplier_id IN (
              SELECT id FROM suppliers
               WHERE deleted_at IS NULL
                 AND regexp_replace(COALESCE(inn,''), '\\D', '', 'g') = $1
            )
            -- 2. Счёт по объекту (работе) этого контрагента. Нужно для ОБС:
            --    ГСП — ЗАКАЗЧИК субподряда, а счета идут от третьих поставщиков
            --    (Безопасность Труда, ЭкоЦентр, Комус). Без этой ветки карточка
            --    «ООО ГСП Ремонт» показывала 0 счетов по своей же стройке.
            OR d.work_id = ANY(${workIdsSql})
          )
        ORDER BY d.invoice_date DESC NULLS LAST, d.id DESC
        LIMIT 300`, [inn]
    ).catch(() => ({ rows: [] }));

    const invoicesOut = await db.query(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE customer_inn = $1`, [inn]
    ).catch(() => ({ rows: [{ n: 0 }] }));
    const invOut = +(invoicesOut.rows[0] && invoicesOut.rows[0].n) || 0;

    // ─────────────────────────────────────────────────────────────────────
    // V475: полная карточка контрагента.
    //
    // Заказчик 08.11.2026: «в карточке контрагента мы должны видеть информацию
    // если у него подходит лимит ОБС и сколько он выработал», «какие именно
    // счета — исходящие и входящие, кто и когда выставлял», «если есть исх
    // письма — все должны быть», «вся история контрагента».
    //
    // Что здесь добавлено к D-402:
    //   • ОБС-договоры с лимитом (раньше их не было вовсе: customer_inn пуст);
    //   • исходящие счета (`invoices`) — раньше только счётчик;
    //   • письма (`correspondence`) — по ИНН и по имени;
    //   • хронология, собранная из всех источников.
    // ─────────────────────────────────────────────────────────────────────
    const cpName = cpNameEarly;

    const obsContractsRes = await db.query(
      `SELECT a.id, a.number, a.agreement_date, a.customer_name, a.customer_inn,
              a.work_id, a.limit_amount, a.is_active,
              COALESCE(st.spent_amount, 0)::numeric AS spent_amount,
              COALESCE(st.remaining, a.limit_amount)::numeric AS remaining,
              COALESCE(st.used_pct, 0)::numeric AS used_pct,
              COALESCE(st.exhausted, FALSE) AS exhausted,
              COALESCE(agg.docs_count, 0)::int AS docs_count
         FROM subcontract_agreements a
         LEFT JOIN LATERAL subcontract_limit_state(a.id) st ON TRUE
         LEFT JOIN LATERAL (
           SELECT count(*) FILTER (WHERE d.package_type <> 'letter')::int AS docs_count
             FROM doc_registry d
            WHERE d.deleted_at IS NULL AND d.subcontract_id = a.id
         ) agg ON TRUE
        WHERE a.is_active = TRUE
          AND (
            regexp_replace(COALESCE(a.customer_inn, ''), '\\D', '', 'g') = $1
            OR a.counterparty_id = $2
            -- Третий путь: договор привязан к объекту этого заказчика.
            OR a.work_id = ANY(${workIdsSql})
          )
        ORDER BY a.agreement_date DESC NULLS LAST, a.id DESC`, [inn, String((profileRes.rows[0] && profileRes.rows[0].id) || '')]
    ).catch(() => ({ rows: [] }));

    // Исходящие счета: invoice_number, дата, сумма, оплачено, просрочка.
    const invoicesOutRes = await db.query(
      `SELECT id, invoice_number, invoice_date, status, total_amount, amount,
              paid_amount, due_date, work_id, description, created_by, created_at
         FROM invoices
        WHERE customer_inn = $1
        ORDER BY invoice_date DESC NULLS LAST, id DESC
        LIMIT 200`, [inn]
    ).catch(() => ({ rows: [] }));

    // Письма: по ИНН (быстрый путь) + по имени (старые записи без ИНН).
    // Имя сравниваем в нижнем регистре и без кавычек — написания расходятся
    // («ООО "ГСП РЕМОНТ"» / «ООО «ГСП Ремонт»»).
    const lettersRes = await db.query(
      `SELECT c.id, c.number, c.date, c.direction, c.letter_kind, c.doc_type,
              c.subject, c.counterparty, c.counterparty_inn, c.status, c.file_path,
              c.obs_invoice_doc_id, c.obs_account_id,
              COALESCE(a.name, '') AS obs_account_name,
              COALESCE(dd.invoice_number, '') AS invoice_number,
              dd.amount_gross AS invoice_amount
         FROM correspondence c
         LEFT JOIN obs_accounts a ON a.id = c.obs_account_id
         LEFT JOIN doc_registry dd ON dd.id = c.obs_invoice_doc_id
        WHERE c.deleted_at IS NULL
          AND (
            regexp_replace(COALESCE(c.counterparty_inn, ''), '\\D', '', 'g') = $1
            OR (
              $2 <> '' AND
              lower(replace(replace(replace(replace(COALESCE(c.counterparty,''), '"', ''), '«', ''), '»', ''), '  ', ' '))
                LIKE '%' || lower(replace(replace(replace(replace($2,'"',''),'«',''),'»',''),'  ',' ')) || '%'
            )
            -- Письма по счетам объекта этого заказчика (ОБС: письмо выписано
            -- не заказчику, а поставщику — в тексте стоит его имя).
            OR c.obs_invoice_doc_id IN (
              SELECT dd2.id FROM doc_registry dd2
               WHERE dd2.deleted_at IS NULL
                 AND dd2.work_id = ANY(${workIdsSql})
            )
            OR c.work_id = ANY(${workIdsSql})
          )
        ORDER BY c.date DESC NULLS LAST, c.id DESC
        LIMIT 300`, [inn, cpName]
    ).catch(() => ({ rows: [] }));

    // Работы контрагента — нужны и для вкладки «Сделки», и для хронологии.
    const worksListRes = workIds.length ? await db.query(
      `SELECT id, work_number, work_title, object_name, work_status,
              contract_value, start_plan, end_fact, created_at
         FROM works
        WHERE deleted_at IS NULL AND id = ANY($1::int[])
        ORDER BY id DESC
        LIMIT 200`, [workIds]
    ).catch((e) => { console.warn('[customers] works list: ' + e.message); return { rows: [] }; })
      : { rows: [] };

    // Сводка по ОБС-лимитам: суммарный лимит, выработано, остаток.
    const obsRows = obsContractsRes.rows || [];
    const obsLimits = obsRows.reduce((acc, r) => {
      const amount = Number(r.limit_amount) || 0;
      const spent = Number(r.spent_amount) || 0;
      acc.limit += amount;
      acc.spent += spent;
      acc.remaining += amount - spent;
      if (r.exhausted) acc.exhausted_count += 1;
      else if (amount > 0 && (amount - spent) / amount < 0.1) acc.near_limit_count += 1;
      return acc;
    }, { limit: 0, spent: 0, remaining: 0, exhausted_count: 0, near_limit_count: 0 });
    obsLimits.used_pct = obsLimits.limit > 0
      ? Math.round(obsLimits.spent / obsLimits.limit * 10000) / 100
      : 0;
    obsLimits.near_limit = obsLimits.near_limit_count > 0 || obsLimits.exhausted_count > 0;

    // ── Хронология ──
    // Собирается из уже полученных данных: отдельных таблиц истории нет
    // (`customer_score_events` пуста). Сортируем по дате убыванием.
    const timeline = [];
    for (const r of contractsRes.rows || []) {
      if (r.start_date) timeline.push({
        date: r.start_date, kind: 'contract', id: r.id,
        title: `Заключён договор ${r.number || ''}`.trim(),
        amount: r.amount != null ? Number(r.amount) : null,
      });
    }
    for (const r of obsRows) {
      if (r.agreement_date) timeline.push({
        date: r.agreement_date, kind: 'obs_contract', id: r.id,
        title: `ОБС-договор ${r.number || ''}`.trim(),
        amount: Number(r.limit_amount) || null,
        note: 'лимит существенности',
      });
    }
    for (const r of docListRes.rows || []) {
      if (r.invoice_date) timeline.push({
        date: r.invoice_date, kind: 'doc_in', id: r.id,
        title: `Входящий счёт ${r.invoice_number || 'б/н'}`.trim(),
        amount: Number(r.amount_gross) || null,
        note: r.ops_status || null,
      });
    }
    for (const r of invoicesOutRes.rows || []) {
      if (r.invoice_date) timeline.push({
        date: r.invoice_date, kind: 'doc_out', id: r.id,
        title: `Выставлен счёт ${r.invoice_number || 'б/н'}`.trim(),
        amount: Number(r.total_amount || r.amount) || null,
        note: r.status || null,
      });
    }
    for (const r of lettersRes.rows || []) {
      if (r.date) timeline.push({
        date: r.date, kind: 'letter', id: r.id,
        title: `${r.direction === 'in' ? 'Входящее' : 'Исходящее'} письмо ${r.number || 'б/н'}`.trim(),
        note: r.letter_kind === 'obs_payment' ? 'оплата через ОБС' : (r.doc_type || null),
      });
    }
    for (const r of worksListRes.rows || []) {
      if (r.created_at) timeline.push({
        date: r.created_at, kind: 'work', id: r.id,
        title: `Работа ${r.work_number || ''} ${r.work_title || r.object_name || ''}`.replace(/\s+/g, ' ').trim(),
        amount: r.contract_value != null ? Number(r.contract_value) : null,
        note: r.work_status || null,
      });
    }
    const tendersListRes = await db.query(
      `SELECT id, tender_number, title, tender_status, tender_price, created_at, updated_at
         FROM tenders
        WHERE customer_inn = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC NULLS LAST
        LIMIT 200`, [inn]
    ).catch(() => ({ rows: [] }));
    for (const r of tendersListRes.rows || []) {
      if (r.created_at) timeline.push({
        date: r.created_at, kind: 'tender', id: r.id,
        title: `Тендер ${r.tender_number || ''} ${r.title || ''}`.replace(/\s+/g, ' ').trim(),
        amount: r.tender_price != null ? Number(r.tender_price) : null,
        note: r.tender_status || null,
      });
    }

    // Сортируем по нормализованной дате, а не по строковому виду: у работ
    // приходит Date, у документов — строка, и смешанное сравнение давало
    // случайный порядок.
    for (const t of timeline) t.date = toIsoDate(t.date);
    timeline.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return {
      profile: profileRes.rows[0] || null,
      traffic_light: { color: traffic_color, label: traffic_label, reason: traffic_reason },
      roles: (dirMeta && dirMeta.roles) || null,
      relation_status: (dirMeta && dirMeta.relation_status) || null,
      is_active_relation: !!(dirMeta && dirMeta.is_active_relation),
      supplier_id: (dirMeta && dirMeta.supplier_id) || null,
      dadata_status: (dirMeta && dirMeta.dadata_status) || 'unchecked',
      kpi: {
        contracts: contractsCnt,
        tenders: +t.total,
        works: +w.total,
        docs: docsIn + invOut,
        docs_in: docsIn,
        invoices_out: invOut
      },
      // D-402: списки для карточки — по ним видно, какие именно договоры и
      // счета относятся к этому контрагенту. Счётчики выше остаются для KPI.
      contracts_list: contractListRes.rows.map((r) => ({
        id: r.id,
        number: r.number,
        type: r.type,
        status: r.status,
        amount: r.amount != null ? Number(r.amount) : null,
        date: r.start_date,
        counterparty_name: r.counterparty_name,
        has_scan: !!r.has_scan,
        docs_count: +r.docs_count || 0
      })),
      docs_list: docListRes.rows.map((r) => ({
        id: r.id,
        invoice_number: r.invoice_number,
        invoice_date: r.invoice_date,
        amount: r.amount_gross != null ? Number(r.amount_gross) : null,
        ops_status: r.ops_status,
        pay_status: r.pay_status,
        contract_id: r.contract_id || null,
        spend_kind: r.spend_kind || null,
        work_number: r.work_number || null,
        object_name: r.object_name || null
      })),
      // Полный счётчик (docs_list обрезан LIMIT 300) — чтобы UI показал
      // «показаны 300 из N», а KPI не врал.
      docs_total: docsIn,
      // ── V475: блоки полной карточки ──
      // eslint-disable-next-line no-use-before-define
      obs_contracts_list: obsRows.map((r) => ({
        id: r.id,
        number: r.number,
        date: r.agreement_date,
        customer_name: r.customer_name,
        customer_inn: r.customer_inn,
        work_id: r.work_id,
        docs_count: +r.docs_count || 0,
        limit: {
          amount: Number(r.limit_amount) || 0,
          spent: Number(r.spent_amount) || 0,
          remaining: Number(r.remaining) || 0,
          used_pct: Number(r.used_pct) || 0,
          exhausted: !!r.exhausted,
        },
      })),
      obs_limits: obsLimits,
      invoices_out_list: (invoicesOutRes.rows || []).map((r) => {
        const total = Number(r.total_amount || r.amount) || 0;
        const paid = Number(r.paid_amount) || 0;
        const overdue = r.due_date && paid < total
          && new Date(r.due_date).getTime() < Date.now();
        return {
          id: r.id,
          number: r.invoice_number,
          date: r.invoice_date,
          status: r.status,
          amount: total,
          paid,
          outstanding: Math.max(0, total - paid),
          due_date: r.due_date,
          overdue: !!overdue,
          work_id: r.work_id || null,
          description: r.description || null,
        };
      }),
      letters_list: (lettersRes.rows || []).map((r) => ({
        id: r.id,
        number: r.number,
        date: r.date,
        direction: r.direction,
        letter_kind: r.letter_kind,
        doc_type: r.doc_type,
        subject: r.subject,
        counterparty: r.counterparty,
        status: r.status,
        has_file: !!r.file_path,
        is_obs: r.letter_kind === 'obs_payment',
        obs_account_name: r.obs_account_name || null,
        invoice_number: r.invoice_number || null,
        invoice_amount: r.invoice_amount != null ? Number(r.invoice_amount) : null,
        invoice_doc_id: r.obs_invoice_doc_id || null,
      })),
      works_list: (worksListRes.rows || []).map((r) => ({
        id: r.id,
        number: r.work_number,
        title: r.work_title,
        object_name: r.object_name,
        status: r.work_status,
        amount: r.contract_value != null ? Number(r.contract_value) : null,
        start_date: r.start_plan,
        end_date_plan: r.end_fact,
      })),
      timeline: timeline.slice(0, 500).map((t) => ({
        ...t,
        // Дата приводится к YYYY-MM-DD: у работ приходит Date-объект, у
        // документов — строка. `String(date).slice(0,10)` от Date давал
        // «Wed Jul 29» — в хронологии стояли дни недели вместо дат.
        date: toIsoDate(t.date),
      })),
      tenders: {
        total:        +t.total,
        won:          +t.won,
        lost:         +t.lost,
        cancelled:    +t.cancelled,
        in_work:      +t.in_work,
        won_sum:      +t.won_sum,
        lost_sum:     +t.lost_sum,
        in_work_sum:  +t.in_work_sum,
        conversion_pct,
        last_tender_at: t.last_tender_at,
        by_status: tendersByStatusRes.rows
      },
      pre_tenders: {
        total:     +pt.total,
        accepted:  +pt.accepted,
        rejected:  +pt.rejected,
        in_review: +pt.in_review
      },
      tkp: {
        total:        +k.total,
        accepted:     +k.accepted,
        rejected:     +k.rejected,
        awaiting:     +k.awaiting,
        accepted_sum: +k.accepted_sum
      },
      works: {
        total:       +w.total,
        active:      +w.active,
        completed:   +w.completed,
        total_value: +w.total_value,
        active_value:+w.active_value
      },
      finance: {
        acts_paid_sum:       +f.acts_paid_sum,
        acts_unpaid_sum:     +f.acts_unpaid_sum,
        invoices_outstanding:+f.invoices_outstanding,
        overdue_invoices_cnt: overdueCnt
      },
      docs: { incoming: docsIn, outgoing_invoices: invOut },
      contracts: { total: contractsCnt },
      last_contact: t.last_tender_at || null
    };
  });

  // ─── PUT /:inn/score — записать событие и пересчитать кэш рейтинга ──────────
  // Принимает { event, amount, ref_type?, ref_id?, meta? }.
  // Карта событий → delta:
  //   tender_created  → +0.10   (просто факт интереса)
  //   tender_won      → +0.50
  //   tender_lost     → -0.20
  //   tender_archived → -0.10
  //   invoice_paid    → +0.30
  //   invoice_overdue → -0.40
  // Базовая оценка 3.0; clamp 1..5.
  //
  // RBAC: те же роли что POST/PUT — кто может создавать тендеры/работы.
  // Возвращает { score, events_count, last_events:[…5] }.
  fastify.put('/:inn/score', {
    preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH'])]
  }, async (request, reply) => {
    const inn = String(request.params.inn || '').replace(/\D/g, '');
    if (inn.length !== 10 && inn.length !== 12) {
      return reply.code(400).send({ error: 'Некорректный ИНН (должен содержать 10 или 12 цифр)' });
    }

    const { event, amount, ref_type, ref_id, meta } = request.body || {};
    if (!event || typeof event !== 'string') {
      return reply.code(400).send({ error: 'event обязателен' });
    }

    const DELTAS = {
      tender_created:  0.10,
      tender_won:      0.50,
      tender_lost:    -0.20,
      tender_archived:-0.10,
      tkp_accepted:    0.30,
      tkp_rejected:   -0.20,
      invoice_paid:    0.30,
      invoice_overdue:-0.40,
      manual_up:       0.20,
      manual_down:    -0.20
    };
    const delta = DELTAS[event] != null ? DELTAS[event] : 0;

    // Запись события
    await db.query(
      `INSERT INTO customer_score_events
        (customer_inn, event_type, amount, delta, ref_type, ref_id, meta, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        inn,
        event,
        amount != null && Number.isFinite(Number(amount)) ? Number(amount) : null,
        delta,
        ref_type || null,
        ref_id != null && Number.isFinite(Number(ref_id)) ? Number(ref_id) : null,
        meta ? JSON.stringify(meta) : null,
        request.user.id || null
      ]
    );

    // Пересчёт кэша: базис 3.0 + сумма дельт по всем событиям, clamp 1..5.
    const aggRes = await db.query(
      `SELECT COALESCE(SUM(delta), 0)::float AS sum_delta, COUNT(*)::int AS cnt
         FROM customer_score_events
        WHERE customer_inn = $1`,
      [inn]
    );
    const sumDelta = Number(aggRes.rows[0].sum_delta) || 0;
    let score = 3.0 + sumDelta;
    if (score < 1) score = 1;
    if (score > 5) score = 5;
    score = Math.round(score * 10) / 10;

    // Обновляем кэш в customers (если контрагент существует)
    await db.query(
      `UPDATE customers
          SET customer_score = $1,
              customer_score_updated_at = NOW()
        WHERE inn = $2`,
      [score, inn]
    );

    // Последние 5 событий — для UI
    const eventsRes = await db.query(
      `SELECT id, event_type, amount, delta, ref_type, ref_id, created_at
         FROM customer_score_events
        WHERE customer_inn = $1
        ORDER BY created_at DESC
        LIMIT 5`,
      [inn]
    );

    return {
      score,
      events_count: Number(aggRes.rows[0].cnt) || 0,
      last_events: eventsRes.rows
    };
  });

  // ─── GET /:inn/score — текущий кэш + история событий (для карточки контрагента)
  fastify.get('/:inn/score', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const inn = String(request.params.inn || '').replace(/\D/g, '');
    if (inn.length !== 10 && inn.length !== 12) {
      return reply.code(400).send({ error: 'Некорректный ИНН' });
    }
    const cust = await db.query(
      `SELECT customer_score, customer_score_updated_at FROM customers WHERE inn = $1`,
      [inn]
    );
    const events = await db.query(
      `SELECT id, event_type, amount, delta, ref_type, ref_id, created_at, created_by
         FROM customer_score_events
        WHERE customer_inn = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [inn]
    );
    return {
      score: cust.rows[0]?.customer_score ?? null,
      updated_at: cust.rows[0]?.customer_score_updated_at ?? null,
      events: events.rows
    };
  });

  // GET /:inn/analysis-checklists — история чек-листов анализа по контрагенту (D-203).
  // Ищем по ИНН, с фолбэком по названию (у старых тендеров ИНН мог быть пуст).
  // Роли: только те, кто работает с тендерами/анализом. В вопросах и ответах есть
  // бюджет заказчика и оценка конкурентов — склад/кадры/бухгалтерия/закупки сюда не ходят.
  const CHECKLIST_VIEW_ROLES = [
    'ADMIN', 'TO', 'HEAD_TO', 'PM', 'HEAD_PM',
    'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'
  ];
  fastify.get('/:inn/analysis-checklists', {
    preHandler: [fastify.authenticate, fastify.requireRoles(CHECKLIST_VIEW_ROLES)]
  }, async (request, reply) => {
    const inn = String(request.params.inn || '').replace(/\D/g, '');
    if (inn.length !== 10 && inn.length !== 12) {
      return reply.code(400).send({ error: 'Некорректный ИНН' });
    }
    const cust = await db.query('SELECT name FROM customers WHERE inn = $1', [inn]);
    const name = cust.rows[0]?.name || null;

    // D-203: мягко удалённый тендер чек-лист не отдаёт — ни здесь, ни в :id-роутах.
    // Это ТРЕТЬЕ повторение одного класса (сначала .docx, потом GET /:id, теперь история):
    // инвариант держится не конструкцией, а аккуратностью на каждом маршруте — поэтому
    // условие стоит явно и закреплено гейтом (7f / 7f-bis).
    const r = await db.query(`
      SELECT c.id, c.tender_id, c.answers, c.free_answers, c.template_snapshot,
             c.work_title, c.customer_name, c.customer_inn, c.created_at, c.updated_at,
             c.created_by_user_id, u.name AS author_name,
             t.registry_no
      FROM tender_analysis_checklists c
      LEFT JOIN users u ON u.id = c.created_by_user_id
      JOIN tenders t ON t.id = c.tender_id AND t.deleted_at IS NULL
      WHERE c.customer_inn = $1
         OR ($2::text IS NOT NULL AND c.customer_name = $2)
      ORDER BY COALESCE(c.updated_at, c.created_at) DESC
      LIMIT 100
    `, [inn, name]);

    return { inn, customer_name: name, items: r.rows };
  });

  fastify.delete('/:inn', { preHandler: [fastify.requireRoles(['ADMIN'])] }, async (request, reply) => {
    try {
      const result = await db.query('DELETE FROM customers WHERE inn = $1 RETURNING inn', [request.params.inn]);
      if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
      return { message: 'Удалено' };
    } catch (e) {
      if (e.code === '23503') {
        return reply.code(400).send({ error: 'Невозможно удалить — есть связанные тендеры или другие записи' });
      }
      throw e;
    }
  });
}

module.exports = routes;
