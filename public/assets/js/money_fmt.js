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
    resolveWorkPrice: resolveWorkPrice,
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

  /**
   * Канон цены работ РП: `work_price` — цена БЕЗ НДС (зеркало src/services/work-price.js).
   * Legacy-карточки 2025 г.: work_price хранил цену С НДС, а work_price_ex_vat = /1.22 —
   * распознаём по отношению и читаем верно, чтобы старые карточки не «подорожали».
   */
  function resolveWorkPrice(review, vatPct) {
    var rev = review || {};
    var pct = Number(vatPct);
    if (!isFinite(pct) || pct <= 0) pct = VAT_DEFAULT_PCT;
    var wp = parseMoney(rev.work_price);
    var wpEx = parseMoney(rev.work_price_ex_vat);
    if (wp == null || !(wp > 0)) {
      if (wpEx != null && wpEx > 0) return { exVat: wpEx, withVat: withVat(wpEx, pct), vatPct: pct, legacy: false };
      return { exVat: null, withVat: null, vatPct: pct, legacy: false };
    }
    if (wpEx != null && wpEx > 0 && wpEx < wp
        && Math.abs(wp / wpEx - (1 + pct / 100)) < 0.02) {
      return { exVat: wpEx, withVat: wp, vatPct: pct, legacy: true };
    }
    return { exVat: wp, withVat: withVat(wp, pct), vatPct: pct, legacy: false };
  }

  /**
   * Цены подачи для модалки «Подались».
   *
   * ВАЖНО: `vatPct` — приоритетный источник, `row.vat_pct` — вторичный.
   * Найдено 21.09.2026 (D-243): здесь стояло `Number(row.vat_pct) || vatPct`, поэтому
   * ставка карточки (у колонки tenders.vat_pct DEFAULT 20, на проде — 1401 строка)
   * побеждала настройку: подпись в модалке читала настройку (22 %), а суммы считались
   * по 20 %. Итог: подпись «С НДС 22%», а рядом НДС, посчитанный как 20 %.
   * Теперь настройка главная, карточка — только если настройки нет.
   * Сохранённая сумма подачи берётся как БАЗА без НДС, а сумма с НДС пересчитывается по
   * текущей ставке — иначе у уже поданных «20 %-эпохи» тендеров пара сумма-без-НДС ↔
   * сумма-с-НДС шла бы в PATCH как есть, но с меткой ставки из настроек (D-243, лицо 7).
   */
  function suggestSubmissionPrices(row, vatPct) {
    var vatPctGiven = vatPct != null && vatPct !== '';
    var pct = vatPctGiven ? Number(vatPct) : (Number(row && row.vat_pct) || VAT_DEFAULT_PCT);
    if (!isFinite(pct) || pct < 0 || pct > 100) pct = VAT_DEFAULT_PCT;
    var rev = (row && row.rp_review) || {};
    var withV = null;
    var exV = null;
    var rw = resolveWorkPrice(rev, pct);
    withV = rw.withVat;
    exV = rw.exVat;
    if (withV == null) {
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
    // Сохранённая сумма подачи — база БЕЗ НДС; сумма с НДС ПЕРЕСЧИТЫВАЕТСЯ по ставке из
    // настроек (деньги = база × (1+ставка)). Прежнее поведение брало сохранённую пару как есть
    // (`withV = row.submission_price_with_vat`, `exV = row.submission_price`), и у поданного
    // при 20 % тендера модалка показывала/переотправляла 20 %-пару, помечая её настройкой 22 %
    // (payload 111/135 → отношение 1.2162 ≠ 1.22) — молчаливая несогласованность (D-243, лицо 7).
    if (row && row.submission_price != null && Number(row.submission_price) > 0) {
      exV = Number(row.submission_price);
      withV = withVat(exV, pct);
    } else if (row && row.submission_price_with_vat != null && Number(row.submission_price_with_vat) > 0) {
      // Нет базы — разворачиваем сохранённую сумму с НДС ТЕКУЩЕЙ ставкой, чтобы пара была
      // согласована: withVat(withoutVat(saved, pct), pct) == saved (ставка — единственный источник).
      withV = Number(row.submission_price_with_vat);
      exV = withoutVat(withV, pct);
    }
    return { exVat: exV, withVat: withV, vatPct: pct };
  }
})(typeof window !== 'undefined' ? window : globalThis);
