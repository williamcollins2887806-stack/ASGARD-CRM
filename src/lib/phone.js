/**
 * phone.js — единая нормализация российских телефонов (E.164).
 *
 * Зачем: по CRM телефон пишется во многие таблицы из UI/импорта/скриптов.
 * Без единого нормализатора в БД копится мусор (`8...`, `+7 (…)`, `+7+7…`),
 * а поиск по номеру (в т.ч. вход рабочих) перестаёт совпадать.
 *
 * Правило: нормализуем ТОЛЬКО когда уверены, что это валидный РФ-номер.
 * Если из значения 11 цифр с ведущей 7/8 получить нельзя (городской, два
 * номера в одной строке, ФИО внутри поля, `доб.`) — возвращаем '' и НЕ трогаем
 * исходное значение (лучше оставить как есть, чем испортить).
 */

/**
 * Канон E.164: '+7XXXXXXXXXX' — или '' если не уверены.
 *  • 8916…        → +7916…
 *  • 916… (10 цифр) → +7916…
 *  • +7 (916) …   → +7916…
 */
function toE164Ru(raw) {
  const digits = toDigitsRu(raw);
  return digits ? '+' + digits : '';
}

/**
 * То же, но без «+»: '7XXXXXXXXXX' — или '' если не уверены.
 * (Формат, который ждёт `normalizeSePhone` / матчинг по хвосту.)
 */
function toDigitsRu(raw) {
  if (raw == null) return '';
  let d = String(raw).replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  if (d.length === 11 && d.startsWith('7')) return d;
  return '';
}

/** Есть ли в строке хоть что-то похожее на номер (для выбора полей при импорте). */
function looksLikePhone(raw) {
  const d = String(raw == null ? '' : raw).replace(/\D/g, '');
  return d.length >= 10;
}

/** Последние 10 цифр — ключ сопоставления одного и того же номера. */
function tail10(raw) {
  return String(raw == null ? '' : raw).replace(/\D/g, '').slice(-10);
}

/** Колонки-телефоны сотрудника (для нормализации при записи). */
const EMPLOYEE_PHONE_KEYS = ['phone', 'phone2', 'max_phone', 'wa_phone', 'spouse_phone', 'relative_phone'];

/**
 * Нормализует телефонные поля объекта на месте (только там, где уверены).
 * Пустое/неуверенное значение НЕ трогаем (не портим городские/«доб.»).
 * Канон для записей сотрудников/справочников — цифры без «+»: '7XXXXXXXXXX'
 * (исторический формат employees.phone; auth-таблицы хранят '+7…' отдельно).
 */
function normalizePhoneFields(obj, keys = ['phone']) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const k of keys) {
    const raw = obj[k];
    if (raw === undefined || raw === null) continue;
    const v = String(raw).trim();
    if (!v) continue;
    const digits = toDigitsRu(v);
    if (digits) obj[k] = digits;
  }
  return obj;
}

module.exports = { toE164Ru, toDigitsRu, looksLikePhone, tail10, normalizePhoneFields, EMPLOYEE_PHONE_KEYS };
