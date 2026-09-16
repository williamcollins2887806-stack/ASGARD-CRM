'use strict';

/**
 * Канон цены работ РП (`tender_rp_reviews.work_price`).
 *
 * КАНОН (с 16.09.2026): `work_price` — цена БЕЗ НДС, как её считает смета
 * (`asgard_smeta.totals.price_no_vat`). Порог согласования директора сравнивается
 * с этой же величиной (`director_tender_threshold_rub`, 10 млн без НДС).
 *
 * LEGACY (карточки 2025 г.): в `work_price` лежала цена С НДС, а `work_price_ex_vat`
 * был равен `work_price / 1.22`. Такие пары распознаём по отношению и читаем верно,
 * чтобы исторические карточки в очереди директора не показывали завышенную цифру.
 *
 * Зеркало для фронта: `public/assets/js/money_fmt.js` (`AsgardMoney.resolveWorkPrice`).
 */

const VAT_DEFAULT_PCT = 22;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {{work_price?: any, work_price_ex_vat?: any}} review
 * @param {number} [vatPct]
 * @returns {{exVat: number|null, withVat: number|null, vatPct: number, legacy: boolean}}
 */
function resolveWorkPrice(review, vatPct) {
  const rev = review || {};
  const pct = Number.isFinite(Number(vatPct)) && Number(vatPct) > 0 ? Number(vatPct) : VAT_DEFAULT_PCT;
  const wp = num(rev.work_price);
  const wpEx = num(rev.work_price_ex_vat);

  const withVatOf = (ex) => Math.round(ex * (1 + pct / 100) * 100) / 100;

  if (wp == null || wp <= 0) {
    if (wpEx != null && wpEx > 0) return { exVat: wpEx, withVat: withVatOf(wpEx), vatPct: pct, legacy: false };
    return { exVat: null, withVat: null, vatPct: pct, legacy: false };
  }
  // legacy: work_price с НДС, work_price_ex_vat = work_price / (1 + pct/100)
  if (wpEx != null && wpEx > 0 && wpEx < wp) {
    const ratio = wp / wpEx;
    if (Math.abs(ratio - (1 + pct / 100)) < 0.02) {
      return { exVat: wpEx, withVat: wp, vatPct: pct, legacy: true };
    }
  }
  return { exVat: wp, withVat: withVatOf(wp), vatPct: pct, legacy: false };
}

/** Цена работ без НДС (канон). */
function workPriceExVat(review, vatPct) {
  return resolveWorkPrice(review, vatPct).exVat;
}

/** Цена работ с НДС — производная от канона. */
function workPriceWithVat(review, vatPct) {
  return resolveWorkPrice(review, vatPct).withVat;
}

module.exports = {
  VAT_DEFAULT_PCT,
  resolveWorkPrice,
  workPriceExVat,
  workPriceWithVat
};
