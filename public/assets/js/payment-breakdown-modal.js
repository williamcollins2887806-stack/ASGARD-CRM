/* ════════════════════════════════════════════════════════════════════════════
   payment-breakdown-modal.js — модалка детализации выплат по источникам
   (vanilla v1, 2026-06-29)

   Использование:
     window.openPaymentBreakdownModal({
       employee_id, work_id, from, to, pm_id
     });

   Эндпоинт: GET /api/payroll-dashboard/worker/:id/breakdown
     ?work_id=&from=&to=&pm_id=

   Зависимости (опциональные, graceful fallback):
     - AsgardUI.showModal / AsgardUI.replaceModal / AsgardUI.hideModal
     - AsgardUI.esc / AsgardUI.toast
     - AsgardAuth.getAuth() для Bearer-токена
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ─── helpers ─────────────────────────────────────────────────────────────
  function _esc(s) {
    if (window.AsgardUI && typeof AsgardUI.esc === 'function') return AsgardUI.esc(s);
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function _toast(title, msg, tone) {
    try {
      if (window.AsgardUI && typeof AsgardUI.toast === 'function') {
        AsgardUI.toast(title, msg, tone || 'ok');
        return;
      }
      if (typeof window.toast === 'function') {
        window.toast(title, msg, tone || 'ok');
        return;
      }
    } catch (_) { /* noop */ }
    console.log('[pbm-toast]', tone || 'ok', title, msg);
  }
  function _token() {
    try {
      if (window.AsgardAuth && typeof AsgardAuth.getAuth === 'function') {
        const a = AsgardAuth.getAuth();
        return (a && a.token) || '';
      }
    } catch (_) { /* */ }
    try { return localStorage.getItem('asgard_token') || ''; } catch (_) { return ''; }
  }
  function _fmt(n) {
    const v = Number(n || 0);
    if (!isFinite(v)) return '0';
    return new Intl.NumberFormat('ru-RU').format(Math.round(v));
  }
  function _fmtR(n) { return _fmt(n) + ' ₽'; }
  function _fmtDate(d) {
    if (!d) return '—';
    try {
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return String(d);
      return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (_) { return String(d); }
  }

  function _showModal(opts) {
    if (window.AsgardUI && typeof AsgardUI.showModal === 'function') {
      return AsgardUI.showModal(opts);
    }
    // Fallback: вкладываем body в простой overlay
    const o = document.createElement('div');
    o.className = 'pbm-fallback-overlay';
    o.innerHTML = '<div class="pbm-fallback-modal"><div class="pbm-fallback-head">' +
      (opts.title || '') + '</div><div class="pbm-fallback-body">' + (opts.html || '') + '</div></div>';
    o.addEventListener('click', (e) => { if (e.target === o) o.remove(); });
    document.body.appendChild(o);
  }
  function _replaceModal(opts) {
    if (window.AsgardUI && typeof AsgardUI.replaceModal === 'function') {
      return AsgardUI.replaceModal(opts);
    }
    if (window.AsgardUI && typeof AsgardUI.hideModal === 'function') AsgardUI.hideModal();
    _showModal(opts);
  }
  function _hideModal() {
    if (window.AsgardUI && typeof AsgardUI.hideModal === 'function') AsgardUI.hideModal();
    document.querySelectorAll('.pbm-fallback-overlay').forEach(n => n.remove());
  }

  // ─── one-time styles ─────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('pbm-styles')) return;
    const s = document.createElement('style');
    s.id = 'pbm-styles';
    s.textContent = `
      .pbm-wrap { display:flex; flex-direction:column; gap:14px; font-size:13px; }
      .pbm-head {
        display:flex; flex-wrap:wrap; gap:10px; align-items:center;
        padding:12px 14px; background: var(--bg2);
        border:1px solid var(--brd); border-radius: var(--r-md);
      }
      .pbm-head .pbm-fio {
        font-size:16px; font-weight:700; color: var(--t1);
      }
      .pbm-badge {
        display:inline-flex; align-items:center; gap:4px;
        padding:3px 9px; border-radius: 999px;
        font-size:11px; font-weight:700; letter-spacing:.3px;
        border:1px solid transparent;
      }
      .pbm-badge.is-official {
        background: var(--gold-bg); color: var(--gold);
        border-color: var(--gold);
      }
      .pbm-badge.is-se {
        background: var(--purple-bg); color: var(--purple);
        border-color: var(--purple);
      }
      .pbm-badge.is-neither {
        background: var(--bg3); color: var(--t2);
        border-color: var(--brd);
      }
      .pbm-meta {
        font-size:12px; color: var(--t2);
        display:flex; gap:14px; flex-wrap:wrap;
      }
      .pbm-meta b { color: var(--t1); font-weight:600; }

      .pbm-grid {
        display:grid; grid-template-columns: 1fr 1fr; gap:12px;
      }
      @media (max-width: 760px) { .pbm-grid { grid-template-columns: 1fr; } }
      .pbm-card {
        padding:14px;
        background: var(--bg2);
        border:1px solid var(--brd);
        border-radius: var(--r-md);
        display:flex; flex-direction:column; gap:8px;
      }
      .pbm-card-title {
        font-size:11px; font-weight:800; letter-spacing:.6px;
        color: var(--t2); text-transform:uppercase;
        padding-bottom:6px; border-bottom:1px solid var(--brd-m);
      }
      .pbm-row {
        display:flex; align-items:baseline; justify-content:space-between;
        gap:10px; padding:3px 0;
      }
      .pbm-row .lbl {
        font-size:13px; color: var(--t1);
        display:flex; align-items:center; gap:6px;
      }
      .pbm-row .val {
        font-size:14px; font-weight:700;
        font-variant-numeric: tabular-nums;
        color: var(--t1);
      }
      .pbm-row.is-neg .val { color: var(--err); }
      .pbm-row.is-bank   .lbl { color: var(--blue); }
      .pbm-row.is-cash   .lbl { color: var(--ok); }
      .pbm-row.is-se     .lbl { color: var(--purple); }
      .pbm-row.is-auto   .lbl { color: var(--gold); }
      .pbm-row.is-other  .lbl { color: var(--t3); }
      .pbm-card-total {
        margin-top:6px; padding-top:8px;
        border-top:1px dashed var(--brd);
        display:flex; justify-content:space-between; align-items:baseline;
      }
      .pbm-card-total .lbl {
        font-size:12px; font-weight:800; color: var(--t2);
        text-transform:uppercase; letter-spacing:.5px;
      }
      .pbm-card-total .val {
        font-size:16px; font-weight:800; color: var(--t1);
        font-variant-numeric: tabular-nums;
      }

      .pbm-bal {
        padding:12px 14px; border-radius: var(--r-md);
        font-size:14px; font-weight:700;
        display:flex; justify-content:space-between; align-items:center; gap:10px;
        border:1px solid transparent;
      }
      .pbm-bal.ok {
        background: var(--ok-bg); color: var(--ok); border-color: var(--ok);
      }
      .pbm-bal.warn {
        background: var(--warn-bg); color: var(--warn); border-color: var(--warn);
      }
      .pbm-bal.over {
        background: var(--err-bg); color: var(--err); border-color: var(--err);
      }
      .pbm-bal .val { font-variant-numeric: tabular-nums; font-size:16px; }

      .pbm-ops-wrap {
        max-height: 40vh; overflow:auto;
        border:1px solid var(--brd); border-radius: var(--r-md);
        background: var(--bg2);
      }
      .pbm-ops {
        width:100%; border-collapse:collapse; font-size:12px;
      }
      .pbm-ops thead th {
        position: sticky; top:0; z-index:1;
        background: var(--bg3);
        color: var(--t2);
        font-size:11px; font-weight:700;
        text-transform: uppercase; letter-spacing:.5px;
        text-align:left; padding:8px 10px;
        border-bottom:1px solid var(--brd);
      }
      .pbm-ops tbody td {
        padding:7px 10px;
        border-bottom:1px solid var(--brd-m);
        color: var(--t1);
        vertical-align: top;
      }
      .pbm-ops td.num { text-align:right; font-variant-numeric: tabular-nums; }
      .pbm-empty {
        padding:30px; text-align:center;
        color: var(--t2);
      }

      .pbm-chip {
        display:inline-block; padding:2px 8px; border-radius: 999px;
        font-size:11px; font-weight:700;
        border:1px solid transparent; white-space:nowrap;
      }
      .pbm-chip.src-pm-cash    { background: var(--ok-bg);     color: var(--ok);     border-color: var(--ok); }
      .pbm-chip.src-bank       { background: var(--blue-bg);   color: var(--blue);   border-color: var(--blue); }
      .pbm-chip.src-se         { background: var(--purple-bg); color: var(--purple); border-color: var(--purple); }
      .pbm-chip.src-auto       { background: var(--gold-bg);   color: var(--gold);   border-color: var(--gold); }
      .pbm-chip.src-other      { background: var(--bg3);       color: var(--t2);     border-color: var(--brd); }

      .pbm-actions {
        display:flex; justify-content:flex-end; gap:8px; margin-top:6px;
      }

      .pbm-fallback-overlay {
        position:fixed; inset:0; background: var(--overlay, rgba(0,0,0,.5));
        z-index: var(--z-modal, 500);
        display:flex; align-items:center; justify-content:center; padding:16px;
      }
      .pbm-fallback-modal {
        max-width: 960px; width:100%; max-height: 86vh; overflow:auto;
        background: var(--bg2); color: var(--t1);
        border:1px solid var(--brd); border-radius: var(--r-lg);
        padding:18px;
      }
      .pbm-fallback-head { font-weight:700; font-size:16px; margin-bottom:12px; color: var(--t1); }
    `;
    document.head.appendChild(s);
  }

  // ─── source helpers ──────────────────────────────────────────────────────
  // Склейка pm_cash + pm_cash_legacy → pm_cash
  function _normalizeSource(src) {
    if (src === 'pm_cash_legacy') return 'pm_cash';
    return src || 'other';
  }
  const SRC_LABEL = {
    pm_cash:      '📤 Моя касса',
    company_bank: '🏦 Банк',
    company_se:   '📱 СЗ-сервис',
    auto_fot:     '⚙ Авто-ФОТ',
    other:        '· Прочее'
  };
  const SRC_CHIP_CLS = {
    pm_cash:      'src-pm-cash',
    company_bank: 'src-bank',
    company_se:   'src-se',
    auto_fot:     'src-auto',
    other:        'src-other'
  };
  const OP_TYPE_LABEL = {
    salary:   'Зарплата',
    per_diem: 'Суточные',
    bonus:    'Премия',
    advance:  'Аванс',
    penalty:  'Удержание',
    return:   'Возврат'
  };

  // ─── API ─────────────────────────────────────────────────────────────────
  async function fetchBreakdown(opts) {
    const params = new URLSearchParams();
    if (opts.work_id) params.set('work_id', opts.work_id);
    if (opts.from)    params.set('from', opts.from);
    if (opts.to)      params.set('to', opts.to);
    if (opts.pm_id)   params.set('pm_id', opts.pm_id);
    const url = '/api/payroll-dashboard/worker/' + encodeURIComponent(opts.employee_id)
              + '/breakdown' + (params.toString() ? ('?' + params.toString()) : '');
    const tok = _token();
    const resp = await fetch(url, {
      headers: tok ? { 'Authorization': 'Bearer ' + tok } : {}
    });
    if (!resp.ok) {
      let err = null;
      try { err = await resp.json(); } catch (_) { err = null; }
      throw new Error((err && (err.error || err.message)) || ('HTTP ' + resp.status));
    }
    return resp.json();
  }

  // ─── render ──────────────────────────────────────────────────────────────
  function renderLoading(opts) {
    return '<div class="pbm-empty">⏳ Загружаем разбивку…</div>';
  }

  function renderError(msg) {
    return '<div class="pbm-empty" style="color:var(--err)">⚠ ' + _esc(msg || 'Ошибка') + '</div>';
  }

  function renderBreakdown(d) {
    const isOff = !!d.is_officially_employed;
    const isSe  = !!d.is_self_employed;

    const badge = isOff
      ? '<span class="pbm-badge is-official">штатник</span>'
      : (isSe ? '<span class="pbm-badge is-se">СЗ</span>'
              : '<span class="pbm-badge is-neither">внешт.</span>');

    const accrued = d.accrued || {};
    const paid    = d.paid    || {};

    // склейка pm_cash + pm_cash_legacy
    const paidPmCash = Number(paid.pm_cash || 0) + Number(paid.pm_cash_legacy || 0);

    const periodStr =
      (d.period && (d.period.from || d.period.to))
        ? (_fmtDate(d.period.from) + ' — ' + _fmtDate(d.period.to))
        : '—';

    const headHtml =
      '<div class="pbm-head">' +
        '<div class="pbm-fio">' + _esc(d.employee_fio || '—') + '</div>' +
        badge +
        '<div class="pbm-meta">' +
          '<span>📅 <b>' + _esc(periodStr) + '</b></span>' +
          (d.work_title ? '<span>🛠 <b>' + _esc(d.work_title) + '</b></span>' : '') +
          (d.pm_name    ? '<span>👤 РП: <b>' + _esc(d.pm_name)    + '</b></span>' : '') +
        '</div>' +
      '</div>';

    // ─── Начислено
    const accruedRows = [
      { key: 'salary',   lbl: '💼 Зарплата', val: accrued.salary },
      { key: 'bonus',    lbl: '⭐ Премии',   val: accrued.bonus },
      { key: 'per_diem', lbl: '🌙 Суточные', val: accrued.per_diem },
      { key: 'advance',  lbl: '💵 Авансы',   val: accrued.advance },
      { key: 'penalty',  lbl: '⚠ Удержания', val: accrued.penalty, neg: true }
    ];
    const accruedHtml = accruedRows.map(r => {
      const v = Number(r.val || 0);
      const sign = r.neg && v > 0 ? '−' : '';
      const cls = r.neg && v > 0 ? ' is-neg' : '';
      return '<div class="pbm-row' + cls + '">' +
               '<span class="lbl">' + r.lbl + '</span>' +
               '<span class="val">' + sign + _fmtR(v) + '</span>' +
             '</div>';
    }).join('');
    const accruedTotal = Number(accrued.total || 0);

    // ─── Выплачено
    const paidRows = [
      { key: 'company_bank', cls: 'is-bank',  lbl: '🏦 Банк компании',  val: paid.company_bank },
      { key: 'pm_cash',      cls: 'is-cash',  lbl: '📤 Касса РП',       val: paidPmCash, hint: (paid.pm_cash_legacy ? '(вкл. legacy)' : null) },
      { key: 'company_se',   cls: 'is-se',    lbl: '📱 СЗ-сервис',      val: paid.company_se },
      { key: 'auto_fot',     cls: 'is-auto',  lbl: '⚙ Авто-ФОТ',         val: paid.auto_fot },
      { key: 'other',        cls: 'is-other', lbl: '· Прочее',          val: paid.other }
    ];
    const paidHtml = paidRows.map(r => {
      const v = Number(r.val || 0);
      const hint = r.hint ? ' <span style="font-size:11px;color:var(--t3)">' + _esc(r.hint) + '</span>' : '';
      return '<div class="pbm-row ' + r.cls + '">' +
               '<span class="lbl">' + r.lbl + hint + '</span>' +
               '<span class="val">' + _fmtR(v) + '</span>' +
             '</div>';
    }).join('');
    const paidTotal = Number(paid.total || 0);

    const breakdownHtml =
      '<div class="pbm-grid">' +
        '<div class="pbm-card">' +
          '<div class="pbm-card-title">📊 Начислено</div>' +
          accruedHtml +
          '<div class="pbm-card-total">' +
            '<span class="lbl">ИТОГО</span>' +
            '<span class="val">' + _fmtR(accruedTotal) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="pbm-card">' +
          '<div class="pbm-card-title">💸 Выплачено</div>' +
          paidHtml +
          '<div class="pbm-card-total">' +
            '<span class="lbl">ИТОГО</span>' +
            '<span class="val">' + _fmtR(paidTotal) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    // ─── Balance
    const balance = (typeof d.balance === 'number') ? d.balance : (accruedTotal - paidTotal);
    let balCls = 'ok', balText = '✓ Полностью закрыто', balVal = '';
    if (balance > 0) {
      balCls = 'warn';
      balText = '⚠ К доплате';
      balVal  = _fmtR(balance);
    } else if (balance < 0) {
      balCls = 'over';
      balText = '⚠ Переплата';
      balVal  = _fmtR(Math.abs(balance));
    }
    const balHtml =
      '<div class="pbm-bal ' + balCls + '">' +
        '<span>' + balText + '</span>' +
        (balVal ? '<span class="val">' + balVal + '</span>' : '') +
      '</div>';

    // ─── Operations table
    const ops = Array.isArray(d.operations) ? d.operations : [];
    let opsHtml;
    if (!ops.length) {
      opsHtml = '<div class="pbm-empty">Нет операций за период</div>';
    } else {
      const rows = ops.map(op => {
        const src = _normalizeSource(op.source_kind);
        const chipCls = SRC_CHIP_CLS[src] || 'src-other';
        const lbl = SRC_LABEL[src] || (src || '—');
        const typeLabel = OP_TYPE_LABEL[op.type] || (op.type || '—');
        const amt = Number(op.amount || 0);
        const sign = amt < 0 ? '−' : '';
        return '<tr>' +
                 '<td>' + _esc(_fmtDate(op.date)) + '</td>' +
                 '<td>' + _esc(typeLabel) + '</td>' +
                 '<td class="num">' + sign + _fmtR(Math.abs(amt)) + '</td>' +
                 '<td><span class="pbm-chip ' + chipCls + '">' + lbl + '</span></td>' +
                 '<td>' + _esc(op.paid_by_name || '—') + '</td>' +
               '</tr>';
      }).join('');
      opsHtml =
        '<div class="pbm-ops-wrap">' +
          '<table class="pbm-ops">' +
            '<thead><tr>' +
              '<th>Дата</th><th>Тип</th>' +
              '<th class="num">Сумма</th>' +
              '<th>Источник</th><th>Кто выдал</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';
    }

    const actionsHtml =
      '<div class="pbm-actions">' +
        '<button class="btn ghost" id="pbmClose">Закрыть</button>' +
      '</div>';

    return '<div class="pbm-wrap">' +
             headHtml +
             breakdownHtml +
             balHtml +
             opsHtml +
             actionsHtml +
           '</div>';
  }

  function bindActions() {
    const closeBtn = document.getElementById('pbmClose');
    if (closeBtn) closeBtn.addEventListener('click', () => _hideModal());
  }

  // ─── PUBLIC ──────────────────────────────────────────────────────────────
  async function openPaymentBreakdownModal(opts) {
    opts = opts || {};
    if (!opts.employee_id) {
      _toast('Ошибка', 'employee_id обязателен', 'err');
      return;
    }
    injectStyles();

    _showModal({
      title:   'Детализация выплат',
      icon:    '💰',
      wide:    true,
      html:    renderLoading()
    });

    let data;
    try {
      data = await fetchBreakdown(opts);
    } catch (e) {
      _replaceModal({
        title: 'Детализация выплат',
        icon:  '⚠',
        wide:  true,
        html:  renderError((e && e.message) || 'Не удалось загрузить')
      });
      bindActions();
      return;
    }

    _replaceModal({
      title:    'Детализация выплат',
      subtitle: data.employee_fio || '',
      icon:     '💰',
      wide:     true,
      html:     renderBreakdown(data)
    });
    bindActions();
  }

  // expose
  window.openPaymentBreakdownModal = openPaymentBreakdownModal;
  window.AsgardPaymentBreakdownModal = { open: openPaymentBreakdownModal };
})();
