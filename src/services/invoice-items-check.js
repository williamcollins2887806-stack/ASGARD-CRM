'use strict';

/**
 * Сверка суммы позиций счёта с итогом заявки.
 *
 * Зачем. OCR/ИИ иногда теряет строку (кейс #368: 5 из 6 позиций → 37 000
 * при итоге 48 000). Раньше pipeline_check только предупреждал, а согласование
 * и оплата шли дальше. Бухгалтерия платит по `amount` (итог), но дырявая
 * номенклатура ломает обоснование, ОБС-письмо и разноску.
 *
 * Правило:
 *   • позиций нет / пустой массив — НЕ стоп (много счетов без расшифровки);
 *   • позиции есть — сумма должна совпасть с gross ИЛИ с net (gross−vat)
 *     в пределах 1 копейки (OCR часто кладёт суммы без НДС).
 *
 * Счёт при блоке НЕ удаляется и НЕ меняет статус: остаётся draft /
 * awaiting_dir / pending_payment, пока человек не поправит позиции.
 */

const TOL = 0.01;
const CODE = 'items_sum_mismatch';

function parseLines(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw == null) return [];
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function lineSum(l) {
  if (!l || typeof l !== 'object') return 0;
  const v = Number(l.sum != null ? l.sum : (l.amount != null ? l.amount : l.total));
  return Number.isFinite(v) ? v : 0;
}

function sumLines(raw) {
  return parseLines(raw).reduce((s, l) => s + lineSum(l), 0);
}

/**
 * @param {{amount?:any, vat_amount?:any, line_items_json?:any, line_items?:any}} pay
 * @returns {{ok:boolean, code?:string, message?:string, items_sum:number, amount:number, net:number, n_items:number, matched?:'gross'|'net'|null}}
 */
function checkItemsVsAmount(pay) {
  const lines = parseLines(pay && (pay.line_items_json != null ? pay.line_items_json : pay.line_items));
  const n = lines.length;
  const itemsSum = sumLines(lines);
  const amount = Number(pay && pay.amount);
  const vat = Number(pay && pay.vat_amount) || 0;
  const net = Number.isFinite(amount) ? amount - vat : NaN;

  if (!n) {
    return {
      ok: true,
      items_sum: 0,
      amount: Number.isFinite(amount) ? amount : 0,
      net: Number.isFinite(net) ? net : 0,
      n_items: 0,
      matched: null,
    };
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    // Без итога сверку не делаем — отдельно ловится no_amount / stub.
    return {
      ok: true,
      items_sum: itemsSum,
      amount: 0,
      net: 0,
      n_items: n,
      matched: null,
    };
  }

  const matchGross = Math.abs(itemsSum - amount) <= TOL;
  const matchNet = Number.isFinite(net) && Math.abs(itemsSum - net) <= TOL;
  if (matchGross || matchNet) {
    return {
      ok: true,
      items_sum: itemsSum,
      amount,
      net: Number.isFinite(net) ? net : amount,
      n_items: n,
      matched: matchGross ? 'gross' : 'net',
    };
  }

  const fmt = (x) => Number(x).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return {
    ok: false,
    code: CODE,
    message: `Сумма позиций (${fmt(itemsSum)} ₽) не сходится с суммой счёта (${fmt(amount)} ₽). `
      + 'Счёт не потерян — поправьте позиции по PDF и повторите. Согласование и оплата заблокированы.',
    items_sum: itemsSum,
    amount,
    net: Number.isFinite(net) ? net : amount,
    n_items: n,
    matched: null,
  };
}

function assertItemsMatchAmount(pay) {
  const r = checkItemsVsAmount(pay);
  if (r.ok) return r;
  const err = new Error(r.message);
  err.statusCode = 409;
  err.code = CODE;
  err.details = r;
  throw err;
}

/**
 * Пометить строку реестра (если есть) — синий «неполный», причина видна в Doc Hub.
 * Заявку не трогаем: статус и данные остаются.
 */
async function markItemsMismatch(db, pay) {
  if (!db || !pay) return;
  const docId = pay.doc_registry_id || null;
  if (!docId) return;
  try {
    await db.query(
      `UPDATE doc_registry
          SET is_incomplete = true,
              incomplete_reasons = (
                SELECT array_agg(DISTINCT x)
                  FROM unnest(
                    COALESCE(incomplete_reasons, '{}'::text[]) || ARRAY[$2::text]
                  ) AS t(x)
              ),
              updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL`,
      [docId, CODE]
    );
  } catch (e) {
    console.warn('[invoice-items-check] mark failed:', e && e.message);
  }
}

/**
 * Снять метку, если позиции снова сходятся (после ручной правки).
 */
async function clearItemsMismatch(db, pay) {
  if (!db || !pay || !pay.doc_registry_id) return;
  try {
    await db.query(
      `UPDATE doc_registry
          SET incomplete_reasons = array_remove(COALESCE(incomplete_reasons, '{}'::text[]), $2),
              is_incomplete = (
                cardinality(array_remove(COALESCE(incomplete_reasons, '{}'::text[]), $2)) > 0
              ),
              updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
          AND COALESCE(incomplete_reasons, '{}'::text[]) @> ARRAY[$2::text]`,
      [pay.doc_registry_id, CODE]
    );
  } catch (e) {
    console.warn('[invoice-items-check] clear failed:', e && e.message);
  }
}

module.exports = {
  CODE,
  TOL,
  parseLines,
  sumLines,
  checkItemsVsAmount,
  assertItemsMatchAmount,
  markItemsMismatch,
  clearItemsMismatch,
};
