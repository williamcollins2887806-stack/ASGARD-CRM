'use strict';

/**
 * D-347 (заказчик 23.10.2026): ЛИМИТ ПОПЫТОК НЕ ДОЛЖЕН УБИВАТЬ ПИСЬМА.
 * ═══════════════════════════════════════════════════════════════════════════
 * ИНЦИДЕНТ. Закончились деньги на ИИ-провайдере. Четыре письма со счетами
 * (#5011–#5014) упали с `provider_error` по три раза подряд и навсегда выпали
 * из очереди: `processUnanalyzedEmails` берёт только `ai_attempts < 3`, а
 * `resetSkippedEmails()` и ручной `/mailbox/ai/reset-skipped` фильтруют тем же
 * условием. Восстановления нет вообще — только руками через SQL.
 *
 * Корень: система наказывала ПИСЬМО за НАШУ проблему. Письмо не стало хуже от
 * того, что провайдер вернул 402/429/500 или сеть отвалилась. Такие ошибки
 * должны ЖДАТЬ, а не сжигать попытки.
 *
 * РАЗДЕЛЕНИЕ ОШИБОК — центральное место этого модуля:
 *
 *   • INFRA (инфраструктура) — провайдер недоступен, нет денег, таймаут, 5xx,
 *     429, пустой ответ, сеть. Попытки НЕ считаем (или считаем в отдельный
 *     счётчик `ai_infra_failures`), письмо ждёт и будет повторено, когда
 *     провайдер оживёт. Ждать бесконечно тоже нельзя — есть потолок по ВРЕМЕНИ
 *     (7 суток), после которого письмо уходит людям, чтобы не висело вечно.
 *
 *   • CONTENT (содержимое) — модель ответила, но JSON битый, классификации нет,
 *     модель «сошла с ума». Это про письмо → считаем попытки, после лимита
 *     отдаём людям. Здесь лимит нужен, иначе бесконечный цикл на кривом письме.
 *
 *   • UNKNOWN — трактуем как INFRA (безопаснее: не теряем письмо).
 */

/** Коды, которые означают «провайдер/сеть», а не «плохое письмо». */
const INFRA_CODES = new Set([
  'provider_error',
  'empty_response',
  'timeout',
  'network_error',
  'rate_limited',
  'no_credit',
  'quota_exceeded',
  'auth_error',          // ключ отозван/просрочен — наша проблема, не письма
  'sanitize_error'       // внутренний сбой обработки, не свойство письма
]);

/** Коды, которые означают «модель не смогла разобрать письмо». */
const CONTENT_CODES = new Set([
  'json_parse_error',
  'missing_classification',
  'truncated',
  'invalid_schema'
]);

/**
 * Определить класс ошибки по коду.
 * @param {string} code — analysis._parse_error
 * @returns {'infra'|'content'}
 */
function classifyAiError(code) {
  const c = String(code || '').toLowerCase();
  if (INFRA_CODES.has(c)) return 'infra';
  if (CONTENT_CODES.has(c)) return 'content';
  // Неизвестное — считаем инфраструктурой: лучше повторить, чем потерять счёт.
  return 'infra';
}

/** Потолок ожидания для инфраструктурных сбоев: 7 суток. */
const INFRA_MAX_AGE_HOURS = parseInt(process.env.AI_INFRA_MAX_AGE_HOURS || '168', 10);

/**
 * Можно ли брать письмо в обработку.
 *
 * Правило:
 *   • контентные сбои — до AI_MAX_ATTEMPTS (как было);
 *   • инфраструктурные — без ограничения по числу, но не старше INFRA_MAX_AGE_HOURS;
 *   • если письмо уже «сдалось» (ai_needs_manual=true) — не берём.
 *
 * @param {{ai_attempts?:number, ai_infra_failures?:number, ai_needs_manual?:boolean,
 *          ai_last_error_class?:string, email_date?:Date|string}} row
 * @param {number} maxAttempts
 * @returns {boolean}
 */
function canRetry(row, maxAttempts) {
  if (!row) return false;
  if (row.ai_needs_manual === true) return false;

  const cls = String(row.ai_last_error_class || 'infra');
  if (cls === 'content') {
    return Number(row.ai_attempts || 0) < maxAttempts;
  }
  // infra: ограничение по возрасту письма, а не по счётчику.
  if (row.email_date) {
    const ageHours = (Date.now() - new Date(row.email_date).getTime()) / 3600000;
    if (ageHours > INFRA_MAX_AGE_HOURS) return false;
  }
  return true;
}

module.exports = { classifyAiError, canRetry, INFRA_CODES, CONTENT_CODES, INFRA_MAX_AGE_HOURS };
