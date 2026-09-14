/**
 * Единый формат денег в CRM: «9 711 200 ₽», разрядность пробелом.
 */
export const VAT_DEFAULT_PCT = 22;

export function parseMoney(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/\s/g, '').replace(/₽/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function formatMoney(v, opts = {}) {
  if (v == null || v === '') return opts.empty ?? '—';
  const n = typeof v === 'number' ? v : parseMoney(v);
  if (n == null || !Number.isFinite(n)) return opts.empty ?? '—';
  if (opts.short) return formatMoneyShort(n, opts);
  const fractionDigits = opts.fractionDigits != null ? opts.fractionDigits : 0;
  const num = n.toLocaleString('ru-RU', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  });
  return opts.noCurrency ? num : `${num} ₽`;
}

/** Компактный формат для KPI: «12 тыс ₽» / «3.5 млн ₽» / «1.2 млрд ₽». */
export function formatMoneyShort(v, opts = {}) {
  if (v == null || v === '') return opts.empty ?? '—';
  const n = typeof v === 'number' ? v : parseMoney(v);
  if (n == null || !Number.isFinite(n)) return opts.empty ?? '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  const cur = opts.noCurrency ? '' : ' ₽';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)} млрд${cur}`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)} млн${cur}`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)} тыс${cur}`;
  const num = Math.round(n).toLocaleString('ru-RU');
  return opts.noCurrency ? num : `${num} ₽`;
}

/** НДС от суммы без НДС */
export function calcVatAmount(exVat, vatPct = VAT_DEFAULT_PCT) {
  const base = Number(exVat) || 0;
  const pct = Number(vatPct);
  const rate = Number.isFinite(pct) ? pct : VAT_DEFAULT_PCT;
  return Math.round(base * (rate / 100) * 100) / 100;
}

export function withVat(exVat, vatPct = VAT_DEFAULT_PCT) {
  const base = Number(exVat) || 0;
  return Math.round((base + calcVatAmount(base, vatPct)) * 100) / 100;
}

export function withoutVat(incVat, vatPct = VAT_DEFAULT_PCT) {
  const total = Number(incVat) || 0;
  const pct = Number(vatPct);
  const rate = Number.isFinite(pct) ? pct : VAT_DEFAULT_PCT;
  const mul = 1 + rate / 100;
  return Math.round((total / mul) * 100) / 100;
}

/**
 * Основная строка — сумма с НДС; вторая — «в т.ч. НДС … ₽».
 * @returns {{ withVat: string, vatLine: string, vatAmount: number }}
 */
export function formatMoneyVat(withVatAmount, vatAmountOrPct, opts = {}) {
  const total = parseMoney(withVatAmount);
  if (total == null) {
    return { withVat: opts.empty ?? '—', vatLine: '', vatAmount: 0 };
  }
  let vatAmt;
  if (opts.vatIsPct || (vatAmountOrPct != null && vatAmountOrPct <= 100 && opts.forcePct !== false && opts.vatAmount == null)) {
    // если передали pct явно через opts.vatPct
  }
  if (opts.vatAmount != null) {
    vatAmt = Number(opts.vatAmount) || 0;
  } else if (opts.exVat != null) {
    vatAmt = Math.round((total - Number(opts.exVat)) * 100) / 100;
  } else if (vatAmountOrPct != null && Number(vatAmountOrPct) > 100) {
    vatAmt = Number(vatAmountOrPct);
  } else {
    const pct = opts.vatPct != null ? opts.vatPct : (vatAmountOrPct != null ? vatAmountOrPct : VAT_DEFAULT_PCT);
    const ex = withoutVat(total, pct);
    vatAmt = Math.round((total - ex) * 100) / 100;
  }
  return {
    withVat: formatMoney(total, opts),
    vatLine: `в т.ч. НДС ${formatMoney(vatAmt, opts)}`,
    vatAmount: vatAmt
  };
}

export function suggestSubmissionPrices(row, vatPct = VAT_DEFAULT_PCT) {
  const rev = row?.rp_review || {};
  const pct = Number(row?.vat_pct) || vatPct;
  let withV = null;
  let exV = null;
  if (rev.work_price != null && Number(rev.work_price) > 0) {
    withV = Number(rev.work_price);
    exV = rev.work_price_ex_vat != null ? Number(rev.work_price_ex_vat) : withoutVat(withV, pct);
  } else if (rev.work_price_ex_vat != null && Number(rev.work_price_ex_vat) > 0) {
    exV = Number(rev.work_price_ex_vat);
    withV = withVat(exV, pct);
  } else {
    let rj = rev.report_json;
    try {
      if (typeof rj === 'string') rj = JSON.parse(rj || '{}');
    } catch { rj = {}; }
    const min = Number(rj?.price_range_min);
    const max = Number(rj?.price_range_max);
    if (Number.isFinite(min) && Number.isFinite(max) && min > 0) {
      exV = Math.round(((min + max) / 2) * 100) / 100;
      withV = withVat(exV, pct);
    } else if (Number.isFinite(min) && min > 0) {
      exV = min;
      withV = withVat(exV, pct);
    }
  }
  if (withV == null && row?.tender_price != null && Number(row.tender_price) > 0) {
    exV = Number(row.tender_price);
    withV = row.tender_price_with_vat != null ? Number(row.tender_price_with_vat) : withVat(exV, pct);
  }
  if (row?.submission_price_with_vat != null && Number(row.submission_price_with_vat) > 0) {
    withV = Number(row.submission_price_with_vat);
    exV = row.submission_price != null ? Number(row.submission_price) : withoutVat(withV, pct);
  } else if (row?.submission_price != null && Number(row.submission_price) > 0) {
    exV = Number(row.submission_price);
    withV = withVat(exV, pct);
  }
  return { exVat: exV, withVat: withV, vatPct: pct };
}
