/**
 * ASGARD CRM — общий резолвер организаций через Dadata.
 *
 * Единая точка обращения к Dadata вместо дублей fetch в customers.js,
 * tkp_quick.js, letter/_shared.js. Используется в т.ч. для авто-определения
 * заказчика при создании заявки/пре-тендера из письма, когда AI вытащил только
 * ИНН или корпоративную почту, но не само название организации (30.06.2026, bug #3).
 *
 * Требует process.env.DADATA_TOKEN. Без токена все функции возвращают null —
 * вызывающий код обязан работать и без Dadata (graceful degradation).
 *
 * Никогда не бросает наружу: при сетевой ошибке/таймауте → null + warn в лог.
 */
'use strict';

const DADATA_FIND_BY_ID = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party';
const DADATA_SUGGEST    = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party';

function _token() {
  return process.env.DADATA_TOKEN || null;
}

// Унификация ответа Dadata-suggestion в наш плоский shape.
function _mapSuggestion(s, fallbackInn) {
  const d = s.data || {};
  return {
    inn:       d.inn || fallbackInn || '',
    name:      (d.name && (d.name.short_with_opf || s.value)) || s.value || '',
    full_name: (d.name && d.name.full_with_opf) || (d.name && d.name.short_with_opf) || '',
    kpp:       d.kpp || '',
    ogrn:      d.ogrn || '',
    address:   (d.address && (d.address.unrestricted_value || d.address.value)) || ''
  };
}

async function _post(url, body) {
  const token = _token();
  if (!token) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Token ${token}`
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!resp.ok) throw new Error(`Dadata HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    console.warn('[dadata] request failed:', e.message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Поиск организации по ИНН (10 или 12 цифр).
 * @param {string} inn
 * @returns {Promise<{inn,name,full_name,kpp,ogrn,address}|null>}
 */
async function resolveByInn(inn) {
  const clean = String(inn || '').replace(/\D/g, '');
  if (clean.length !== 10 && clean.length !== 12) return null;
  const data = await _post(DADATA_FIND_BY_ID, { query: clean, count: 1 });
  const s = data && data.suggestions && data.suggestions[0];
  if (!s) return null;
  return _mapSuggestion(s, clean);
}

/**
 * Подбор организации по произвольному запросу (название, домен почты и т.п.).
 * Возвращает первое (самое релевантное) совпадение либо null.
 * @param {string} query
 * @returns {Promise<{inn,name,full_name,kpp,ogrn,address}|null>}
 */
async function suggestByQuery(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return null;
  const data = await _post(DADATA_SUGGEST, { query: q, count: 1 });
  const s = data && data.suggestions && data.suggestions[0];
  if (!s) return null;
  return _mapSuggestion(s, null);
}

/**
 * Композитный резолвер для заявок: пробуем ИНН → затем домен/локальную часть
 * корпоративной почты как подсказку названия. Возвращает первую успешную
 * находку либо null. Корпоративные ящики вида info@kordiant.ru дают неплохой
 * матч по «kordiant» через suggest.
 *
 * @param {{inn?:string, email?:string, hint?:string}} opts
 */
async function resolveCustomer({ inn, email, hint } = {}) {
  // 1. ИНН — самый надёжный источник.
  if (inn) {
    const byInn = await resolveByInn(inn);
    if (byInn && byInn.name) return byInn;
  }
  // 2. Явная подсказка названия (например original_sender_company из AI).
  if (hint && String(hint).trim().length >= 2) {
    const byHint = await suggestByQuery(hint);
    if (byHint && byHint.name) return byHint;
  }
  // 3. Домен/локальная часть корпоративной почты.
  if (email && String(email).includes('@')) {
    const [local, domain] = String(email).toLowerCase().split('@');
    // Бесплатные почтовики не несут названия организации — пропускаем.
    const FREE = ['mail.ru', 'gmail.com', 'yandex.ru', 'ya.ru', 'bk.ru', 'inbox.ru',
                  'list.ru', 'rambler.ru', 'outlook.com', 'hotmail.com', 'icloud.com'];
    if (domain && !FREE.includes(domain)) {
      // Берём «тело» домена без зоны: kordiant.ru → kordiant.
      const core = domain.split('.')[0];
      if (core && core.length >= 3) {
        const byDomain = await suggestByQuery(core);
        if (byDomain && byDomain.name) return byDomain;
      }
    }
  }
  return null;
}

module.exports = { resolveByInn, suggestByQuery, resolveCustomer };
