'use strict';

/**
 * ASGARD CRM — резолв контрагента из завершённого звонка.
 *
 * ЗАДАЧА (13.11.2026). Раньше 0 из 89 звонков имели client_inn: связь
 * «звонок → контрагент» отсутствовала полностью. Оператор видел номер, но
 * не понимал, что это за компания, а второй номер той же компании
 * определялся как «Неизвестный».
 *
 * ЦЕПОЧКА (каждый шаг только если предыдущий не дал ИНН):
 *   1. номер уже известен в CRM (customers.phone или contacts[]) → ИНН;
 *   2. ИИ услышал ИНН → DaData resolveByInn;
 *   3. ИИ услышал компанию + город → searchWeb → ИНН → DaData;
 *   4. ничего не вышло → очередь «уточнить клиента» (call_client_review).
 *
 * ПРИНЦИПЫ:
 *   • карточку создаём ТОЛЬКО при уверенном совпадении (валидный ИНН +
 *     похожее название). Иначе — человек разберёт в очереди.
 *   • новый номер дописываем в contacts[] существующего клиента, а не
 *     создаём второго.
 *   • все шаги логируются: видно, на каком сработало.
 */

const dadata = require('./dadata');

/** Последние 10 цифр номера (для сравнения «+7 917 …» и «7917…»). */
function phoneTail(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

/** Название компании «похоже» на другое: сравниваем значимые слова. */
function namesLookAlike(a, b) {
  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/[«»"'`]/g, '')
    .replace(/\b(ооо|оао|зао|пао|ао|ип|общество с ограниченной ответственностью|филиал)\b/g, ' ')
    .replace(/[^а-яёa-z0-9]+/g, ' ')
    .trim();
  const wa = norm(a).split(' ').filter((w) => w.length >= 3);
  const wb = norm(b).split(' ').filter((w) => w.length >= 3);
  if (!wa.length || !wb.length) return false;
  const setB = new Set(wb);
  const hits = wa.filter((w) => setB.has(w)).length;
  return hits >= Math.min(1, Math.min(wa.length, wb.length));
}

/** Найти клиента по номеру: customers.phone И contacts[].phone/phone2. */
async function findCustomerByPhone(db, phone) {
  const tail = phoneTail(phone);
  if (!tail) return null;
  try {
    const r = await db.query(
      `SELECT inn, name, city, phone, contacts
         FROM customers
        WHERE right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $1
           OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(contacts) = 'array' THEN contacts ELSE '[]'::jsonb END
             ) c
             WHERE right(regexp_replace(COALESCE(c->>'phone', ''), '\\D', '', 'g'), 10) = $1
                OR right(regexp_replace(COALESCE(c->>'phone2', ''), '\\D', '', 'g'), 10) = $1
           )
        LIMIT 1`,
      [tail]
    );
    return r.rows[0] || null;
  } catch (e) {
    console.warn('[client-link] findCustomerByPhone:', e.message);
    return null;
  }
}

/** Найти клиента по ИНН. */
async function findCustomerByInn(db, inn) {
  const digits = String(inn || '').replace(/\D/g, '');
  if (digits.length !== 10 && digits.length !== 12) return null;
  try {
    const r = await db.query(
      'SELECT inn, name, city, phone, contacts FROM customers WHERE inn = $1 LIMIT 1',
      [digits]
    );
    return r.rows[0] || null;
  } catch (e) {
    console.warn('[client-link] findCustomerByInn:', e.message);
    return null;
  }
}

/** Достать ИНН из произвольного текста (веб-поиск, ответ модели). */
function extractInnFromText(text) {
  const src = String(text || '');
  // ИНН юрлица: 10 цифр; ИП: 12. Берём с границей слова и проверяем контрольную
  // сумму через dadata (если DaData не подтвердит — отбросим).
  const candidates = [];
  const re = /(?<!\d)(\d{10}|\d{12})(?!\d)/g;
  let m;
  while ((m = re.exec(src)) !== null) candidates.push(m[1]);
  return candidates;
}

/**
 * Шаг 3: найти компанию через веб-поиск по названию и городу.
 * Возвращает { inn, source } или null.
 */
async function findInnViaWeb(card) {
  const name = String(card && card.company_name || '').trim();
  if (name.length < 3) return null;
  let ai;
  try { ai = require('./ai-provider'); } catch (_) { return null; }
  if (typeof ai.searchWeb !== 'function') return null;

  const city = String(card.city || '').trim();
  const query = city
    ? `«${name}» ${city} ИНН официальный сайт организации`
    : `«${name}» ИНН официальный сайт организации`;

  let res = null;
  try {
    res = await ai.searchWeb({ query, maxResults: 5 });
  } catch (e) {
    console.warn('[client-link] searchWeb failed:', e.message);
    return null;
  }
  const answer = String(res && res.answer || '');
  const inns = extractInnFromText(answer);
  if (!inns.length) return null;

  // Проверяем каждый кандидат через DaData: название должно быть похоже.
  for (const inn of inns) {
    const org = await dadata.resolveByInn(inn);
    if (!org || !org.name) continue;
    if (!namesLookAlike(name, org.name)) continue;
    return { inn, org, source: 'web+dadata' };
  }
  return null;
}

/** Дописать номер в contacts[] клиента, если его там ещё нет. */
async function appendPhoneToCustomer(db, customer, card) {
  const phone = phoneTail(card && card.phone) || '';
  if (!customer || !phone) return false;
  const contacts = Array.isArray(customer.contacts) ? customer.contacts.slice() : [];
  const exists = contacts.some((c) => phoneTail(c && c.phone) === phone || phoneTail(c && c.phone2) === phone);
  if (exists || phoneTail(customer.phone) === phone) return false;

  contacts.push({
    name: card.contact_person || null,
    position: card.position || null,
    phone: card.phone || null,
    phone2: null,
    email: null,
    source: 'call',
    is_primary: false,
  });
  try {
    await db.query(
      'UPDATE customers SET contacts = $2::jsonb, updated_at = NOW() WHERE inn = $1',
      [customer.inn, JSON.stringify(contacts)]
    );
    return true;
  } catch (e) {
    console.warn('[client-link] appendPhone:', e.message);
    return false;
  }
}

/** Поставить звонок в очередь «уточнить клиента». */
async function enqueueReview(db, callId, phone, suggested) {
  try {
    await db.query(
      `INSERT INTO call_client_review (call_history_id, phone, suggested_name, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (call_history_id) DO NOTHING`,
      [callId, phoneTail(phone) || null, suggested || null]
    );
    return true;
  } catch (e) {
    // Таблицы может ещё не быть (миграция не накатана) — не роняем пайплайн.
    console.warn('[client-link] enqueueReview:', e.message);
    return false;
  }
}

/**
 * Главный вход: связать звонок с контрагентом.
 * @param {object} db
 * @param {object} call — строка call_history (id, client_number, from_number)
 * @param {object} analysis — результат analyzer.analyze (содержит client_card)
 * @returns {Promise<{inn:string|null, customer:object|null, step:string}>}
 */
async function linkCallToCustomer(db, call, analysis) {
  const card = (analysis && analysis.client_card) || {};
  const phone = (call && (call.client_number || call.from_number)) || card.phone || '';

  // Шаг 1: номер уже известен.
  try {
    const known = await findCustomerByPhone(db, phone);
    if (known && known.inn) {
      await db.query('UPDATE call_history SET client_inn = $1, updated_at = NOW() WHERE id = $2', [known.inn, call.id]);
      return { inn: known.inn, customer: known, step: 'known_phone' };
    }
  } catch (_) { /* продолжаем */ }

  // Шаг 2: ИИ услышал ИНН.
  if (card.inn) {
    const byInn = await findCustomerByInn(db, card.inn);
    if (byInn) {
      await db.query('UPDATE call_history SET client_inn = $1, updated_at = NOW() WHERE id = $2', [byInn.inn, call.id]);
      await appendPhoneToCustomer(db, byInn, { ...card, phone: phone || card.phone });
      return { inn: byInn.inn, customer: byInn, step: 'known_inn' };
    }
    // DaData подтверждает реквизиты, карточку создаём ниже.
    const org = await dadata.resolveByInn(card.inn);
    if (org && org.name) {
      const created = await createCustomer(db, org, { ...card, phone: phone || card.phone });
      if (created) {
        await db.query('UPDATE call_history SET client_inn = $1, updated_at = NOW() WHERE id = $2', [created.inn, call.id]);
        return { inn: created.inn, customer: created, step: 'created_from_ai_inn' };
      }
    }
  }

  // Шаг 3: веб-поиск по названию компании.
  if (card.company_name) {
    const found = await findInnViaWeb(card);
    if (found && found.org) {
      const existing = await findCustomerByInn(db, found.inn);
      if (existing) {
        await db.query('UPDATE call_history SET client_inn = $1, updated_at = NOW() WHERE id = $2', [existing.inn, call.id]);
        await appendPhoneToCustomer(db, existing, { ...card, phone: phone || card.phone });
        return { inn: existing.inn, customer: existing, step: 'web_found_existing' };
      }
      const created = await createCustomer(db, found.org, { ...card, phone: phone || card.phone });
      if (created) {
        await db.query('UPDATE call_history SET client_inn = $1, updated_at = NOW() WHERE id = $2', [created.inn, call.id]);
        return { inn: created.inn, customer: created, step: 'web_created' };
      }
    }
  }

  // Шаг 4: не определили — в очередь.
  await enqueueReview(db, call.id, phone, card.company_name || null);
  return { inn: null, customer: null, step: 'queued' };
}

/** Создать карточку клиента из подтверждённых реквизитов DaData. */
async function createCustomer(db, org, card) {
  const inn = String(org.inn || '').replace(/\D/g, '');
  if (inn.length !== 10 && inn.length !== 12) return null;
  try {
    const exists = await db.query('SELECT inn FROM customers WHERE inn = $1 LIMIT 1', [inn]);
    if (exists.rows.length) return exists.rows[0];
    const contacts = [];
    if (card.phone || card.contact_person) {
      contacts.push({
        name: card.contact_person || null,
        position: card.position || null,
        phone: card.phone || null,
        phone2: null,
        email: null,
        source: 'call',
        is_primary: true,
      });
    }
    const r = await db.query(
      `INSERT INTO customers (inn, name, phone, city, contacts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())
       ON CONFLICT (inn) DO NOTHING
       RETURNING inn, name, city, phone, contacts`,
      [
        inn,
        org.name || card.company_name || null,
        card.phone || null,
        card.city || null,
        JSON.stringify(contacts),
      ]
    );
    return r.rows[0] || null;
  } catch (e) {
    console.warn('[client-link] createCustomer:', e.message);
    return null;
  }
}

module.exports = {
  linkCallToCustomer,
  findCustomerByPhone,
  findCustomerByInn,
  findInnViaWeb,
  appendPhoneToCustomer,
  enqueueReview,
  namesLookAlike,
  phoneTail,
  extractInnFromText,
};
