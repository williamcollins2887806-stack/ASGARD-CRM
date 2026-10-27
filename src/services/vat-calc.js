/**
 * ASGARD CRM — единый расчёт НДС по расходу.
 *
 * Проблема (27.10.2026, разбор работы #406):
 *   В `work_expenses` сумма `amount` хранилась без указания, БРУТТО она (с НДС)
 *   или НЕТТО (без НДС). Каждый путь ввода трактовал её по-своему:
 *     • `public/assets/js/work_expenses.js:604` — считает НДС как amount*rate/(100+rate),
 *       то есть неявно считает amount БРУТТО;
 *     • ПАНХ в #406 внесли как НЕТТО (23 111 014,72 + НДС 22%) — и строка
 *       перестала сходиться на 1 317 029,92 ₽;
 *     • `autoWorkExpense` (src/routes/payment-invoices.js:269) вообще не передаёт
 *       НДС из счёта — по всей базе потеряно 32,6 млн ₽ вычета.
 *
 * Решение:
 *   Явная колонка `work_expenses.vat_basis` ('gross' | 'net') отвечает на вопрос
 *   «amount — это с НДС или без». Все производные величины считаются ЗДЕСЬ,
 *   чтобы бэкенд, vanilla-фронт и v2 не расходились.
 *
 * Соглашения:
 *   • vat_rate внутри сервиса — ПРОЦЕНТЫ (22, 20, 10, 5, 0). В БД исторически
 *     встречаются и доли (0.22) — их нормализует `normalizeRate`.
 *   • vat_basis = 'gross' → amount включает НДС: vat = amount × r/(100+r)
 *   • vat_basis = 'net'   → amount без НДС:      vat = amount × r/100
 *   • Округление — до копеек на каждой величине, затем net + vat = amount
 *     с точностью до копейки (остаток уходит в net, чтобы сумма сошлась).
 *
 * Тесты: tests/vat-calc.test.js
 */

/**
 * Допустимые ставки (доли и проценты перемешаны исторически).
 * 7 — ставка для отдельных товаров и переходный режим; она принимается
 * в заявках на оплату (src/routes/payment-invoices.js VALID_VAT_RATES),
 * поэтому обязана приниматься и здесь, иначе normalizeRate(7)=null и
 * нетто молча завышается на сумму НДС (нашёл верификатор 27.10.2026).
 */
const ALLOWED_RATES = [0, 5, 7, 10, 20, 22];

/**
 * Приводит ставку к процентам: 0.22 → 22, "22" → 22, 22 → 22.
 * Неизвестное значение → null (означает «ставка не задана»).
 * @param {number|string|null|undefined} raw
 * @returns {number|null}
 */
function normalizeRate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  // Доля: 0 < n <= 1 → в проценты (0.22 → 22, 1 → 100 не бывает, но пусть)
  const pct = n > 0 && n < 1 ? n * 100 : n;
  const rounded = Math.round(pct * 100) / 100;
  const hit = ALLOWED_RATES.find((a) => Math.abs(a - rounded) < 0.005);
  return hit != null ? hit : null;
}

/** Округление до копеек. */
function money(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

/**
 * Разложить сумму с НДС на нетто + НДС.
 * @param {number} gross сумма с НДС
 * @param {number} ratePct ставка в процентах
 * @returns {{net: number, vat: number, gross: number}}
 */
function splitGross(gross, ratePct) {
  const g = money(gross);
  const r = Number(ratePct) || 0;
  if (r <= 0) return { net: g, vat: 0, gross: g };
  const net = money((g * 100) / (100 + r));
  const vat = money(g - net);
  return { net, vat, gross: g };
}

/**
 * Начислить НДС на сумму без НДС.
 * @param {number} net сумма без НДС
 * @param {number} ratePct ставка в процентах
 * @returns {{net: number, vat: number, gross: number}}
 */
function addToNet(net, ratePct) {
  const n = money(net);
  const r = Number(ratePct) || 0;
  if (r <= 0) return { net: n, vat: 0, gross: n };
  const vat = money((n * r) / 100);
  return { net: n, vat, gross: money(n + vat) };
}

/**
 * ГЛАВНАЯ функция: по записи расхода вернуть согласованный набор величин.
 *
 * На вход принимает «сырую» строку work_expenses и решает, что есть что:
 *   1. Если задан `vat_basis` — доверяем ему (canonical post-V443).
 *   2. Иначе выводим базу из данных (legacy-строки):
 *      a. `amount_ex_vat` есть и amount ≈ ex + vat → база gross;
 *      b. `amount_ex_vat` есть и amount ≈ ex      → база net;
 *      c. `vat_amount` сходится с amount*r/(100+r) → gross;
 *      d. `vat_amount` сходится с amount*r/100     → net;
 *      e. не сходится ничего → помечаем 'unknown' и НЕ трогаем цифры.
 *
 * @param {object} exp строка work_expenses (amount, vat_rate, vat_amount, amount_ex_vat, vat_basis)
 * @returns {{
 *   amount: number,        // исходная сумма из БД (как введена)
 *   basis: 'gross'|'net'|'none'|'unknown',
 *   rate: number|null,     // ставка в процентах
 *   gross: number,         // сумма с НДС
 *   net: number,           // сумма без НДС
 *   vat: number,           // НДС
 *   inconsistent: boolean  // true = данные сами себе противоречат
 * }}
 */
function resolveExpense(exp) {
  const src = exp || {};
  const amount = money(src.amount);
  const rate = normalizeRate(src.vat_rate);
  const vatDb = money(src.vat_amount);
  const exDb = src.amount_ex_vat === null || src.amount_ex_vat === undefined || src.amount_ex_vat === ''
    ? null
    : money(src.amount_ex_vat);

  const none = { amount, basis: 'none', rate: null, gross: amount, net: amount, vat: 0, inconsistent: false };

  // Нет НДС вообще
  if (!(vatDb > 0)) {
    // vat_rate задан, НДС не выделен — это не ошибка (счёт без выделения),
    // но и вычета нет. Считаем сумму нетто-эквивалентной.
    return { ...none, rate };
  }

  // 1. Явная база (post-V443)
  const explicit = String(src.vat_basis || '').toLowerCase();
  if (explicit === 'gross' || explicit === 'net') {
    // Сначала проверяем по сохранённому amount_ex_vat — он точнее любой
    // реконструкции, и суммы в БД часто округлены до рубля (29.10: ложные
    // срабатывания на разнице 0,33 ₽ при допуске 0,05).
    const consistentByEx = exDb != null && (
      (explicit === 'gross' && Math.abs(amount - (exDb + vatDb)) <= 1)
      || (explicit === 'net' && Math.abs(amount - exDb) <= 1)
    );
    if (consistentByEx) {
      return {
        amount, basis: explicit, rate,
        gross: explicit === 'gross' ? amount : money(amount + vatDb),
        net: explicit === 'gross' ? exDb : amount,
        vat: vatDb,
        inconsistent: false
      };
    }

    // Ставка может быть не задана (напр. Wildberries: ставки разные по продавцам).
    // Тогда берём её из пары (amount, vat), а если и это не удалось — доверяем
    // сохранённому amount_ex_vat, он точнее любой реконструкции.
    const effRate = rate || guessRateFrom(amount, vatDb);
    if (effRate == null) {
      if (exDb != null && Math.abs(amount - (exDb + vatDb)) <= 1) {
        return { amount, basis: 'gross', rate: null, gross: amount, net: exDb, vat: vatDb, inconsistent: false };
      }
      if (exDb != null && Math.abs(amount - exDb) <= 1) {
        return { amount, basis: 'net', rate: null, gross: money(amount + vatDb), net: amount, vat: vatDb, inconsistent: false };
      }
      return { amount, basis: explicit, rate: null, gross: amount, net: money(amount - vatDb), vat: vatDb, inconsistent: true };
    }
    const calc = explicit === 'gross'
      ? splitGross(amount, effRate)
      : addToNet(amount, effRate);
    const inconsistent = Math.abs(calc.vat - vatDb) > 1;
    // Доверяем сохранённому vat_amount, но проверяем сходимость
    if (inconsistent) {
      const net = Math.max(0, money(amount - vatDb));
      return { amount, basis: explicit, rate: effRate, gross: amount, net, vat: vatDb, inconsistent: true };
    }
    return { amount, basis: explicit, rate: effRate, gross: calc.gross, net: calc.net, vat: vatDb, inconsistent: false };
  }

  // 2. Legacy-вывод базы
  const effRate = rate || guessRateFrom(amount, vatDb);

  // a/b: есть amount_ex_vat
  // Допуск 1 ₽: в БД много строк с суммами, округлёнными до рубля; при
  // допуске 0,02 они ложно помечались противоречивыми (класс #11/#3880).
  if (exDb !== null) {
    if (Math.abs(amount - (exDb + vatDb)) <= 1) {
      return { amount, basis: 'gross', rate: effRate, gross: amount, net: exDb, vat: vatDb, inconsistent: false };
    }
    if (Math.abs(amount - exDb) <= 1) {
      return { amount, basis: 'net', rate: effRate, gross: money(amount + vatDb), net: amount, vat: vatDb, inconsistent: false };
    }
    // amount_ex_vat есть, но не сходится ни туда, ни туда — данные битые.
    // Ставку сохраняем из данных, но помечаем строку для сверки.
    return { amount, basis: 'unknown', rate: rate, gross: amount, net: Math.max(0, money(amount - vatDb)), vat: vatDb, inconsistent: true };
  }

  // c/d: выводим по ставке.
  // Проверяем сначала записанную ставку, затем — подобранную по паре (amount, vat):
  // ставка в БД могла быть записана в другой шкале или устареть (см. #5864:
  // vat_rate=0.2 при НДС, посчитанном по 22%).
  const candidates = [];
  if (effRate != null && effRate > 0) candidates.push(effRate);
  const guessed = guessRateFrom(amount, vatDb);
  if (guessed != null && !candidates.includes(guessed)) candidates.push(guessed);

  for (const rateTry of candidates) {
    const byGross = money((amount * rateTry) / (100 + rateTry));
    const byNet = money((amount * rateTry) / 100);
    if (Math.abs(vatDb - byGross) <= 1) {
      return { amount, basis: 'gross', rate: rateTry, gross: amount, net: money(amount - vatDb), vat: vatDb, inconsistent: false };
    }
    if (Math.abs(vatDb - byNet) <= 1) {
      return { amount, basis: 'net', rate: rateTry, gross: money(amount + vatDb), net: amount, vat: vatDb, inconsistent: false };
    }
  }

  // e: не сходится — не угадываем, помечаем.
  // Защита от отрицательного нетто: НДС в строке не может быть больше суммы
  // (бывает при частичной оплате счёта — amount 100 000, а НДС со всего счёта
  // 220 000). Без ограничения net уходил в минус, 55% считались от минуса и
  // ПРИБАВЛЯЛИ прибыль (нашёл верификатор 27.10.2026).
  const safeNet = Math.max(0, money(amount - vatDb));
  return { amount, basis: 'unknown', rate: effRate, gross: amount, net: safeNet, vat: vatDb, inconsistent: true };
}

/**
 * Ставка по паре (сумма, НДС) — когда vat_rate не задан.
 * Проверяет гипотезы gross и net, возвращает первую подошедшую ставку.
 * @returns {number|null}
 */
function guessRateFrom(amount, vat) {
  const a = money(amount);
  const v = money(vat);
  if (!(a > 0) || !(v > 0)) return null;
  for (const r of ALLOWED_RATES) {
    if (r === 0) continue;
    if (Math.abs(v - money((a * r) / (100 + r))) <= 1) return r;
    if (Math.abs(v - money((a * r) / 100)) <= 1) return r;
  }
  return null;
}

/**
 * Налоговая база для 55%: сумма БЕЗ НДС.
 * Раньше 55% начислялись на `amount` как есть — если сумма была с НДС,
 * нагрузка завышалась на долю НДС. См. tests/vat-calc.test.js.
 * @param {object} exp
 * @returns {number}
 */
function taxBase(exp) {
  const r = resolveExpense(exp);
  return r.net;
}

module.exports = {
  ALLOWED_RATES,
  normalizeRate,
  splitGross,
  addToNet,
  resolveExpense,
  guessRateFrom,
  taxBase,
  money,
};
