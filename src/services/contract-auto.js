'use strict';

/**
 * D-340 (заказчик 22.10.2026): «если в счёте есть договор, а в CRM его нет —
 * значит нужно создавать договор в CRM и подставлять, главное проверить, что
 * такого договора точно нет».
 * ═══════════════════════════════════════════════════════════════════════════
 * Прежнее поведение (V404) — только подсветка «договор не найден». Заказчик
 * справедливо указал: подсветка не решает проблему, бухгалтерия всё равно
 * работает вручную. Теперь договор создаётся — но по ЖЁСТКОМУ правилу
 * «сначала докажи, что его нет».
 *
 * ПОЧЕМУ ЭТО ОПАСНО И КАК ЗАЩИЩЕНО. Договор — юридический документ. Ложное
 * создание даёт дубли в реестре договоров и путает привязку счетов. Поэтому:
 *
 *   1. Создаём ТОЛЬКО когда `matchContract` вернул `not_found` — то есть
 *      договора нет ни по точному номеру, ни по вхождению, ни по цифрам.
 *      Причины `ambiguous`, `number_taken_by_other_counterparty`, `no_number`
 *      создание ЗАПРЕЩАЮТ: там либо неоднозначно, либо номер занят чужим лицом.
 *   2. Номер нормализуется тем же каноном, что и поиск (normContractNo), иначе
 *      созданный договор не найдётся в следующий раз тем же кодом.
 *   3. ИНН контрагента обязателен. Без ИНН нельзя доказать, что это не договор
 *      другого лица с тем же номером → помечаем на вычитку, не создаём.
 *   4. Перед вставкой — вторая, независимая проверка в той же транзакции
 *      (защита от гонки: два счёта по одному договору обрабатываются параллельно).
 *   5. Помечаем `comment` как созданный автоматически + источник, чтобы бухгалтер
 *      видел происхождение и мог проверить реквизиты.
 *
 * Созданный договор — «черновой по данным счёта»: номер, дата, контрагент, ИНН,
 * сумма. Файл и подписанный скан прикрепляются позже человеком.
 */

const { normContractNo, matchContract } = require('./contract-match');

/** Причины отказа matchContract, при которых создавать договор НЕЛЬЗЯ. */
const NO_CREATE_REASONS = new Set([
  'ambiguous',                        // несколько похожих — человек должен выбрать
  'number_taken_by_other_counterparty', // номер занят другим лицом — не наш случай
  'no_number',                        // нет номера — нечего создавать
  'error'
]);

/**
 * Убедиться, что договор-основание из счёта есть в CRM. Если его ТОЧНО нет —
 * создать и вернуть его.
 *
 * @param {object} db
 * @param {{number:string, date?:string, counterpartyInn?:string,
 *          counterpartyName?:string, amount?:number, docId?:number,
 *          userId?:number}} basis
 * @param {{log?:object, dryRun?:boolean}} [opts]
 * @returns {Promise<{action:'exists'|'created'|'skipped'|'failed',
 *                    contract?:object, reason:string, matched?:object}>}
 */
async function ensureContractFromInvoice(db, basis = {}, opts = {}) {
  const log = opts.log;
  const rawNumber = String(basis.number || '').trim();
  const num = normContractNo(rawNumber);
  if (!num) return { action: 'skipped', reason: 'no_number' };

  // 1. Сначала честно ищем. matchContract уже умеет: точный номер, вхождение,
  // цифры, и veto по чужому ИНН.
  let matched;
  try {
    matched = await matchContract(db, {
      number: rawNumber,
      counterpartyInn: basis.counterpartyInn,
      counterpartyName: basis.counterpartyName
    });
  } catch (e) {
    log?.warn?.('[contract-auto] поиск упал: ' + (e && e.message));
    return { action: 'failed', reason: 'match_error' };
  }

  if (matched.found) return { action: 'exists', contract: matched.contract, reason: matched.reason };

  // 2. Отказные причины: не создаём, отдаём человеку.
  if (NO_CREATE_REASONS.has(matched.reason)) {
    log?.info?.(`[contract-auto] не создаю «${rawNumber}»: причина ${matched.reason}`);
    return { action: 'skipped', reason: matched.reason, matched };
  }

  // 3. ИНН обязателен: без него нельзя доказать, что номер не принадлежит другому.
  const inn = String(basis.counterpartyInn || '').replace(/\D/g, '');
  if (inn.length !== 10 && inn.length !== 12) {
    return { action: 'skipped', reason: 'no_inn' };
  }

  const name = String(basis.counterpartyName || '').trim();
  if (!name) return { action: 'skipped', reason: 'no_counterparty' };

  if (opts.dryRun) {
    return { action: 'created', reason: 'dry_run', contract: { number: rawNumber, prospective: true } };
  }

  // 4. Создаём. Вторая проверка внутри той же транзакции — защита от гонки:
  // два счёта по одному договору могли обработаться параллельно.
  //
  // FAIL верификатора 22.10.2026, п.4c: `BEGIN`/`INSERT`/`COMMIT` через
  // `db.query` на ПУЛЕ уходят на РАЗНЫЕ соединения — транзакция не одна, и
  // проверка внутри неё ничего не гарантирует. Хуже: соединение остаётся
  // `idle in transaction` (утечка соединений и чужие блокировки).
  // Теперь: если есть пул — берём ВЫДЕЛЕННОЕ соединение (client) и работаем
  // через него, а в finally возвращаем в пул. На «сыром» Client работаем как есть.
  let conn = db;
  let release = null;
  try {
    if (db && typeof db.connect === 'function' && db.pool !== undefined) {
      conn = await db.connect();
      if (conn && typeof conn.release === 'function') release = () => conn.release();
    }
  } catch (_) {
    conn = db;   // не смогли выделить — работаем без транзакции (лучше, чем упасть)
    release = null;
  }

  try {
    await conn.query('BEGIN');
    const again = await conn.query(
      `SELECT id, number, counterparty_name, customer_inn
         FROM contracts
        WHERE regexp_replace(coalesce(number,''), '[^a-zA-Z0-9а-яА-ЯёЁ/\\-]', '', 'g') = $1
          AND (
            regexp_replace(coalesce(customer_inn,''), '\\D', '', 'g') = $2
            OR coalesce(customer_inn,'') = ''
          )
        LIMIT 1`,
      [num, inn]
    );
    if (again.rows[0]) {
      await conn.query('COMMIT');
      return { action: 'exists', contract: again.rows[0], reason: 'race_recheck' };
    }

    const startedAt = basis.date || null;
    const comment = 'Создан автоматически из счёта'
      + (basis.docId ? ` #${basis.docId}` : '')
      + ' — реквизиты требуют проверки бухгалтерией';

    const ins = await conn.query(
      `INSERT INTO contracts
         (number, type, counterparty_name, customer_inn, amount, start_date,
          status, comment, created_by, created_at, updated_at)
       VALUES ($1, 'supply', $2, $3, $4, $5::date, 'active', $6, $7, NOW(), NOW())
       RETURNING id, number, counterparty_name, customer_inn, amount, start_date, status`,
      [rawNumber, name, inn, basis.amount != null ? basis.amount : null, startedAt, comment, basis.userId || null]
    );
    await conn.query('COMMIT');
    const created = ins.rows[0];
    log?.info?.(`[contract-auto] создан договор #${created.id} «${rawNumber}» для ${name} (ИНН ${inn})`);
    return { action: 'created', contract: created, reason: 'created' };
  } catch (e) {
    try { await conn.query('ROLLBACK'); } catch (_) { /* уже откатились */ }
    // Гонка: договор только что создал параллельный поток. UNIQUE по номеру на
    // проде НЕТ (только PK), поэтому реальный конфликт даёт не 23505, а вторую
    // строку — её ловит проверка `again` выше и `safetyNet` ниже по стеку.
    if (e && e.code === '23505') {
      try {
        const ex = await db.query(
          `SELECT id, number, counterparty_name, customer_inn FROM contracts
            WHERE regexp_replace(coalesce(number,''), '[^a-zA-Z0-9а-яА-ЯёЁ/\\-]', '', 'g') = $1
            LIMIT 1`, [num]);
        if (ex.rows[0]) return { action: 'exists', contract: ex.rows[0], reason: 'unique_violation' };
      } catch (_) { /* ignore */ }
    }
    log?.warn?.('[contract-auto] создание упало: ' + (e && e.message));
    return { action: 'failed', reason: 'insert_error', error: e && e.message };
  } finally {
    // FAIL 4c: выделенное соединение ОБЯЗАНО вернуться в пул, иначе оно остаётся
    // `idle in transaction` и утекает (при 35 коннектах — исчерпание пула).
    if (release) { try { release(); } catch (_) { /* ignore */ } }
  }
}

module.exports = { ensureContractFromInvoice, NO_CREATE_REASONS };
