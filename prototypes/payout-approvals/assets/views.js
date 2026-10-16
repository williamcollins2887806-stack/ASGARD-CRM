/* ASGARD CRM — прототип: экраны. Живые DOM-функции (переносятся в ваниль почти 1:1). */
(function () {
  'use strict';
  var D = window.PP_DATA;
  var money = D.money, moneyRub = D.moneyRub, calcItem = D.calcItem, modeLabel = D.modeLabel;

  // ── Состояние прототипа ────────────────────────────────────────────────
  var S = {
    theme: 'dark',
    cart: [],                         // [{employee_id, kind, pay_amount, comment}]
    drafts: {},                       // employee_id -> {kind, pay_amount, comment, status}
    checked: {},                      // employee_id -> true
    batch: null,                      // активная пачка (состояние согласования)
    rejected: {},                     // employee_id -> причина (после возврата пачки)
    adjustments: {},                  // employee_id -> {delta, reason, newValue}
    cartTab: 'all',                   // фильтр корзины
    ovTab: 'payouts'                  // вкладка на экране ОВ
  };
  // Предзаполняем корзину как будто Дима уже добавил (для наглядности)
  D.BATCH_NEW.items.forEach(function (it) { addCart(it); });
  // И пачка уже отправлена на согласование (чтобы экран ОВ был наполнен при открытии)
  S.batch = {
    id: D.BATCH_PENDING.id, created_by: D.BATCH_PENDING.created_by,
    period: D.BATCH_PENDING.period, status: 'pending_approval',
    submitted_at: D.BATCH_PENDING.submitted_at,
    items: D.BATCH_PENDING.items.map(function (i) {
      return { employee_id: i.employee_id, kind: i.kind, pay_amount: i.pay_amount, comment: i.comment, approval_status: 'pending' };
    })
  };

  function addCart(it) {
    if (!S.cart.some(function (c) { return c.employee_id === it.employee_id; })) {
      S.cart.push({ employee_id: it.employee_id, kind: it.kind, pay_amount: it.pay_amount, comment: it.comment });
    }
  }
  function inCart(id) { return S.cart.some(function (c) { return c.employee_id === id; }); }

  // ЕДИНЫЙ источник состояния строки: пачка (согласование) → корзина → пусто.
  // Раньше строки читали S.drafts, а согласование писало в S.batch — рассинхрон,
  // из-за которого «Выплатить» была активна до одобрения (баг, найден верификатором).
  function batchItem(id) {
    if (!S.batch) return null;
    for (var i = 0; i < S.batch.items.length; i++) if (S.batch.items[i].employee_id === id) return S.batch.items[i];
    return null;
  }
  function rowState(id) {
    var it = batchItem(id);
    if (it) {
      if (it.reapproved) return { status: 'reapproved', reason: null, inBatch: true };
      return { status: it.approval_status || 'pending', reason: it.reject_reason || null, inBatch: true };
    }
    if (S.rejected[id]) return { status: 'rejected', reason: S.rejected[id], inBatch: false };
    if (inCart(id)) return { status: 'draft', reason: null, inBatch: false };
    return { status: null, reason: null, inBatch: false };
  }
  function canPay(id) { var s = rowState(id); return s.status === 'approved'; }

  // ── Общие мелочи ───────────────────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function initials(fio) { var p = String(fio).split(' '); return (p[0][0] || '') + (p[1] ? p[1][0] : ''); }
  function toast(t, m, type) {
    var host = document.getElementById('toast');
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'ok');
    el.innerHTML = '<b>' + esc(t) + '</b>' + (m ? '<span>' + esc(m) + '</span>' : '');
    host.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 300); }, 2800);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ЭКРАН 1. Выплаты (Дима) — таблица с корзиной
  // ═══════════════════════════════════════════════════════════════════════
  function payoutsScreen() {
    var rows = D.M.map(function (e, i) {
      var st = rowState(e.id);
      var status = st.status;                            // draft|pending|approved|rejected|null
      var bad = inCart(e.id);
      var cls = '';
      if (status === 'draft') cls = 'po-row-draft';
      if (status === 'pending') cls = 'po-row-pending';
      if (status === 'approved') cls = 'po-row-approved';
      if (status === 'reapproved') cls = 'po-row-reapproved';
      if (status === 'rejected') cls = 'po-row-rejected';

      var tag = modeLabel(e.mode);
      var ready = '';
      if (status === 'draft') ready = '<span class="po-ready po-ready--draft"><i class="pulse"></i>Готова к отправке</span>';
      if (status === 'pending') ready = '<span class="po-ready po-ready--pending"><i class="pulse"></i>Ждёт согласования ОВ · Олег Викторович</span>';
      if (status === 'approved') ready = '<span class="po-ready po-ready--approved"><i class="pulse"></i>Согласовано ОВ · можно платить</span>';
      if (status === 'reapproved') ready = '<span class="po-ready po-ready--pending"><i class="pulse"></i>Правка после согласования · ждёт повторного согласования ОВ</span>';
      if (status === 'rejected') ready = '<span class="po-ready po-ready--rejected"><i class="pulse"></i>Возврат: ' + esc(st.reason || 'с комментарием') + '</span>';

      // ТЗ №7: «Выплатить» доступна ТОЛЬКО после согласования ОВ.
      // Если Дима поправил уже согласованную выплату — нужно ПОВТОРНОЕ согласование.
      var payCell;
      if (status === 'approved') {
        payCell = '<button class="btn ok sm" data-pp-pay="' + e.id + '">Выплатить</button> ' +
          '<button class="btn ghost sm" data-pp-open="' + e.id + '" title="Поправить сумму — потребует повторного согласования ОВ">Поправить</button>';
      } else if (status === 'pending') {
        payCell = '<button class="btn sm" disabled title="Ждёт согласования ОВ (Олег Викторович)">Выплатить 🔒</button>';
      } else if (status === 'reapproved') {
        payCell = '<button class="btn sm" disabled title="Правка ждёт повторного согласования ОВ">Выплатить 🔒</button>';
      } else if (status === 'rejected') {
        payCell = '<button class="btn sm" data-pp-open="' + e.id + '" title="Вернули — исправьте и отправьте снова">Исправить</button>';
      } else {
        payCell = '<button class="btn primary sm" data-pp-open="' + e.id + '">Выплатить</button>';
      }

      return '<tr class="' + cls + '">' +
        '<td class="po-num">' + (i + 1) + '</td>' +
        '<td class="po-chkcell">' + (status === 'approved' || status === 'pending' || status === 'reapproved'
          ? '<span class="po-chk is-on" data-locked="1" title="' + (status === 'approved' ? 'Согласовано ОВ (Олег Викторович)' : 'Ждёт согласования ОВ (Олег Викторович)') + '"></span>'
          : '<span class="po-chk ' + (bad ? 'is-on' : '') + '" data-pp-chk="' + e.id + '" role="checkbox" aria-checked="' + (bad ? 'true' : 'false') + '"></span>') + '</td>' +
        '<td><div class="po-fio"><div class="po-fio__name">' + esc(e.fio) + '</div>' +
          '<span class="po-fio__badges"><span class="pp-tag ' + tag.cls + '">' + tag.t + '</span>' +
          (e.payee ? '<span class="pp-tag pp-tag--payee">через получателя</span>' : '') +
          (e.warning ? '<span class="badge warning">внимание</span>' : '') +
          (bad ? '<span class="badge gold">в корзине</span>' : '') + '</span></div>' +
          (ready ? '<div class="mt-2">' + ready + '</div>' : '') + '</td>' +
        '<td class="right num">' + money(e.carryDebt) +
          (status ? '' : '<button class="po-carry-edit" data-pp-carry="' + e.id + '" title="Скорректировать остаток"><em>✎</em> правка</button>') + '</td>' +
        '<td class="right num">' + money(e.accrued) + '</td>' +
        '<td class="right num">' + (e.carryAdvance ? money(e.carryAdvance) : '—') + '</td>' +
        '<td class="right num">' + (e.penalty ? money(e.penalty) : '—') + '</td>' +
        '<td class="right num" style="font-weight:700;color:var(--ok-t)">' + money(e.to_pay) + '</td>' +
        '<td class="right">' + payCell + '</td>' +
        '</tr>';
    }).join('');

    var t = D.TOTALS;
    return '' +
      '<div class="po-head">' +
        '<div><div class="po-head-title">Выплата за ' + D.MONTHS[D.PERIOD.month - 1] + ' ' + D.PERIOD.year + '</div>' +
        '<div class="po-head-sub">Сегодня 15.10.2026 — выплачиваем заработок за прошлый месяц. ' + t.employees + ' сотрудников.</div></div>' +
        '<div class="po-head-actions"><span class="badge success">Табель закрыт — можно платить</span>' +
        '<button class="btn ghost sm">Excel</button><button class="btn ghost sm">Архив</button></div>' +
      '</div>' +
      '<div class="po-kpi-grid">' +
        '<div class="po-kpi po-kpi--accent"><div class="po-kpi-label">К выплате за месяц</div><div class="po-kpi-value">' + moneyRub(t.to_pay) + '</div></div>' +
        '<div class="po-kpi"><div class="po-kpi-label">Начислено</div><div class="po-kpi-value">' + moneyRub(t.accrued) + '</div></div>' +
        '<div class="po-kpi"><div class="po-kpi-label">Перенос с прошлых</div><div class="po-kpi-value">' + moneyRub(t.carry) + '</div></div>' +
        '<div class="po-kpi"><div class="po-kpi-label">В корзине</div><div class="po-kpi-value">' + S.cart.length + ' <small>чел.</small></div></div>' +
      '</div>' +
      '<div class="po-chart-box"><div class="po-chart-head"><div class="po-chart-cap">Начислено и получено за ' + D.PERIOD.year + '</div>' +
      '<div class="po-chart-legend"><span class="po-lg"><i class="po-lg-dot po-lg-acc"></i>Начислено</span><span class="po-lg"><i class="po-lg-dot po-lg-paid"></i>Получено</span></div></div>' +
      '<canvas class="po-canvas-emp" id="pp-chart" height="180"></canvas></div>' +
      '<div class="tablewrap"><table class="asg po-table"><thead><tr>' +
        '<th class="po-num">№</th><th class="po-chkcell"></th><th>ФИО</th>' +
        '<th class="right">Остаток</th><th class="right">Начислено</th><th class="right">Аванс</th>' +
        '<th class="right">Удержание</th><th class="right">К выплате</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  // ═══════════════════════════════════════════════════════════════════════
  // МОДАЛКА выплаты (Сохранить и выйти)
  // ═══════════════════════════════════════════════════════════════════════
  function payModal(empId) {
    var e = D.byId(empId);
    var toPay = Math.max(0, e.to_pay);
    var tag = modeLabel(e.mode);
    var pay = toPay;
    var c = calcItem(e, pay);
    var payeesAll = D.payeesOf(e);
    return '' +
      '<div class="po-modal">' +
        '<div class="po-modal-kpis">' +
          '<div class="po-mk"><div class="po-mk-label">К выплате сейчас</div><div class="po-mk-value po-mk-accent">' + money(toPay) + '</div></div>' +
          '<div class="po-mk"><div class="po-mk-label">Заработано (начислено)</div><div class="po-mk-value">' + money(e.accrued) + '</div></div>' +
          '<div class="po-mk"><div class="po-mk-label">Способ</div><div class="po-mk-value" style="font-size:14px">' + tag.d + '</div></div>' +
        '</div>' +
        (function () {
          var ps = D.payeesOf(e);
          if (!ps.length) return '';
          if (ps.length === 1) {
            return '<div class="po-payee"><span class="po-payee-ico">🔁</span><div class="po-payee-txt"><b>Выплата через получателя НПД</b><span>' + esc(ps[0].fio) + ' · ' + esc(ps[0].phone) + '</span><small>Деньги и лимит НПД идут на получателя, не на рабочего</small></div></div>';
          }
          // два получателя → выбор «через кого»
          return '<div class="po-payee-pick"><div class="po-section-title">Через кого переводим</div>' +
            '<div class="po-payee-pick__list">' +
            ps.map(function (p, i) {
              return '<label class="po-payee-opt ' + (i === 0 ? 'is-on' : '') + '" data-pp-payee="' + p.id + '">' +
                '<span class="po-payee-opt__radio"></span>' +
                '<span><span class="po-payee-opt__t">' + esc(p.fio) + '</span><br><span class="po-payee-opt__s">' + esc(p.phone) + ' · НПД-лимит получателя</span></span>' +
              '</label>';
            }).join('') +
            '</div></div>';
        })() +
        '<div><div class="po-section-title">Что выплачиваем</div><div class="po-kind-cards">' +
          '<button class="po-zcard active" data-pp-kind="advance"><span class="po-zcard-ico">💸</span><span class="po-zcard-t">Аванс</span><span class="po-zcard-d">часть заработка досрочно</span></button>' +
          '<button class="po-zcard" data-pp-kind="salary"><span class="po-zcard-ico">💰</span><span class="po-zcard-t">Зарплата</span><span class="po-zcard-d">выплата за месяц</span></button>' +
        '</div></div>' +
        '<div><div class="po-section-title">Сумма</div><div class="po-form-grid">' +
          '<div><label class="po-lbl">Выплачиваем (в счёт начисленного)</label><input class="input po-amount" type="number" value="' + toPay + '"></div>' +
          (e.mode === 'cash' ? '<div><label class="po-lbl">Переводим рабочему (на руки)</label><input class="input po-transfer" type="number" value="' + toPay + '"></div>' : '') +
        '</div>' +
        '<div class="po-quick mt-2"><button class="po-chip" data-pp-q="all">Всё к выплате</button><button class="po-chip" data-pp-q="half">Половина</button><button class="po-chip" data-pp-q="clear">Очистить</button></div>' +
        '<div class="po-hint mt-2">Останется к выплате: <b>0 ₽</b></div></div>' +
        (e.mode === 'cash' ? '<label class="po-official-toggle"><input type="checkbox" data-pp-official><span class="po-official-box"></span><span class="po-official-txt">Перевод с НДФЛ <b>+15%</b><small>например: 100 000 ₽ → 115 000 ₽</small></span></label>' : '') +
        '<div class="po-adj-section"><div class="po-section-title">Премия / удержание</div>' +
          '<p class="po-adj-head">Сумма сразу попадёт в «К выплате», табель и расчётный лист. Деньги переводятся отдельно кнопкой выплаты.</p>' +
          '<div class="po-form-grid"><div><label class="po-lbl">🎁 Премия, ₽</label><input class="input" placeholder="0"><input class="input mt-2" placeholder="Кто согласовал и за что"></div>' +
          '<div><label class="po-lbl">⛔ Удержание / штраф, ₽</label><input class="input" placeholder="0"><input class="input mt-2" placeholder="За что удержание"></div></div>' +
          '<div class="po-adj-actions mt-3"><button class="btn ghost sm" data-pp-adj>Применить премию / удержание</button><span class="po-adj-status"></span></div></div>' +
        '<div><div class="po-section-title">Так это увидит рабочий в приложении</div>' +
          '<div class="po-wa-card"><div class="po-wa-head">💰 Вам произведена выплата ' + moneyRub(c.gotAmount) + '</div>' +
          '<div class="po-wa-sec">' + (e.mode === 'advance' ? 'Аванс' : 'Зарплата') + ' за ' + D.MONTHS[D.PERIOD.month - 1] + ' ' + D.PERIOD.year + '</div>' +
          '<div class="po-wa-row"><span>Заработано за месяц</span><b>' + moneyRub(e.accrued) + '</b></div>' +
          '<div class="po-wa-row"><span>Остаток с прошлых</span><b>' + moneyRub(D.r2(e.carryDebt - e.carryAdvance)) + '</b></div>' +
          '<div class="po-wa-row po-wa-total"><span>Переведено рабочему</span><b class="po-ok">' + moneyRub(c.gotAmount) + '</b></div>' +
          '<div class="po-wa-row"><span>Способ</span><b>' + tag.d + '</b></div>' +
          '<div class="po-wa-note">Рабочий получит уведомление и подтвердит получение кодом.</div></div>' +
          '<div class="pp-wa-mini"><div class="pp-wa-mini__t">Что увидит Олег Викторович на согласовании</div>' +
            '<div class="po-wa-row"><span>Выплачиваем</span><b>' + moneyRub(pay) + '</b></div>' +
            '<div class="po-wa-row"><span>Налог / сбор <span class="dim">(' + (e.mode === 'se' ? 'сбор+НДС 22%' : e.mode === 'ndfl' ? '+15% НДФЛ' : '1:1') + ')</span></span><b>' + moneyRub(c.taxAmount) + '</b></div>' +
            '<div class="po-wa-row"><span>Человеку придёт</span><b class="po-ok">' + moneyRub(c.gotAmount) + '</b></div>' +
            '<div class="po-wa-row"><span>Всего к переводу</span><b style="color:var(--gold)">' + moneyRub(c.totalAmount) + '</b></div>' +
            (payeesAll.length ? '<div class="po-wa-row"><span>Через кого</span><b>' + esc(payeesAll.length > 1 ? 'выбрать получателя' : payeesAll[0].fio) + '</b></div>' : '') +
          '</div></div>' +
        '<div class="po-actions">' +
          '<button class="btn ghost" data-pp-modal-close>Отмена</button>' +
          '<button class="btn ghost" data-pp-save="' + empId + '">Сохранить и выйти</button>' +
          '<button class="btn primary" data-pp-save-cart="' + empId + '">Сохранить и в корзину</button>' +
        '</div>' +
      '</div>';
  }

  // ── Модалка корректировки остатка (было → стало + обязательная причина) ──
  function carryModal(empId) {
    var e = D.byId(empId);
    var cur = D.r2(e.carryDebt - e.carryAdvance);
    return '<div class="po-modal" data-carry="' + empId + '">' +
      '<div class="po-section-title">Корректировка остатка · ' + esc(e.fio) + '</div>' +
      '<div class="po-adj-delta">' +
        '<div class="po-adj-delta__side"><div class="po-adj-delta__l">Сейчас</div><div class="po-adj-delta__v">' + moneyRub(cur) + '</div></div>' +
        '<div class="po-adj-delta__arrow">→</div>' +
        '<div class="po-adj-delta__side"><div class="po-adj-delta__l">Нужно</div><div class="po-adj-delta__v po-adj-delta__v--new" id="carry_new_preview">' + moneyRub(cur) + '</div></div>' +
      '</div>' +
      '<div class="po-form-grid"><div><label class="po-lbl">Новый остаток, ₽ (можно отрицательный)</label>' +
      '<input class="input po-carry-new" type="number" step="0.01" value="' + cur + '"></div>' +
      '<div><label class="po-lbl">Расхождение (посчитается)</label>' +
      '<input class="input" id="carry_delta" value="0" readonly></div></div>' +
      '<div><label class="po-lbl">Причина корректировки — обязательно</label>' +
      '<textarea class="input po-carry-reason" rows="2" placeholder="Например: зачли переплату по авансу, согласовано с ОВ"></textarea>' +
      '<div class="help muted mt-2" style="font-size:11.5px">Причина появится у рабочего в приложении, в табеле, в истории и в расчётном листе.</div></div>' +
      '<div class="po-actions">' +
        '<button class="btn ghost" data-pp-modal-close>Отмена</button>' +
        '<button class="btn gold" data-pp-carry-save="' + empId + '">Применить корректировку</button>' +
      '</div>' +
    '</div>';
  }

  // ═══════════════════════════════════════════════════════════════════════
  // КОРЗИНА: sticky bar + drawer
  // ═══════════════════════════════════════════════════════════════════════
  function cartBar() {
    if (!S.cart.length) return '';
    var t = cartTotals(S.cart);
    var seN = S.cart.filter(function (c) { return D.byId(c.employee_id).mode === 'se'; }).length;
    var ndN = S.cart.filter(function (c) { return D.byId(c.employee_id).mode === 'ndfl'; }).length;
    var cashN = S.cart.length - seN - ndN;
    return '<div class="pp-bar">' +
      '<div class="pp-bar__ic">🛒</div>' +
      '<div class="pp-bar__main"><div class="pp-bar__t">Корзина выплат · <b>' + S.cart.length + '</b> получателей</div>' +
        '<div class="pp-bar__s">' + cashN + ' нал · ' + seN + ' СЗ · ' + ndN + ' НДФЛ</div></div>' +
      '<div class="pp-bar__chips">' +
        (cashN ? '<span class="pp-tag pp-tag--cash">' + cashN + '</span>' : '') +
        (seN ? '<span class="pp-tag pp-tag--se">' + seN + '</span>' : '') +
        (ndN ? '<span class="pp-tag pp-tag--ndfl">' + ndN + '</span>' : '') + '</div>' +
      '<div class="pp-bar__sum">' + moneyRub(t.total) + '<small>всего к переводу</small></div>' +
      '<div class="pp-bar__actions"><button class="btn ghost sm" data-pp-cart-clear>Очистить</button>' +
        '<button class="btn gold" data-pp-cart-open>Открыть корзину</button></div>' +
    '</div>';
  }

  function cartTotals(items) {
    var t = { pay: 0, got: 0, total: 0, count: items.length };
    items.forEach(function (it) {
      var e = D.byId(it.employee_id); var c = calcItem(e, it.pay_amount);
      t.pay += it.pay_amount; t.got += c.gotAmount; t.total += c.totalAmount;
    });
    t.pay = D.r2(t.pay); t.got = D.r2(t.got); t.total = D.r2(t.total);
    return t;
  }

  function cartItem(it) {
    var e = D.byId(it.employee_id);
    var tag = modeLabel(e.mode);
    var c = calcItem(e, it.pay_amount);
    var st = rowState(e.id);
    var ps = D.payeesOf(e);
    var via = e.mode === 'se' ? (ps.length ? 'через ' + D.payeeShort(ps[0]) : 'на себя') : tag.d;
    var modeTag = st.status === 'approved'
      ? '<span class="badge success">к выплате</span>'
      : '<span class="badge warning">на согласование</span>';
    return '<div class="pp-it">' +
      '<div class="pp-it__top"><div class="pp-it__av">' + initials(e.fio) + '</div>' +
        '<div style="min-width:0"><div class="pp-it__name">' + esc(e.fio) + '</div>' +
        '<div class="pp-it__meta"><span class="pp-tag ' + tag.cls + '">' + tag.t + '</span> ' +
          (it.kind === 'advance' ? '· Аванс' : '· Зарплата') + ' · ' + esc(via) + '</div></div>' +
        '<button class="pp-it__del" data-pp-cart-del="' + e.id + '" title="Убрать">✕</button></div>' +
      '<div class="row" style="margin:8px 0 2px;gap:6px">' + modeTag +
        '<span class="pp-tag pp-tag--cash">ост. ' + money(D.r2(e.carryDebt - e.carryAdvance)) + '</span>' +
        '<span class="pp-tag pp-tag--se">нач. ' + money(e.accrued) + '</span>' +
        (e.mode === 'se' ? '<span class="pp-tag pp-tag--ndfl">лимит ' + money(e.se_left) + '</span>' : '') + '</div>' +
      '<div class="pp-it__grid">' +
        '<div class="pp-cell"><div class="pp-cell__l">К выплате</div><div class="pp-cell__v num">' + money(e.to_pay) + '</div></div>' +
        '<div class="pp-cell"><div class="pp-cell__l">Выплачиваем</div><div class="pp-cell__v num" style="color:var(--info-t)">' + money(it.pay_amount) + '</div></div>' +
        '<div class="pp-cell pp-cell--got"><div class="pp-cell__l">Человеку придёт</div><div class="pp-cell__v num">' + money(c.gotAmount) + '</div></div>' +
        '<div class="pp-cell pp-cell--total"><div class="pp-cell__l">Всего к переводу</div><div class="pp-cell__v num">' + money(c.totalAmount) + '</div></div>' +
      '</div>' +
      '<div class="pp-note">налог/сбор ' + money(c.taxAmount) + (it.comment ? ' · «' + esc(it.comment) + '»' : '') + '</div>' +
    '</div>';
  }

  /** Итоги по подмножеству позиций корзины. */
  function sumOf(items) {
    var t = { pay: 0, got: 0, total: 0, count: items.length };
    items.forEach(function (it) {
      var e = D.byId(it.employee_id); var c = calcItem(e, it.pay_amount);
      t.pay += it.pay_amount; t.got += c.gotAmount; t.total += c.totalAmount;
    });
    t.pay = D.r2(t.pay); t.got = D.r2(t.got); t.total = D.r2(t.total);
    return t;
  }

  function cartDrawer() {
    var t = cartTotals(S.cart);
    var toApprove = S.cart.filter(function (it) { var s = rowState(it.employee_id); return s.status !== 'approved'; });
    var toPay = S.cart.filter(function (it) { var s = rowState(it.employee_id); return s.status === 'approved'; });
    var tA = sumOf(toApprove), tP = sumOf(toPay);

    var totalsBlock = '<div class="pp-tot">' +
      '<div class="pp-tot__row"><span>Выплачиваем (в счёт начисленного)</span><b>' + moneyRub(t.pay) + '</b></div>' +
      '<div class="pp-tot__row"><span>Получат работники</span><b>' + moneyRub(t.got) + '</b></div>' +
      '<div class="pp-tot__row"><span>Налоги и сбор площадки</span><b>' + moneyRub(D.r2(t.total - t.got)) + '</b></div>' +
      '<div class="pp-tot__row pp-tot__row--big"><span>Всего к переводу</span><b>' + moneyRub(t.total) + '</b></div>' +
    '</div>';

    var body = '';
    if (!S.cart.length) {
      body = '<div class="empty-state"><div class="icon">🛒</div><div class="title">Корзина пуста</div><div class="mt-2">Отметьте выплаты галочкой слева от ФИО</div></div>';
    } else {
      if (toApprove.length) {
        body += '<div class="pp-group-h"><span>На согласование ОВ · ' + toApprove.length + ' · ' + moneyRub(tA.total) + '</span></div>' +
          toApprove.map(cartItem).join('');
      }
      if (toPay.length) {
        body += '<div class="pp-group-h"><span>Согласовано — к выплате · ' + toPay.length + ' · ' + moneyRub(tP.total) + '</span></div>' +
          toPay.map(cartItem).join('');
      }
      body += totalsBlock;
      body += '<div class="pp-wa-mini"><div class="pp-wa-mini__t">Что увидит рабочий в приложении</div>' +
        '<div class="po-wa-row"><span>Переведено рабочему</span><b class="po-ok">' + moneyRub(t.got) + '</b></div>' +
        '<div class="po-wa-row"><span>Получат</span><b>' + t.count + ' чел.</b></div>' +
        '<div class="po-wa-note">Каждый получит уведомление и подтвердит получение кодом.</div></div>';
    }

    var footActions = '';
    if (toApprove.length && toPay.length) {
      footActions = '<button class="btn ghost" data-pp-cart-submit="approve" style="flex:1">На согласование (' + toApprove.length + ')</button>' +
        '<button class="btn ok" data-pp-cart-submit="pay" style="flex:1">Выплатить согласованных (' + toPay.length + ')</button>';
    } else if (toApprove.length) {
      footActions = '<button class="btn gold" data-pp-cart-submit="approve" style="flex:1">Отправить на согласование (' + toApprove.length + ')</button>';
    } else {
      footActions = '<button class="btn ok" data-pp-cart-submit="pay" style="flex:1">Выплатить пачкой (' + toPay.length + ')</button>';
    }

    return '<div class="pp-ov" data-pp-cart-close></div>' +
      '<aside class="pp-dr">' +
        '<div class="pp-dr__hd"><div><div class="pp-dr__title">Корзина выплат</div>' +
          '<div class="pp-dr__sub">' + t.count + ' получателей · за ' + D.MONTHS[D.PERIOD.month - 1] + ' ' + D.PERIOD.year + '</div></div>' +
          '<button class="pp-dr__x" data-pp-cart-close>✕</button></div>' +
        '<div class="pp-dr__body">' + body + '</div>' +
        '<div class="pp-dr__foot">' +
          '<div class="row mb-3" style="justify-content:space-between"><span class="dim">Итого к переводу</span><b style="font-size:20px;font-weight:900" class="num">' + moneyRub(t.total) + '</b></div>' +
          '<div class="row mt-3" style="gap:8px">' +
            '<button class="btn ghost" data-pp-cart-clear style="flex:0 0 auto">Очистить</button>' +
            footActions +
          '</div>' +
          '<div class="dim mt-2" style="font-size:11.5px;text-align:center">Неодобренные уйдут на согласование, одобренные — сразу к выплате</div>' +
        '</div>' +
      '</aside>';
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ЭКРАН 2. Единый экран согласований ОВ
  // ═══════════════════════════════════════════════════════════════════════
  function approvalScreen() {
    var tab = S.ovTab;
    var cashN = D.CASH_REQUESTS.filter(function (r) { return r.status === 'requested'; }).length;
    var invN = D.INVOICES.length;
    var payN = S.batch ? 1 : 0;

    // «Планирование» живёт внутри этой же страницы согласований — 4-я вкладка
    var tabs = '<div class="ap-tabs">' +
      tabBtn('cash', '💵 Касса', cashN) +
      tabBtn('invoices', '📄 Счета', invN) +
      tabBtn('payouts', '💰 Выплаты', payN) +
      tabBtn('plan', '📋 Планирование на 1-е', 0) +
    '</div>' +
    '<div class="ap-toolbar" style="justify-content:flex-end;margin-top:-8px">' +
      '<button class="btn ghost sm" data-pp-chart-open>📊 График платежей</button></div>';

    var body = tab === 'cash' ? cashTab()
      : tab === 'invoices' ? invoicesTab()
      : tab === 'plan' ? planScreen(true)
      : payoutsTab();
    return tabs + body;
  }
  function tabBtn(id, label, n) {
    return '<button class="ap-tab ' + (S.ovTab === id ? 'is-on' : '') + '" data-pp-ovtab="' + id + '">' + label +
      '<span class="ap-tab__n ' + (n ? '' : 'ap-tab__n--zero') + '">' + n + '</span></button>';
  }

  function cashTab() {
    var list = D.CASH_REQUESTS.map(function (r) {
      var sum = D.r2(r.amount);
      return '<div class="ap-card ' + (r.status === 'requested' ? '' : '') + '" data-apcard="c' + r.id + '">' +
        '<div class="ap-card__hd"><div class="ap-card__kind ap-card__kind--cash">💵</div>' +
          '<div><div class="ap-card__t">Заявка на наличные · #' + r.id + '</div>' +
          '<div class="ap-card__s">' + esc(r.requester) + ' · ' + esc(r.role) + ' · ' + esc(r.work) + ' · ' + esc(r.created) + '</div></div>' +
          '<div class="ap-card__sum">' + moneyRub(sum) + '<small>из кассы</small></div>' +
          '<span class="ap-card__chev">▸</span></div>' +
        '<div class="ap-card__body">' +
          '<div class="ap-note">Назначение: ' + esc(r.purpose) + '</div>' +
          '<div class="ap-line"><div><div class="ap-line__nm">Остаток в кассе после выдачи</div><div class="ap-line__mt">проверка достаточности</div></div><div class="ap-line__v">' + moneyRub(412000 - sum) + '</div></div>' +
          '<div class="ap-acts">' +
            '<button class="btn ok sm" data-pp-ov-approve="cash:' + r.id + '">Согласовать</button>' +
            '<button class="btn ghost sm">Вопрос</button>' +
            '<button class="btn danger sm" data-pp-ov-reject="cash:' + r.id + '">Отклонить</button>' +
            '<span class="dim" style="margin-left:auto;font-size:12px">→ далее в бухгалтерию на выдачу</span>' +
          '</div>' +
        '</div></div>';
    }).join('');
    return hero('💵', 'Заявки на наличные из кассы', 'Касса · ' + D.CASH_REQUESTS.filter(function (r) { return r.status === 'requested'; }).length + ' ждут решения', D.r2(D.CASH_REQUESTS.reduce(function (s, r) { return s + r.amount; }, 0)), 'всего запрошено') +
      '<div class="ap-toolbar"><button class="btn ok sm" data-pp-ov-approve-all="cash">Согласовать всех</button>' +
      '<span class="dim">После согласования заявка уходит в бухгалтерию на выдачу</span></div>' + list;
  }

  function invoicesTab() {
    var list = D.INVOICES.map(function (r) {
      return '<div class="ap-card" data-apcard="i' + r.id + '">' +
        '<div class="ap-card__hd"><div class="ap-card__kind ap-card__kind--invoice">📄</div>' +
          '<div><div class="ap-card__t">' + esc(r.supplier) + '</div>' +
          '<div class="ap-card__s">Счёт ' + esc(r.number) + ' · НДС ' + esc(r.vat) + ' · оплатить до ' + esc(r.due) + ' · ' + esc(r.created) + '</div></div>' +
          '<div class="ap-card__sum">' + moneyRub(r.amount) + '<small>к оплате</small></div>' +
          '<span class="ap-card__chev">▸</span></div>' +
        '<div class="ap-card__body">' +
          '<div class="ap-note">Основание: ' + esc(r.basis) + '</div>' +
          '<div class="ap-acts"><button class="btn ok sm" data-pp-ov-approve="inv:' + r.id + '">Согласовать</button>' +
            '<button class="btn ghost sm">Позже</button>' +
            '<button class="btn danger sm" data-pp-ov-reject="inv:' + r.id + '">Отклонить</button>' +
            '<span class="dim" style="margin-left:auto;font-size:12px">→ в бухгалтерию + реестр счетов</span></div>' +
        '</div></div>';
    }).join('');
    return hero('📄', 'Счета на оплату', 'После согласования идут в бухгалтерию и реестр счетов', D.r2(D.INVOICES.reduce(function (s, r) { return s + r.amount; }, 0)), 'всего к оплате') +
      '<div class="ap-toolbar"><button class="btn ok sm" data-pp-ov-approve-all="inv">Согласовать всех</button></div>' + list;
  }

  // ── Вкладка выплат: пачка от Димы + прогресс + решения ──────────────────
  function payoutsTab() {
    if (!S.batch) {
      return hero('💰', 'Выплаты рабочим', 'Пачек на согласовании нет', 0, 'ожидают решения') +
        '<div class="empty-state"><div class="icon">✓</div><div class="title">Всё согласовано</div><div class="mt-2">Дима Путков ещё не отправлял новую корзину</div></div>';
    }
    var b = S.batch;
    var t = D.batchTotals(b);
    var decided = b.items.filter(function (i) { return i.approval_status === 'approved' || i.approval_status === 'rejected'; }).length;
    var approved = b.items.filter(function (i) { return i.approval_status === 'approved'; }).length;
    var rejected = b.items.filter(function (i) { return i.approval_status === 'rejected'; }).length;
    var pct = Math.round(decided / b.items.length * 100);

    var lines = b.items.map(function (it) {
      var e = D.byId(it.employee_id); var tag = modeLabel(e.mode); var c = calcItem(e, it.pay_amount);
      var st = it.approval_status || 'pending';
      var badge = st === 'approved' ? '<span class="badge success">согласовано</span>'
        : st === 'rejected' ? '<span class="badge danger">возврат</span>'
        : '<span class="badge warning">ждёт согласования ОВ</span>';
      var acts = st === 'pending'
        ? '<button class="btn ok xs" data-pp-item-approve="' + e.id + '">Одобрить</button><button class="btn danger xs" data-pp-item-reject="' + e.id + '">Вернуть</button>'
        : '';
      var payees = D.payeesOf(e);
      var via = '';
      if (e.mode === 'se' && payees.length) via = 'через получателя: <b>' + esc(D.payeeShort(payees[0])) + '</b>';
      else if (e.mode === 'se') via = 'на самого рабочего';
      else if (e.mode === 'ndfl') via = 'перевод на счёт (НДФЛ)';
      else if (e.mode === 'official') via = 'оклад через бухгалтерию';
      else via = 'наличными из кассы';
      return '<div class="ap-line ap-line--rich">' +
        '<div class="pp-it__av" style="width:30px;height:30px;font-size:11px">' + initials(e.fio) + '</div>' +
        '<div class="ap-line__who"><div class="ap-line__nm">' + esc(e.fio) + '</div>' +
          '<div class="ap-line__mt"><span class="pp-tag ' + tag.cls + '">' + tag.t + '</span> · ' + (it.kind === 'advance' ? 'Аванс' : 'Зарплата') +
          ' · ' + via + (it.comment ? ' · «' + esc(it.comment) + '»' : '') + '</div></div>' +
        '<div class="ap-line__nums">' +
          '<span title="Остаток с прошлых">ост. <b>' + money(D.r2(e.carryDebt - e.carryAdvance)) + '</b></span>' +
          '<span title="Начислено за месяц">нач. <b>' + money(e.accrued) + '</b></span>' +
          '<span title="Всё к выплате">к выпл. <b>' + money(e.to_pay) + '</b></span>' +
          '<span title="Выплачиваем сейчас">выплач. <b style="color:var(--info-t)">' + money(it.pay_amount) + '</b></span>' +
          (e.mode === 'se' ? '<span title="Остаток месячного лимита НПД">лимит <b style="color:var(--gold)">' + money(e.se_left) + '</b></span>' : '') +
        '</div>' +
        '<div class="ap-line__res"><span class="ap-line__res-l">человеку</span><b class="num" style="color:var(--ok-t)">' + money(c.gotAmount) + '</b>' +
          '<span class="ap-line__res-l">всего переводим</span><b class="num" style="color:var(--gold)">' + money(c.totalAmount) + '</b></div>' +
        '<div class="ap-line__act">' + badge + acts + '</div>' +
      '</div>';
    }).join('');

    return hero('💰', 'Корзина выплат от Дмитрия Путкова', 'Ждёт согласования ОВ (Олег Викторович) · отправлено ' + esc(b.submitted_at) + ' · за ' + D.MONTHS[D.PERIOD.month - 1], t.total, 'всего к переводу') +
      '<div class="ap-card is-open">' +
        '<div class="ap-card__hd"><div class="ap-card__kind ap-card__kind--payout">🛒</div>' +
          '<div><div class="ap-card__t">Пачка ' + esc(b.id) + ' · ' + b.items.length + ' получателей</div>' +
          '<div class="ap-card__s">' + approved + ' согласовано · ' + rejected + ' возврат · ' + (b.items.length - decided) + ' ждут</div></div>' +
          '<div class="ap-card__sum">' + moneyRub(t.total) + '<small>к переводу</small></div></div>' +
        '<div class="ap-card__body">' +
          '<div class="ap-prog mb-4"><div class="ap-prog__bar"><div class="ap-prog__fill" style="width:' + pct + '%"></div></div>' +
            '<div class="ap-prog__t">' + decided + '/' + b.items.length + ' решено</div></div>' +
          '<div class="stat-strip mb-4">' +
            '<div class="stat-strip__i"><span class="stat-strip__v num">' + money(t.pay) + '</span><span class="stat-strip__l">выплачиваем</span></div>' +
            '<div class="stat-strip__sep"></div>' +
            '<div class="stat-strip__i"><span class="stat-strip__v num" style="color:var(--ok-t)">' + money(t.got) + '</span><span class="stat-strip__l">получат работники</span></div>' +
            '<div class="stat-strip__sep"></div>' +
            '<div class="stat-strip__i"><span class="stat-strip__v num" style="color:var(--gold)">' + money(D.r2(t.total - t.pay)) + '</span><span class="stat-strip__l">налоги и сбор</span></div>' +
            '<div class="stat-strip__sep"></div>' +
            '<div class="stat-strip__i"><span class="stat-strip__v num" style="color:var(--gold);font-weight:900">' + money(t.total) + '</span><span class="stat-strip__l">всего к переводу</span></div>' +
          '</div>' +
          '<div class="ap-note ap-note--gold mb-4">Примечание Димы: «Проверил лимиты СЗ по каждому, остатки августа зачёл. Петрушенко согласовал аванс 50%».</div>' +
          lines +
          '<div class="ap-acts mt-4">' +
            '<button class="btn ok" data-pp-ov-approve-batch>Утвердить пачку целиком</button>' +
            '<button class="btn ghost" data-pp-ov-approve-all="batch">Согласовать всех поштучно</button>' +
            '<button class="btn ghost" data-pp-withdraw>Отозвать у согласующего</button>' +
            '<button class="btn danger" data-pp-ov-reject-batch>Вернуть всю пачку</button>' +
          '</div>' +
        '</div></div>';
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ЭКРАН 3. Планирование выплат (ОВ, 1-е число) + график платежей
  // ═══════════════════════════════════════════════════════════════════════
  function planScreen(embedded) {
    var P = D.PLAN, t = D.planTotals();
    var rows = P.items.map(function (p, i) {
      var e = D.byId(p.employee_id); if (!e) return '';
      var tag = modeLabel(e.mode);
      var ps = D.payeesOf(e);
      var via = e.mode === 'se'
        ? (ps.length ? 'получатель: ' + esc(D.payeeShort(ps[0])) : 'на себя')
        : (e.mode === 'ndfl' ? 'счёт физлица' : (e.mode === 'official' ? 'оклад через бух.' : 'касса'));
      var limitCell = e.mode === 'se'
        ? '<div class="pl-lim"><div class="pl-lim__bar"><i style="width:' + Math.round(Math.min(100, e.se_used / e.se_limit * 100)) + '%"></i></div>' +
          '<span class="pl-lim__t">' + money(e.se_left) + ' свободно из ' + money(e.se_limit) + '</span></div>'
        : '<span class="dim" style="font-size:11.5px">без лимита НПД</span>';
      // налог/сбор для строки: СЗ — сбор площадки + НДС, НДФЛ — 15%, наличка — нет
      var tax = calcItem(e, e.to_pay);
      var taxCell = '<span class="num">' + money(tax.taxAmount) + '</span>' +
        (e.mode === 'se' ? '<div class="pl-max">сбор+НДС</div>' : e.mode === 'ndfl' ? '<div class="pl-max">+15%</div>' : '<div class="pl-max">1:1</div>');
      var gotCell = '<span class="num" style="color:var(--ok-t)">' + money(tax.gotAmount) + '</span>';
      var ovCmt = (S.planComments && S.planComments[e.id]) || p.comment || '';
      return '<tr class="' + (p.approved ? 'pl-row-on' : '') + '">' +
        '<td class="po-chkcell"><span class="po-chk ' + (p.approved ? 'is-on' : '') + '" data-pp-plan-chk="' + e.id + '"></span></td>' +
        '<td><div class="po-fio__name">' + esc(e.fio) + '</div>' +
          '<div class="po-fio__badges mt-2"><span class="pp-tag ' + tag.cls + '">' + tag.t + '</span><span class="dim" style="font-size:11px">' + via + '</span></div></td>' +
        '<td>' + limitCell + '</td>' +
        '<td class="right num">' + money(e.to_pay) + '</td>' +
        '<td class="right">' + taxCell + '</td>' +
        '<td class="right">' +
          '<input class="input pl-amount num" type="number" step="1000" min="0" max="' + p.max_amount + '" value="' + p.to_transfer + '" data-pp-plan-amt="' + e.id + '" placeholder="0">' +
          '<div class="pl-max">макс. ' + money(p.max_amount) + '</div>' +
        '</td>' +
        '<td class="right">' + gotCell + '</td>' +
        '<td class="right"><input class="input pl-date" type="date" value="' + (p.pay_date_iso || '2026-11-05') + '" data-pp-plan-date="' + e.id + '"></td>' +
        '<td><input class="input pl-cmt" placeholder="комментарий" value="' + esc(ovCmt) + '" data-pp-plan-cmt="' + e.id + '"></td>' +
        '<td class="right">' +
          (p.approved
            ? '<span class="badge success">согласовано</span> <button class="btn ghost xs" data-pp-plan-unset="' + e.id + '">Снять</button>'
            : '<button class="btn ok xs" data-pp-plan-set="' + e.id + '">Согласовать</button>') +
        '</td>' +
      '</tr>';
    }).join('');

    var pct = t.total ? Math.round(t.approvedSum / t.total * 100) : 0;
    var head = embedded ? '' :
      '<div class="po-head"><div><div class="po-head-title">Планирование выплат · ' + D.MONTHS[P.month.month - 1] + ' ' + P.month.year + '</div>' +
        '<div class="po-head-sub">1-е число · табель закрыт. Олег Викторович распределяет суммы и даты, затем согласует.</div></div>' +
        '<div class="po-head-actions"><button class="btn ghost sm" data-pp-chart-open>📊 График платежей</button></div></div>';
    return head +

      '<div class="pl-dash">' +
        '<div class="pl-dash__i"><span class="pl-dash__l">К выплате всего</span><b class="num">' + moneyRub(t.total) + '</b>' +
          '<span class="pl-dash__c">СЗ ' + money(t.byCat.se) + ' · нал ' + money(t.byCat.cash) + ' · НДФЛ ' + money(t.byCat.ndfl) + '</span></div>' +
        '<div class="pl-dash__i pl-dash__i--ok"><span class="pl-dash__l">Согласовано</span><b class="num">' + moneyRub(t.approvedSum) + '</b>' +
          '<div class="ap-prog mt-2"><div class="ap-prog__bar"><div class="ap-prog__fill" style="width:' + pct + '%"></div></div>' +
          '<div class="ap-prog__t">' + t.approved + '/' + t.count + '</div></div></div>' +
      '</div>' +

      '<div class="pl-bulk">' +
        '<div class="pl-bulk__t">Применить ко всем</div>' +
        '<div class="pl-bulk__row">' +
          '<label class="pl-bulk__f"><span class="po-lbl">Дата перевода</span><input class="input" type="date" value="2026-11-05" id="pl_bulk_date"></label>' +
          '<label class="pl-bulk__f"><span class="po-lbl">Сумма</span>' +
            '<select class="input" id="pl_bulk_mode">' +
              '<option value="max">по максимуму (СЗ — до лимита, наличка/НДФЛ — весь долг)</option>' +
              '<option value="debt">вся сумма к выплате</option>' +
              '<option value="half">половина</option>' +
            '</select></label>' +
          '<button class="btn primary" data-pp-plan-apply-all>Применить ко всем</button>' +
          '<button class="btn gold" data-pp-plan-approve-all>Согласовать всех заполненных</button>' +
        '</div>' +
      '</div>' +

      '<div class="tablewrap"><table class="asg po-table pl-table"><thead><tr>' +
        '<th class="po-chkcell"></th><th>ФИО · способ · через кого</th><th>Лимит НПД (месяц)</th>' +
        '<th class="right">К выплате</th><th class="right">Налог / сбор</th>' +
        '<th class="right">Сумма к переводу</th><th class="right">Человеку придёт</th>' +
        '<th class="right">Дата перевода</th><th>Комментарий ОВ</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +

      '<div class="dim mt-3" style="font-size:11.5px">После согласования выплаты попадают Диме Путкову в корзину — он нажимает «Выплатить». Дата перевода — не раньше указанной. СЗ: рабочему ×1.064, всего к переводу ×(1.064/0.96)×1.22 (НДС 22% + сбор площадки). НДФЛ: +15%.</div>';
  }

  // ── График платежей: столбцы по дням, 3 категории, листание месяцев ────
  function chartScreen() {
    // Кнопка «назад» ведёт на вкладку «Планирование» внутри экрана согласований
    var ym = S.chartYM || { year: D.PLAN.month.year, month: D.PLAN.month.month };
    var days = D.chartFor(ym.year, ym.month);
    var max = 1;
    days.forEach(function (d) { max = Math.max(max, d.se + d.cash + d.ndfl); });
    var totalSe = 0, totalCash = 0, totalNdfl = 0;
    days.forEach(function (d) { totalSe += d.se; totalCash += d.cash; totalNdfl += d.ndfl; });
    var grand = D.r2(totalSe + totalCash + totalNdfl);

    var bars = days.map(function (d) {
      var sum = d.se + d.cash + d.ndfl;
      var empty = !sum;
      var hasSe = d.se > 0, hasCash = d.cash > 0, hasNdfl = d.ndfl > 0;
      var types = (hasSe ? 1 : 0) + (hasCash ? 1 : 0) + (hasNdfl ? 1 : 0);
      function h(v) { return Math.max(3, Math.round(v / max * 210)); }
      var names = D.payeesForDay(d.day).map(function (e) { return e.fio.split(' ')[0]; });
      // Показываем ВСЕ дни месяца — плотный график, а не растянутый на 13 столбцов.
      if (empty) {
        return '<div class="pc-col pc-col--empty">' +
          '<div class="pc-col__nums"></div>' +
          '<div class="pc-col__trio"></div>' +
          '<div class="pc-col__total dim">—</div>' +
          '<div class="pc-col__day">' + d.day + '</div>' +
        '</div>';
      }
      return '<div class="pc-col" data-pp-chart-col="' + d.day + '" title="' + d.day + '. — всего ' + money(sum) + ' ₽\nСЗ ' + money(d.se) + ' · нал ' + money(d.cash) + ' · НДФЛ ' + money(d.ndfl) + (names.length ? '\n' + names.join(', ') : '') + '">' +
        '<div class="pc-col__nums">' +
          (hasSe ? '<span class="pc-n pc-n--se">' + moneyShort(d.se) + '</span>' : '') +
          (hasCash ? '<span class="pc-n pc-n--cash">' + moneyShort(d.cash) + '</span>' : '') +
          (hasNdfl ? '<span class="pc-n pc-n--ndfl">' + moneyShort(d.ndfl) + '</span>' : '') +
        '</div>' +
        '<div class="pc-col__trio">' +
          (hasSe ? '<div class="pc-col__bar" style="height:' + h(d.se) + 'px"><i class="pc-se"></i></div>' : '') +
          (hasCash ? '<div class="pc-col__bar" style="height:' + h(d.cash) + 'px"><i class="pc-cash"></i></div>' : '') +
          (hasNdfl ? '<div class="pc-col__bar" style="height:' + h(d.ndfl) + 'px"><i class="pc-ndfl"></i></div>' : '') +
        '</div>' +
        '<div class="pc-col__total num">' + moneyShort(sum) + '</div>' +
        '<div class="pc-col__day ' + (types === 3 ? 'pc-day-3' : types === 2 ? 'pc-day-2' : 'pc-day-1') + '">' + d.day + '</div>' +
      '</div>';
    }).join('');

    return '' +
      '<div class="po-head"><div><div class="po-head-title">График платежей</div>' +
        '<div class="po-head-sub">Сколько денег нужно в каждый день. Кликните по столбцу — покажет, кому платим.</div></div>' +
        '<div class="po-head-actions"><button class="btn ghost sm" data-pp-chart-back>← Планирование</button></div></div>' +

      '<div class="pc-nav">' +
        '<button class="btn ghost sm" data-pp-chart-prev>‹ Пред.</button>' +
        '<div class="pc-nav__m">' + D.MONTHS[ym.month - 1] + ' ' + ym.year + '</div>' +
        '<button class="btn ghost sm" data-pp-chart-next>След. ›</button>' +
      '</div>' +

      '<div class="pc-legend"><span class="pc-lg"><i class="pc-se"></i>Самозанятые (ReStaff)</span>' +
        '<span class="pc-lg"><i class="pc-cash"></i>Наличные (касса)</span>' +
        '<span class="pc-lg"><i class="pc-ndfl"></i>Перевод с НДФЛ (+15%)</span></div>' +

      '<div class="pc-chart"><div class="pc-chart__grid">' +
        '<div class="pc-y"><span>' + moneyShort(max) + '</span><span>' + moneyShort(max * 0.5) + '</span><span>0</span></div>' +
        '<div class="pc-bars">' + (bars || '<div class="empty-state" style="padding:40px"><div class="title">Нет выплат в этом месяце</div></div>') + '</div>' +
      '</div></div>' +

      '<div class="pc-facts">' +
        '<div class="pc-fact"><i class="pc-se"></i><span>СЗ</span><b class="num">' + moneyRub(totalSe) + '</b></div>' +
        '<div class="pc-fact"><i class="pc-cash"></i><span>Наличные</span><b class="num">' + moneyRub(totalCash) + '</b></div>' +
        '<div class="pc-fact"><i class="pc-ndfl"></i><span>НДФЛ</span><b class="num">' + moneyRub(totalNdfl) + '</b></div>' +
        '<div class="pc-fact pc-fact--all"><span>Всего за месяц</span><b class="num">' + moneyRub(grand) + '</b></div>' +
      '</div>';
  }
  function moneyShort(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'М';
    if (v >= 1e3) return Math.round(v / 1e3) + 'К';
    return String(Math.round(v));
  }

  // ── Модалка «кому платим в этот день» (клик по столбцу графика) ────────
  function chartDayModal(day) {
    var ym = S.chartYM || { year: D.PLAN.month.year, month: D.PLAN.month.month };
    var days = D.chartFor(ym.year, ym.month);
    var d = null;
    for (var i = 0; i < days.length; i++) if (days[i].day === day) { d = days[i]; break; }
    if (!d) return '<div class="po-modal">Нет данных</div>';
    var emps = D.payeesForDay(day);
    var rows = emps.map(function (e) {
      var tag = modeLabel(e.mode);
      var c = calcItem(e, e.to_pay);
      return '<div class="cd-line">' +
        '<div class="pp-it__av" style="width:28px;height:28px;font-size:11px">' + initials(e.fio) + '</div>' +
        '<div><div class="cd-name">' + esc(e.fio) + '</div>' +
          '<div class="cd-sub"><span class="pp-tag ' + tag.cls + '">' + tag.t + '</span> ' + esc(tag.d) + '</div></div>' +
        '<div class="cd-sum"><span class="num">' + moneyRub(e.to_pay) + '</span>' +
          '<small>придёт ' + money(c.gotAmount) + ' · переводим ' + money(c.totalAmount) + '</small></div>' +
      '</div>';
    }).join('');
    var sum = d.se + d.cash + d.ndfl;
    return '<div class="po-modal">' +
      '<div class="cd-head">' +
        '<div><div class="cd-head__d">' + day + ' ' + D.MONTHS[ym.month - 1] + ' ' + ym.year + '</div>' +
        '<div class="cd-head__s">' + emps.length + ' получателей · всего ' + moneyRub(sum) + '</div></div>' +
        '<div class="cd-head__cats">' +
          (d.se ? '<span class="cd-cat cd-cat--se">СЗ ' + moneyRub(d.se) + '</span>' : '') +
          (d.cash ? '<span class="cd-cat cd-cat--cash">Нал ' + moneyRub(d.cash) + '</span>' : '') +
          (d.ndfl ? '<span class="cd-cat cd-cat--ndfl">НДФЛ ' + moneyRub(d.ndfl) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="cd-list">' + (rows || '<div class="dim">В этот день выплат нет</div>') + '</div>' +
    '</div>';
  }

  function hero(ic, t, s, sum, sumLbl) {    return '<div class="ap-hero"><div class="ap-hero__ic">' + ic + '</div>' +
      '<div><div class="ap-hero__t">' + esc(t) + '</div><div class="ap-hero__s">' + esc(s) + '</div></div>' +
      '<div class="ap-hero__sum"><b class="num">' + moneyRub(sum) + '</b><small>' + esc(sumLbl) + '</small></div></div>';
  }

  // ═══════════════════════════════════════════════════════════════════════
  // МОБИЛЬНЫЕ ЭКРАНЫ
  // ═══════════════════════════════════════════════════════════════════════
  function mPhone(inner, label) {
    return '<div><div class="phone"><div class="phone__screen">' +
      '<div class="phone__notch"><i></i></div>' +
      '<div class="phone__status"><span>9:41</span><span class="sp"></span><span>5G &#9679;&#9679;&#9679;</span></div>' +
      inner + '</div></div><div class="phone__label">' + esc(label) + '</div></div>';
  }

  function mApprovals() {
    var b = S.batch;
    var t = b ? D.batchTotals(b) : { total: 0, got: 0 };
    var body = '';
    if (S.ovTab === 'payouts') {
      body = b ? ('<div class="m-hero"><small>К переводу · ' + b.items.length + ' чел.</small><b class="num">' + moneyRub(t.total) + '</b>' +
        '<div class="m-card__row mt-2"><span>Получат работники</span><b class="num" style="color:var(--ok-t)">' + moneyRub(t.got) + '</b></div></div>' +
        b.items.map(function (it) {
          var e = D.byId(it.employee_id); var c = calcItem(e, it.pay_amount); var tag = modeLabel(e.mode);
          var st = it.approval_status || 'pending';
          var badge = st === 'approved' ? '<span class="badge success">согласовано</span>'
            : st === 'rejected' ? '<span class="badge danger">возврат</span>'
            : '<span class="badge warning">ждёт согласования ОВ</span>';
          var acts = st === 'pending'
            ? '<div class="m-card__acts"><button class="btn ok sm" data-pp-item-approve="' + e.id + '">Согласовать</button>' +
              '<button class="btn ghost sm" data-pp-item-reject="' + e.id + '">Вернуть</button></div>'
            : '';
          var ps2 = D.payeesOf(e);
          var via2 = e.mode === 'se' ? (ps2.length ? 'через ' + D.payeeShort(ps2[0]) : 'на себя') : tag.d;
          var taxPct = e.mode === 'se' ? 'сбор+НДС 22%' : (e.mode === 'ndfl' ? '+15% НДФЛ' : '1:1');
          return '<div class="m-card"><div class="m-card__top"><div class="m-card__ic">' + initials(e.fio) + '</div>' +
            '<div><div class="m-card__t">' + esc(e.fio.split(' ')[0]) + ' ' + esc(e.fio.split(' ')[1]) + '</div>' +
            '<div class="m-card__s"><span class="pp-tag ' + tag.cls + '">' + tag.t + '</span> ' + (it.kind === 'advance' ? 'Аванс' : 'Зарплата') + ' · ' + esc(via2) + '</div></div>' +
            '<div class="m-card__sum num">' + money(it.pay_amount) + '</div></div>' +
            '<div class="m-card__row"><span>Остаток</span><b class="num">' + moneyRub(D.r2(e.carryDebt - e.carryAdvance)) + '</b></div>' +
            '<div class="m-card__row"><span>Начислено</span><b class="num">' + moneyRub(e.accrued) + '</b></div>' +
            '<div class="m-card__row"><span>Выплачиваем</span><b class="num">' + moneyRub(it.pay_amount) + '</b></div>' +
            '<div class="m-card__row"><span>Налог/сбор <span class="dim">(' + taxPct + ')</span></span><b class="num">' + moneyRub(c.taxAmount) + '</b></div>' +
            '<div class="m-card__row"><span>Всего к переводу</span><b class="num" style="color:var(--gold)">' + moneyRub(c.totalAmount) + '</b></div>' +
            '<div class="m-card__row"><span>Человеку придёт</span><b class="num" style="color:var(--ok-t)">' + moneyRub(c.gotAmount) + '</b></div>' +
            (e.mode === 'se' ? '<div class="m-card__row"><span>Лимит НПД свободно</span><b class="num">' + moneyRub(e.se_left) + '</b></div>' : '') +
            '<div class="row mt-2" style="justify-content:space-between">' + badge + '</div>' + acts +
            (it.comment ? '<div class="m-swipe">«' + esc(it.comment) + '» — Дима</div>' : '') + '</div>';
        }).join('') +
        '<button class="btn ok" style="width:100%;margin-top:6px" data-pp-ov-approve-batch>Согласовать всех (' + b.items.length + ')</button>' +
        '<button class="btn danger" style="width:100%;margin-top:6px" data-pp-ov-reject-batch>Вернуть всю пачку</button>')
        : '<div class="empty-state"><div class="icon">✓</div><div class="title">Всё согласовано</div></div>';
    } else if (S.ovTab === 'cash') {
      body = D.CASH_REQUESTS.map(function (r) {
        return '<div class="m-card"><div class="m-card__top"><div class="m-card__ic">💵</div>' +
          '<div><div class="m-card__t">' + esc(r.requester) + '</div><div class="m-card__s">' + esc(r.work) + '</div></div>' +
          '<div class="m-card__sum num">' + money(r.amount) + '</div></div>' +
          '<div class="m-card__row"><b>' + esc(r.purpose) + '</b></div>' +
          '<div class="m-card__acts"><button class="btn ok sm" data-pp-ov-approve="cash:' + r.id + '">Согласовать</button>' +
          '<button class="btn ghost sm" data-pp-ov-reject="cash:' + r.id + '">Вернуть</button></div>' +
          '<div class="m-swipe">← потяни: вернуть</div></div>';
      }).join('') +
      '<button class="btn ok" style="width:100%;margin-top:6px" data-pp-ov-approve-all="cash">Согласовать всех</button>';
    } else {
      body = D.INVOICES.map(function (r) {
        return '<div class="m-card"><div class="m-card__top"><div class="m-card__ic">📄</div>' +
          '<div><div class="m-card__t">' + esc(r.supplier) + '</div><div class="m-card__s">до ' + esc(r.due) + '</div></div>' +
          '<div class="m-card__sum num">' + money(r.amount) + '</div></div>' +
          '<div class="m-card__acts"><button class="btn ok sm" data-pp-ov-approve="inv:' + r.id + '">Согласовать</button>' +
          '<button class="btn ghost sm" data-pp-ov-reject="inv:' + r.id + '">Позже</button></div></div>';
      }).join('') +
      '<button class="btn ok" style="width:100%;margin-top:6px" data-pp-ov-approve-all="inv">Согласовать всех</button>';
    }

    var inner = '<div class="m-app">' +
      '<div class="m-head"><div><div class="m-head__t">Согласования</div><div class="m-head__s">ОВ · Олег Викторович</div></div>' +
        '<span class="sp" style="flex:1"></span><span class="badge gold">' + (D.CASH_REQUESTS.length + D.INVOICES.length + (b ? 1 : 0)) + '</span></div>' +
      '<div class="m-tabs">' +
        '<button class="m-tab ' + (S.ovTab === 'cash' ? 'is-on' : '') + '" data-pp-ovtab="cash">Касса <b>' + D.CASH_REQUESTS.length + '</b></button>' +
        '<button class="m-tab ' + (S.ovTab === 'invoices' ? 'is-on' : '') + '" data-pp-ovtab="invoices">Счета <b>' + D.INVOICES.length + '</b></button>' +
        '<button class="m-tab ' + (S.ovTab === 'payouts' ? 'is-on' : '') + '" data-pp-ovtab="payouts">Выплаты <b>' + (b ? 1 : 0) + '</b></button>' +
      '</div>' +
      '<div class="m-body">' + body + '</div>' +
      '<div class="m-tabbar"><button class="is-on"><em>✓</em>Согласования</button><button><em>📊</em>Сводка</button><button><em>👤</em>Профиль</button></div>' +
    '</div>';
    return mPhone(inner, 'Мобильный · единый экран ОВ (' + (S.ovTab === 'payouts' ? 'Выплаты' : S.ovTab === 'cash' ? 'Касса' : 'Счета') + ')');
  }

  function mDimaCart() {
    var t = cartTotals(S.cart);
    var MAX_SHOW = 7;
    var rest = Math.max(0, S.cart.length - MAX_SHOW);
    var body = S.cart.slice(0, MAX_SHOW).map(function (it) {
      var e = D.byId(it.employee_id); var c = calcItem(e, it.pay_amount); var tag = modeLabel(e.mode);
      var ps = D.payeesOf(e);
      var via = e.mode === 'se' ? (ps.length ? 'через ' + D.payeeShort(ps[0]) : 'на себя') : tag.d;
      return '<div class="m-card"><div class="m-card__top"><div class="m-card__ic">' + initials(e.fio) + '</div>' +
        '<div><div class="m-card__t">' + esc(e.fio.split(' ')[0]) + ' ' + esc(e.fio.split(' ')[1]) + '</div>' +
        '<div class="m-card__s"><span class="pp-tag ' + tag.cls + '">' + tag.t + '</span> ' +
        (it.kind === 'advance' ? 'Аванс' : 'Зарплата') + ' · ' + esc(via) + '</div></div>' +
        '<div class="m-card__sum num">' + money(it.pay_amount) + '</div></div>' +
        '<div class="m-card__row"><span>Остаток</span><b class="num">' + moneyRub(D.r2(e.carryDebt - e.carryAdvance)) + '</b></div>' +
        '<div class="m-card__row"><span>Начислено</span><b class="num">' + moneyRub(e.accrued) + '</b></div>' +
        '<div class="m-card__row"><span>Выплачиваем</span><b class="num">' + moneyRub(it.pay_amount) + '</b></div>' +
        '<div class="m-card__row"><span>Налог/сбор <span class="dim">(' + (e.mode === 'se' ? 'сбор+НДС 22%' : e.mode === 'ndfl' ? '+15% НДФЛ' : '1:1') + ')</span></span><b class="num">' + moneyRub(c.taxAmount) + '</b></div>' +
        '<div class="m-card__row"><span>Всего к переводу</span><b class="num" style="color:var(--gold)">' + moneyRub(c.totalAmount) + '</b></div>' +
        '<div class="m-card__row"><span>Человеку придёт</span><b class="num" style="color:var(--ok-t)">' + moneyRub(c.gotAmount) + '</b></div>' +
        (e.mode === 'se' ? '<div class="m-card__row"><span>Лимит НПД свободно</span><b class="num">' + moneyRub(e.se_left) + '</b></div>' : '') +
        (it.comment ? '<div class="m-swipe">«' + esc(it.comment) + '» — Дима</div>' : '') + '</div>';
    }).join('');
    var inner = '<div class="m-app">' +
      '<div class="m-head"><div><div class="m-head__t">Корзина выплат</div><div class="m-head__s">' + S.cart.length + ' получателей</div></div></div>' +
      '<div class="m-body">' + body +
        (rest > 0 ? '<div class="m-card" style="text-align:center;color:var(--t3)">и ещё ' + rest + ' получателей…</div>' : '') +
        '<div class="m-hero mt-3"><small>Всего к переводу</small><b class="num">' + moneyRub(t.total) + '</b>' +
          '<div class="m-card__row mt-2"><span>Получат работники</span><b class="num" style="color:var(--ok-t)">' + moneyRub(t.got) + '</b></div></div>' +
        '<div class="m-card"><div class="m-card__s">Что увидит рабочий в приложении</div>' +
          '<div class="m-card__row"><span>Переведено рабочему</span><b class="num" style="color:var(--ok-t)">' + moneyRub(t.got) + '</b></div>' +
          '<div class="m-card__row"><span>Получат</span><b>' + t.count + ' чел.</b></div></div>' +
        '<button class="btn gold" style="width:100%" data-pp-m-cart-submit>Отправить на согласование</button></div>' +
      '<div class="m-tabbar"><button class="is-on"><em>🛒</em>Корзина</button><button><em>💸</em>Выплаты</button><button><em>👤</em>Профиль</button></div>' +
    '</div>';
    return mPhone(inner, 'Мобильный · корзина Димы');
  }

  function mWorkerBanner() {
    var e = D.byId(9869); var c = calcItem(e, 39500);
    var inner = '<div class="m-app">' +
      '<div class="m-head"><div><div class="m-head__t">Зал Рабочих</div></div></div>' +
      '<div class="m-body">' +
        '<div class="po-wa-card"><div class="po-wa-head">💰 Вам произведена выплата ' + moneyRub(c.gotAmount) + '</div>' +
        '<div class="po-wa-sec">Зарплата за ' + D.MONTHS[D.PERIOD.month - 1] + ' ' + D.PERIOD.year + '</div>' +
        '<div class="po-wa-row po-wa-total"><span>Переведено рабочему</span><b class="po-ok">' + moneyRub(c.gotAmount) + '</b></div>' +
        '<div class="po-wa-row"><span>Способ</span><b>СЗ-сервис (ReStaff)</b></div>' +
        '<div class="po-wa-note">Подтвердите получение кодом из SMS. Есть 72 часа.</div>' +
        '<div class="row mt-3" style="gap:8px"><button class="btn ok sm" style="flex:1">Подтвердить</button>' +
        '<button class="btn ghost sm" style="flex:1">Не согласен</button></div></div>' +
      '</div>' +
      '<div class="m-tabbar"><button class="is-on"><em>🏠</em>Главная</button><button><em>💸</em>Доход</button><button><em>👤</em>Профиль</button></div>' +
    '</div>';
    return mPhone(inner, 'Мобильный · баннер рабочего');
  }

  // ── Пуши ───────────────────────────────────────────────────────────────
  function pushCard(opts) {
    return '<div class="push-card"><div class="push-card__top"><div class="push-card__app">⚔</div>' +
      '<span class="push-card__name">ASGARD CRM</span><span class="push-card__time">сейчас</span></div>' +
      '<div class="push-card__title">' + esc(opts.title) + '</div>' +
      '<div class="push-card__text">' + esc(opts.text) + '</div>' +
      (opts.sum ? '<div class="push-card__sum">' + esc(opts.sum) + '</div>' : '') +
      (opts.acts ? '<div class="push-card__acts">' + opts.acts + '</div>' : '') + '</div>';
  }
  function pushGallery() {
    var bt = D.batchTotals(D.BATCH_PENDING);
    var smsGot = D.r2(39500 * D.CALC.seInfoCoef);
    return '<div class="phone-stage">' +
      mPhone('<div class="m-app" style="padding:14px;gap:12px;display:flex;flex-direction:column;background:var(--bg0)">' +
        pushCard({ title: 'Корзина выплат на согласование', text: 'Дмитрий Путков отправил пачку · ' + D.BATCH_PENDING.items.length + ' получателей', sum: D.moneyRub(bt.total),
          acts: '<button class="btn ok sm">Согласовать всех</button><button class="btn ghost sm">Открыть</button>' }) +
        pushCard({ title: 'Заявка на наличные #4796', text: 'Соколов Р. · суточные дружине · Северная башня', sum: '84 000 ₽',
          acts: '<button class="btn ok sm">Согласовать</button>' }) +
        pushCard({ title: 'Счёт ООО «Северсталь-Метиз»', text: 'УТ-4471 · оплатить до 18.10', sum: '486 000 ₽',
          acts: '<button class="btn ok sm">Согласовать</button>' }) +
        '</div>', 'Пуш · директору (web-push)') +
      mPhone('<div class="m-app" style="padding:14px;gap:12px;display:flex;flex-direction:column;background:var(--bg0)">' +
        '<div class="push-card" style="border-color:var(--gold)"><div class="push-card__top"><div class="push-card__app" style="background:var(--ok)">MAX</div>' +
        '<span class="push-card__name">ASGARD · MAX</span><span class="push-card__time">сейчас</span></div>' +
        '<div class="push-card__title">Пачка выплат согласована ✓</div>' +
        '<div class="push-card__text">Олег Викторович утвердил ' + D.BATCH_PENDING.items.length + ' выплат. Можно переводить.</div>' +
        '<div class="push-card__sum">' + D.moneyRub(bt.total) + '</div></div>' +
        '<div class="push-card" style="border-color:var(--ok-t)"><div class="push-card__top"><div class="push-card__app" style="background:var(--blue)">SMS</div>' +
        '<span class="push-card__name">ASGARD CRM</span></div>' +
        '<div class="push-card__title">Код подтверждения выплаты</div>' +
        '<div class="push-card__text" style="font-size:22px;font-weight:900;letter-spacing:6px;color:var(--t1)">4 8 2 1 9</div>' +
        '<div class="push-card__text">Введите в приложении, чтобы подтвердить получение ' + D.moneyRub(smsGot) + '.</div></div>' +
        '</div>', 'Пуш · MAX и SMS') +
      mPhone('<div class="m-app" style="padding:14px;gap:12px;display:flex;flex-direction:column;background:var(--bg0)">' +
        '<div class="push-card"><div class="push-card__top"><div class="push-card__app" style="background:var(--info)">TG</div>' +
        '<span class="push-card__name">ASGARD · Telegram</span><span class="push-card__time">5 мин</span></div>' +
        '<div class="push-card__title">💵 Заявка кассы #4817</div>' +
        '<div class="push-card__text">Морозов Игорь · закупка расходников, объект 12</div>' +
        '<div class="push-card__sum">32 500 ₽</div>' +
        '<div class="push-card__acts"><button class="btn ok sm">Согласовать</button><button class="btn ghost sm">Вопрос</button><button class="btn danger sm">Отклонить</button></div></div>' +
        '<div class="push-card" style="opacity:.9"><div class="push-card__top"><div class="push-card__app">⚔</div><span class="push-card__name">ASGARD CRM</span></div>' +
        '<div class="push-card__title">Возврат выплаты</div>' +
        '<div class="push-card__text">Олег Викторович вернул выплату Кученкову А.В.: «Уточни лимит НПД, сумма близка к годовой».</div></div>' +
        '</div>', 'Пуш · Telegram и возврат') +
    '</div>';
  }

  function chatMimir() {
    var bt = D.batchTotals(D.BATCH_PENDING);
    var seN = 0, ndN = 0, cashN = 0;
    D.BATCH_PENDING.items.forEach(function (it) {
      var e = D.byId(it.employee_id);
      if (!e) return;
      if (e.mode === 'se') seN++; else if (e.mode === 'ndfl') ndN++; else cashN++;
    });
    return '<div class="phone-stage">' +
      mPhone('<div class="m-app" style="background:var(--bg0)">' +
        '<div class="m-head"><div><div class="m-head__t">Мимир</div><div class="m-head__s">AI-помощник · выплаты</div></div></div>' +
        '<div class="m-body" style="display:flex;flex-direction:column;gap:10px">' +
          '<div style="align-self:flex-end;max-width:85%;background:var(--blue);color:var(--on-color);padding:10px 12px;border-radius:14px 14px 4px 14px;font-size:12.5px">Какая пачка на согласовании и сколько всего к переводу?</div>' +
          '<div style="align-self:flex-start;max-width:90%;background:var(--bg2);border:1px solid var(--brd);padding:10px 12px;border-radius:14px 14px 14px 4px;font-size:12.5px;line-height:1.5">Пачка <b>' + D.BATCH_PENDING.id + '</b> от Путкова · ' + D.BATCH_PENDING.items.length + ' получателей.<br>К переводу <b style="color:var(--gold)">' + D.moneyRub(bt.total) + '</b>, работники получат <b style="color:var(--ok-t)">' + D.moneyRub(bt.got) + '</b>.<br><span class="muted">' + seN + ' СЗ, ' + ndN + ' НДФЛ, ' + cashN + ' наличными.</span></div>' +
          '<div style="align-self:flex-start;max-width:90%;background:var(--bg2);border:1px solid var(--brd);padding:10px 12px;border-radius:14px;font-size:12.5px">Риск: у Кученкова лимит НПД 92% — проверьте перед переводом.</div>' +
          '<div style="align-self:flex-end;max-width:85%;background:var(--blue);color:var(--on-color);padding:10px 12px;border-radius:14px 14px 4px 14px;font-size:12.5px">Согласовать всех</div>' +
        '</div>' +
        '<div style="padding:10px 12px;border-top:1px solid var(--brd);display:flex;gap:8px"><input class="input" placeholder="Спросите Мимира…" style="flex:1"><button class="btn primary sm">→</button></div>' +
        '</div>', 'Мимир в согласованиях') +
    '</div>';
  }

  // обёртка одного телефона в сцену (для экранов мобильного)
  function pushPhoneWrap(html) { return '<div class="phone-stage">' + html + '</div>'; }

  window.PP_VIEWS = {
    S: S, esc: esc, toast: toast, initials: initials, pushPhoneWrap: pushPhoneWrap,
    rowState: rowState, sumOf: sumOf,
    payoutsScreen: payoutsScreen, payModal: payModal, carryModal: carryModal, cartBar: cartBar, cartDrawer: cartDrawer,
    approvalScreen: approvalScreen, mApprovals: mApprovals, mDimaCart: mDimaCart,
    planScreen: planScreen, chartScreen: chartScreen, chartDayModal: chartDayModal,
    mWorkerBanner: mWorkerBanner, pushGallery: pushGallery, chatMimir: chatMimir
  };
})();
