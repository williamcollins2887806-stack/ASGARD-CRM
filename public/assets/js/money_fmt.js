/**
 * Vanilla mirror of desktop-v2 money formatting.
 * Include after asgard core scripts: <script src="/assets/js/money_fmt.js"></script>
 */
(function (global) {
  'use strict';
  var VAT_DEFAULT_PCT = 22;

  function parseMoney(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).replace(/\s/g, '').replace(/₽/g, '').replace(',', '.');
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function formatMoneyShort(v, opts) {
    opts = opts || {};
    if (v == null || v === '') return opts.empty != null ? opts.empty : '—';
    var n = typeof v === 'number' ? v : parseMoney(v);
    if (n == null || !isFinite(n)) return opts.empty != null ? opts.empty : '—';
    var abs = Math.abs(n);
    var sign = n < 0 ? '−' : '';
    var cur = opts.noCurrency ? '' : ' ₽';
    if (abs >= 1e9) return sign + (abs / 1e9).toFixed(1) + ' млрд' + cur;
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + ' млн' + cur;
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(0) + ' тыс' + cur;
    var num = Math.round(n).toLocaleString('ru-RU');
    return opts.noCurrency ? num : (num + ' ₽');
  }

  function formatMoney(v, opts) {
    opts = opts || {};
    if (v == null || v === '') return opts.empty != null ? opts.empty : '—';
    var n = typeof v === 'number' ? v : parseMoney(v);
    if (n == null || !isFinite(n)) return opts.empty != null ? opts.empty : '—';
    if (opts.short) return formatMoneyShort(n, opts);
    var fd = opts.fractionDigits != null ? opts.fractionDigits : 0;
    var num = n.toLocaleString('ru-RU', { minimumFractionDigits: fd, maximumFractionDigits: fd });
    return opts.noCurrency ? num : (num + ' ₽');
  }

  function calcVatAmount(exVat, vatPct) {
    var base = Number(exVat) || 0;
    var pct = Number(vatPct);
    var rate = isFinite(pct) ? pct : VAT_DEFAULT_PCT;
    return Math.round(base * (rate / 100) * 100) / 100;
  }

  function withVat(exVat, vatPct) {
    var base = Number(exVat) || 0;
    return Math.round((base + calcVatAmount(base, vatPct)) * 100) / 100;
  }

  function withoutVat(incVat, vatPct) {
    var total = Number(incVat) || 0;
    var pct = Number(vatPct);
    var rate = isFinite(pct) ? pct : VAT_DEFAULT_PCT;
    return Math.round((total / (1 + rate / 100)) * 100) / 100;
  }

  function formatMoneyVat(withVatAmount, vatPct, opts) {
    opts = opts || {};
    var total = parseMoney(withVatAmount);
    if (total == null) return { withVat: opts.empty || '—', vatLine: '', vatAmount: 0 };
    var pct = opts.vatPct != null ? opts.vatPct : (vatPct != null ? vatPct : VAT_DEFAULT_PCT);
    var ex = opts.exVat != null ? Number(opts.exVat) : withoutVat(total, pct);
    var vatAmt = opts.vatAmount != null ? Number(opts.vatAmount) : Math.round((total - ex) * 100) / 100;
    return {
      withVat: formatMoney(total, opts),
      vatLine: 'в т.ч. НДС ' + formatMoney(vatAmt, opts),
      vatAmount: vatAmt
    };
  }

  global.AsgardMoney = {
    VAT_DEFAULT_PCT: VAT_DEFAULT_PCT,
    parseMoney: parseMoney,
    formatMoney: formatMoney,
    formatMoneyShort: formatMoneyShort,
    calcVatAmount: calcVatAmount,
    withVat: withVat,
    withoutVat: withoutVat,
    formatMoneyVat: formatMoneyVat,
    suggestSubmissionPrices: suggestSubmissionPrices,
    money: formatMoney
  };

  // Alias for display with ₽ (AsgardUI.money stays without currency for legacy compat).
  if (global.AsgardUI && typeof global.AsgardUI === 'object') {
    global.AsgardUI.moneyRub = formatMoney;
    global.AsgardUI.moneyShort = formatMoneyShort;
  }
  global.addEventListener && global.addEventListener('DOMContentLoaded', function () {
    if (global.AsgardUI) {
      global.AsgardUI.moneyRub = formatMoney;
      global.AsgardUI.moneyShort = formatMoneyShort;
    }
  });

  function suggestSubmissionPrices(row, vatPct) {
    vatPct = vatPct != null ? vatPct : VAT_DEFAULT_PCT;
    var rev = (row && row.rp_review) || {};
    var pct = Number(row && row.vat_pct) || vatPct;
    var withV = null;
    var exV = null;
    if (rev.work_price != null && Number(rev.work_price) > 0) {
      withV = Number(rev.work_price);
      exV = rev.work_price_ex_vat != null ? Number(rev.work_price_ex_vat) : withoutVat(withV, pct);
    } else if (rev.work_price_ex_vat != null && Number(rev.work_price_ex_vat) > 0) {
      exV = Number(rev.work_price_ex_vat);
      withV = withVat(exV, pct);
    } else {
      var rj = rev.report_json;
      try {
        if (typeof rj === 'string') rj = JSON.parse(rj || '{}');
      } catch (e) { rj = {}; }
      var min = Number(rj && rj.price_range_min);
      var max = Number(rj && rj.price_range_max);
      if (isFinite(min) && isFinite(max) && min > 0) {
        exV = Math.round(((min + max) / 2) * 100) / 100;
        withV = withVat(exV, pct);
      } else if (isFinite(min) && min > 0) {
        exV = min;
        withV = withVat(exV, pct);
      }
    }
    if (withV == null && row && row.tender_price != null && Number(row.tender_price) > 0) {
      exV = Number(row.tender_price);
      withV = row.tender_price_with_vat != null ? Number(row.tender_price_with_vat) : withVat(exV, pct);
    }
    if (row && row.submission_price_with_vat != null && Number(row.submission_price_with_vat) > 0) {
      withV = Number(row.submission_price_with_vat);
      exV = row.submission_price != null ? Number(row.submission_price) : withoutVat(withV, pct);
    } else if (row && row.submission_price != null && Number(row.submission_price) > 0) {
      exV = Number(row.submission_price);
      withV = withVat(exV, pct);
    }
    return { exVat: exV, withVat: withV, vatPct: pct };
  }
})(typeof window !== 'undefined' ? window : globalThis);
