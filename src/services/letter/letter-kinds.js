'use strict';

/**
 * src/services/letter/letter-kinds.js
 *
 * Словарь типов писем «Официальной переписки».
 * Источник: settings.letter_kinds (JSON-словарь, сидируется миграцией V251).
 *
 * Зачем отдельный сервис:
 *   - Композер композирует selector «Тип письма» (9 вариантов) и подставляет
 *     {{company_name}} в subline-шаблон.
 *   - Админ может править словарь из UI (изменить title/sub/subline) без деплоя
 *     кода — V251 сидирует только если ключа ещё нет, повторный apply ничего
 *     не перетирает.
 *   - getAllKinds() кэшируется на 5 минут — settings меняются редко, в БД ходим
 *     не на каждый запрос композера.
 *
 * Контракт (_LETTER_CONTRACT.md §3):
 *   - При выборе типа → title идёт в заголовок документа (Times 12pt bold).
 *   - sub → подзаголовок курсивом.
 *   - subline → подпрефикс под Исх.№ с подстановкой {{company_name}}.
 *   - applyKindTemplate выполняет подстановку перед сохранением в
 *     correspondence.{doc_title, doc_sub, header_subline}.
 *
 * Зависимости:
 *   - db: '../db' (общий pg-pool из src/services/db.js).
 */

const db = require('../db');

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 минут — словарь стабилен, перетереть админом редко
const SETTINGS_KEY = 'letter_kinds';

const cache = new Map(); // key -> { data, ts }

/**
 * Сбросить кэш. Вызывается из обработчика PUT /api/settings (при сохранении
 * letter_kinds админом) — чтобы UI композера сразу подхватил правки.
 *
 * Если кэш живёт >5 мин — следующий getAllKinds() сам подхватит свежее. Этот
 * хелпер — для случая когда надо немедленно увидеть правку без ожидания TTL.
 */
function invalidateCache() {
  cache.delete(SETTINGS_KEY);
}

/**
 * Прочитать settings.letter_kinds и вернуть массив items[].
 *
 * Формат строки в settings:
 *   value_json = '{"items":[{"key":"clarification","title":"…","sub":"…","subline":"…"}, …]}'
 *
 * При первом вызове или после истечения TTL → SQL-запрос + кэширование.
 * При отсутствии строки в settings (теоретически не должно случиться после
 * V251, но safe-guard) → возвращает HARDCODED_FALLBACK (9 ключей).
 *
 * @param {object} [dbClient] — опциональный pg-клиент для транзакции.
 *                              Если не передан — общий pool из ../db.
 * @returns {Promise<Array<{key:string,title:string,sub:string,subline:string}>>}
 */
async function getAllKinds(dbClient) {
  const cached = cache.get(SETTINGS_KEY);
  if (cached && (Date.now() - cached.ts < CACHE_TTL_MS)) {
    return cached.data;
  }

  const client = dbClient || db;
  let items;
  try {
    const r = await client.query(
      "SELECT value_json FROM settings WHERE key = $1 LIMIT 1",
      [SETTINGS_KEY]
    );
    if (!r.rows.length || !r.rows[0].value_json) {
      // Строка settings нет — это значит V251 не применён или была ручная
      // очистка. Возвращаем fallback и логируем (чтобы заметили админы).
      console.warn(`[letter-kinds] settings.${SETTINGS_KEY} отсутствует, использую hardcoded fallback`);
      items = HARDCODED_FALLBACK;
    } else {
      let parsed;
      try {
        parsed = JSON.parse(r.rows[0].value_json);
      } catch (e) {
        console.error(`[letter-kinds] settings.${SETTINGS_KEY} value_json не парсится:`, e.message);
        items = HARDCODED_FALLBACK;
      }
      if (parsed && Array.isArray(parsed.items)) {
        items = parsed.items;
      } else {
        console.warn(`[letter-kinds] settings.${SETTINGS_KEY} без поля items[]`);
        items = HARDCODED_FALLBACK;
      }
    }
  } catch (e) {
    // SQL-ошибка → не отдаём UI пустой список, лучше fallback
    console.error(`[letter-kinds] SQL query failed:`, e.message);
    items = HARDCODED_FALLBACK;
  }

  cache.set(SETTINGS_KEY, { data: items, ts: Date.now() });
  return items;
}

/**
 * Получить один тип письма по ключу.
 *
 * @param {object} [dbClient]
 * @param {string} key — например 'clarification', 'free', 'request'
 * @returns {Promise<{key,title,sub,subline}|null>}
 */
async function getKindByKey(dbClient, key) {
  if (!key) return null;
  const all = await getAllKinds(dbClient);
  return all.find((k) => k.key === key) || null;
}

/**
 * Применить переменные к шаблону типа.
 *
 * Поддерживаются плейсхолдеры в полях title/sub/subline:
 *   {{company_name}}  → variables.company_name
 *   {{lot_number}}    → variables.lot_number
 *   {{procedure_number}} → variables.procedure_number
 *   {{customer_name}} → variables.customer_name
 *
 * Чистая функция, синхронная. Если поле без плейсхолдеров — возвращает as is.
 * Если плейсхолдер указан, но в variables нет — оставляет плейсхолдер пустой
 * строкой (вместо «{{undefined}}» в письме).
 *
 * @param {{key,title,sub,subline}} kind
 * @param {Record<string,string>} variables
 * @returns {{key,title,sub,subline}} новый объект (исходник не мутируется)
 */
function applyKindTemplate(kind, variables = {}) {
  if (!kind) return kind;
  const out = { key: kind.key };
  for (const field of ['title', 'sub', 'subline']) {
    out[field] = applyVars(kind[field] || '', variables);
  }
  return out;
}

function applyVars(text, variables) {
  if (!text || !text.includes('{{')) return text;
  return text.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, name) => {
    const v = variables[name];
    return v == null ? '' : String(v);
  });
}

// Fallback на случай отсутствия settings.letter_kinds — повторяет V251 seed.
// Если когда-то понадобится правка дефолтов — править И в V251.sql И здесь.
const HARDCODED_FALLBACK = [
  { key: 'clarification', title: 'ПОЯСНЕНИЯ К ЦЕНОВОМУ ПРЕДЛОЖЕНИЮ', sub: '(об обстоятельствах, исключающих дальнейшее снижение цены)', subline: 'по дополнительному запросу Организатора к заявке {{company_name}}' },
  { key: 'request',        title: 'ЗАПРОС',                 sub: '', subline: '' },
  { key: 'response',       title: 'ОТВЕТ НА ЗАПРОС',        sub: '', subline: '' },
  { key: 'notification',   title: 'УВЕДОМЛЕНИЕ',            sub: '', subline: '' },
  { key: 'claim',          title: 'ПРЕТЕНЗИЯ',              sub: '', subline: '' },
  { key: 'warranty',       title: 'ГАРАНТИЙНОЕ ПИСЬМО',     sub: '', subline: '' },
  { key: 'cover',          title: 'СОПРОВОДИТЕЛЬНОЕ ПИСЬМО', sub: '', subline: '' },
  { key: 'information',    title: 'ИНФОРМАЦИОННОЕ ПИСЬМО',  sub: '', subline: '' },
  { key: 'free',           title: '',                       sub: '', subline: '' }
];

module.exports = {
  getAllKinds,
  getKindByKey,
  applyKindTemplate,
  invalidateCache,
  // экспорт для unit-тестов
  _internal: { HARDCODED_FALLBACK, applyVars }
};

// CLI smoke (см. инструкции S-4 шаг 5):
//   node src/services/letter/letter-kinds.js
// При запуске напрямую — лезет в БД через ../db, печатает count и первые ключи.
if (require.main === module) {
  (async () => {
    try {
      const all = await getAllKinds();
      console.log(`[letter-kinds CLI smoke] count=${all.length}`);
      console.log(`[letter-kinds CLI smoke] keys=${all.map((k) => k.key).join(',')}`);
      const clar = await getKindByKey(undefined, 'clarification');
      console.log(`[letter-kinds CLI smoke] clarification.title=`, clar?.title);
      const applied = applyKindTemplate(clar, { company_name: 'ООО «Тест»' });
      console.log(`[letter-kinds CLI smoke] applied.subline=`, applied?.subline);
      process.exit(0);
    } catch (e) {
      console.error('[letter-kinds CLI smoke] FAIL:', e);
      process.exit(1);
    }
  })();
}
