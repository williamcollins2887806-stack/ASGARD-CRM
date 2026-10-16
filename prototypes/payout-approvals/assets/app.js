/* ASGARD CRM — прототип корзины выплат: роутер экранов + интерактив */
(function () {
  'use strict';
  var D = window.PP_DATA, V = window.PP_VIEWS, S = V.S, esc = V.esc;

  var SCREENS = {
    'payouts':   { nav: 'Экран Димы · Выплаты',       render: function () { return V.payoutsScreen(); } },
    'approvals': { nav: 'Экран ОВ · Согласования',    render: function () { return V.approvalScreen(); } },
    'chart':     { nav: 'Экран ОВ · График платежей', render: function () { return V.chartScreen(); } },
    'm-ov':      { nav: 'Мобильный · ОВ',             render: function () { return V.pushPhoneWrap(V.mApprovals()); }, phone: true },
    'm-cart':    { nav: 'Мобильный · Корзина Димы',   render: function () { return V.pushPhoneWrap(V.mDimaCart()); }, phone: true },
    'm-worker':  { nav: 'Мобильный · Рабочий',        render: function () { return V.pushPhoneWrap(V.mWorkerBanner()); }, phone: true },
    'push':      { nav: 'Пуши',                       render: function () { return V.pushGallery(); } },
    'mimir':     { nav: 'Мимир · AI',                 render: function () { return V.chatMimir(); } }
  };
  var listView = { m: 'm-ov', d: 'approvals' };       // мобильная/десктоп реализация одной сущности

  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }

  // ── Рендер ─────────────────────────────────────────────────────────────
  function render() {
    closeModal();                       // при смене экрана закрываем модалку
    closeCart();
    var hash = (location.hash || '#payouts').slice(1);
    var view = SCREENS[hash] ? hash : 'payouts';
    var sc = SCREENS[view];
    var host = $('#viewHost');
    host.innerHTML = sc.render();
    $('#crumb').innerHTML = sc.nav + '<small>прототип · корзина выплат и согласования</small>';
    $('#phoneBar').style.display = sc.phone ? 'flex' : 'none';
    host.classList.toggle('has-cart', view === 'payouts' && S.cart.length > 0);
    // sticky-bar корзины — на экране Димы
    $('#cartHost').innerHTML = (view === 'payouts') ? V.cartBar() : '';
    $('#sidePayoutN').textContent = String(payoutPendingCount());
    $$('.side__item[data-nav]').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-nav') === view); });
    if (view === 'payouts') drawChart();
    window.scrollTo(0, 0);
  }

  function payoutPendingCount() {
    return (S.batch ? S.batch.items.filter(function (i) { return (i.approval_status || 'pending') === 'pending'; }).length : 0)
      + D.CASH_REQUESTS.filter(function (r) { return r.status === 'requested'; }).length
      + D.INVOICES.length;
  }

  // ── График ─────────────────────────────────────────────────────────────
  // ── Планирование ОВ: помощники ─────────────────────────────────────────
  function planItem(id) { for (var i = 0; i < D.PLAN.items.length; i++) if (D.PLAN.items[i].employee_id === id) return D.PLAN.items[i]; return null; }
  function setPlanApproved(id, on) {
    var p = planItem(id); if (!p) return;
    var e = D.byId(id);
    if (on && !(p.to_transfer > 0)) { V.toast('Введите сумму', 'Сумма к переводу должна быть больше нуля', 'warn'); return; }
    p.approved = on;
    if (on) { p.pay_date = '05.11.2026'; V.toast('Согласовано', e.fio.split(' ')[0], 'ok'); }
  }
  function togglePlan(id) { var p = planItem(id); if (p) setPlanApproved(id, !p.approved); }
  function applyPlanAll() {
    var mode = ($('#pl_bulk_mode') || {}).value || 'max';
    var dateIso = ($('#pl_bulk_date') || {}).value || '2026-11-05';
    D.PLAN.items.forEach(function (p) {
      var e = D.byId(p.employee_id); if (!e) return;
      if (mode === 'max') p.to_transfer = p.max_amount;
      else if (mode === 'debt') p.to_transfer = D.r2(Math.max(0, Math.min(e.to_pay, p.max_amount)));
      else p.to_transfer = D.r2(Math.round(p.max_amount / 2));
      p.pay_date_iso = dateIso;
      p.pay_date = dateIso.split('-').reverse().join('.');
    });
    V.toast('Применено ко всем', mode === 'max' ? 'по максимуму (с учётом лимита НПД)' : mode === 'debt' ? 'вся сумма долга' : 'половина', 'ok');
  }
  function approveFilled() {
    var n = 0, sum = 0;
    D.PLAN.items.forEach(function (p) {
      if (p.to_transfer > 0) { p.approved = true; n++; sum = D.r2(sum + p.to_transfer); }
    });
    V.toast('Согласовано', n + ' выплат на ' + D.moneyRub(sum), 'ok');
  }
  function shiftChart(dir) {
    var cur = S.chartYM || { year: D.PLAN.month.year, month: D.PLAN.month.month };
    var m = cur.month + dir, y = cur.year;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    S.chartYM = { year: y, month: m };
    render();
  }

  // ── График: рисование не нужно (CSS-столбцы) ───────────────────────────

  function drawChart() {
    var cv = $('#pp-chart'); if (!cv) return;
    var ctx = cv.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth, h = 180;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var css = getComputedStyle(document.documentElement);
    var acc = css.getPropertyValue('--blue-l').trim() || css.getPropertyValue('--info-t').trim();
    var paid = css.getPropertyValue('--ok-t').trim();
    var brd = css.getPropertyValue('--brd').trim();
    var t3 = css.getPropertyValue('--t3').trim();
    var series = D.SERIES;
    var max = 1; series.forEach(function (m) { max = Math.max(max, m.accrued, m.paid); });
    var padL = 42, padR = 12, padT = 14, padB = 26;
    var iw = w - padL - padR, ih = h - padT - padB;
    function X(i) { return padL + (series.length === 1 ? iw / 2 : i * iw / (series.length - 1)); }
    function Y(v) { return padT + ih - (v / max) * ih; }
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = brd; ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var yy = padT + ih * g / 4;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillStyle = t3; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(short(max * (4 - g) / 4), padL - 6, yy + 3);
    }
    function line(key, color) {
      ctx.beginPath(); ctx.lineWidth = 2.2; ctx.strokeStyle = color; ctx.lineJoin = 'round';
      series.forEach(function (m, i) { i ? ctx.lineTo(X(i), Y(m[key])) : ctx.moveTo(X(i), Y(m[key])); });
      ctx.stroke();
      ctx.beginPath();
      series.forEach(function (m, i) { i ? ctx.lineTo(X(i), Y(m[key])) : ctx.moveTo(X(i), Y(m[key])); });
      ctx.lineTo(X(series.length - 1), padT + ih); ctx.lineTo(X(0), padT + ih); ctx.closePath();
      ctx.globalAlpha = .12; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
    }
    line('paid', paid); line('accrued', acc);
    ctx.fillStyle = t3; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'center';
    series.forEach(function (m, i) { ctx.fillText(D.MONTHS[m.month - 1].slice(0, 3), X(i), h - 8); });
  }
  function short(v) { return v >= 1e6 ? (v / 1e6).toFixed(1) + 'М' : v >= 1e3 ? Math.round(v / 1e3) + 'К' : String(Math.round(v)); }

  // ── Интерактив ─────────────────────────────────────────────────────────
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-nav],[data-pp-chk],[data-pp-open],[data-pp-modal-close],[data-pp-save],[data-pp-save-cart],[data-pp-cart-open],[data-pp-cart-close],[data-pp-cart-clear],[data-pp-cart-del],[data-pp-cart-submit],[data-pp-m-cart-submit],[data-pp-ovtab],[data-apcard],[data-pp-ov-approve],[data-pp-ov-reject],[data-pp-ov-approve-all],[data-pp-ov-approve-batch],[data-pp-ov-reject-batch],[data-pp-item-approve],[data-pp-item-reject],[data-pp-pay],[data-pp-kind],[data-pp-withdraw],[data-pp-q],[data-pp-official],[data-pp-adj],[data-pp-carry],[data-pp-carry-save],[data-pp-payee],[data-pp-chart-open],[data-pp-chart-back],[data-pp-chart-prev],[data-pp-chart-next],[data-pp-chart-col],[data-pp-plan-chk],[data-pp-plan-set],[data-pp-plan-unset],[data-pp-plan-apply-all],[data-pp-plan-approve-all],[data-pp-reapprove]');
    if (!t) return;

    if (t.hasAttribute('data-nav')) { location.hash = '#' + t.getAttribute('data-nav'); return; }
    if (t.hasAttribute('data-pp-ovtab')) { S.ovTab = t.getAttribute('data-pp-ovtab'); render(); return; }
    if (t.hasAttribute('data-pp-chart-open')) { location.hash = '#chart'; return; }
    if (t.hasAttribute('data-pp-chart-back')) { S.ovTab = 'plan'; location.hash = '#approvals'; return; }
    if (t.hasAttribute('data-pp-chart-prev')) { shiftChart(-1); return; }
    if (t.hasAttribute('data-pp-chart-next')) { shiftChart(1); return; }
    var chartCol = t.getAttribute('data-pp-chart-col');
    if (chartCol) {
      $$('.pc-col').forEach(function (c) { c.classList.toggle('is-on', c === t); });
      openChartDayModal(+chartCol);
      return;
    }

    // ── Планирование ОВ ────────────────────────────────────────────────
    var planChk = t.getAttribute('data-pp-plan-chk');
    if (planChk) { togglePlan(+planChk); render(); return; }
    var planSet = t.getAttribute('data-pp-plan-set');
    if (planSet) { setPlanApproved(+planSet, true); render(); return; }
    var planUnset = t.getAttribute('data-pp-plan-unset');
    if (planUnset) { setPlanApproved(+planUnset, false); render(); return; }
    if (t.hasAttribute('data-pp-plan-apply-all')) { applyPlanAll(); render(); return; }
    if (t.hasAttribute('data-pp-plan-approve-all')) { approveFilled(); render(); return; }
    if (t.hasAttribute('data-pp-m-cart-submit')) {
      S.batch = {
        id: 'BATCH-' + (2400 + Math.floor(Math.random() * 90)),
        created_by: D.USERS.dima.name, period: D.PERIOD, status: 'pending_approval',
        submitted_at: '15.10 ' + new Date().toTimeString().slice(0, 5),
        items: V.S.cart.map(function (c) {
          return { employee_id: c.employee_id, kind: c.kind, pay_amount: c.pay_amount, comment: c.comment, approval_status: 'pending' };
        })
      };
      V.toast('Отправлено на согласование', 'Олег Викторович получит уведомление', 'ok');
      location.hash = '#approvals'; return;
    }

    // чекбокс строки -> в корзину / из корзины (только если ещё не в согласовании)
    var chk = t.getAttribute('data-pp-chk');
    if (chk) {
      var id = +chk;
      if (V.S.cart.some(function (c) { return c.employee_id === id; })) {
        V.S.cart = V.S.cart.filter(function (c) { return c.employee_id !== id; });
        V.toast('Убрано из корзины', D.byId(id).fio.split(' ')[0], 'warn');
      } else {
        var e = D.byId(id);
        V.S.cart.push({ employee_id: id, kind: 'salary', pay_amount: Math.max(0, e.to_pay), comment: '' });
        V.toast('Готова к отправке', e.fio.split(' ')[0] + ' в корзине', 'ok');
      }
      render(); return;
    }

    if (t.hasAttribute('data-pp-open')) { openModal(+t.getAttribute('data-pp-open')); return; }
    if (t.hasAttribute('data-pp-modal-close')) { closeModal(); return; }
    var carryId = t.getAttribute('data-pp-carry');
    if (carryId) { openCarryModal(+carryId); return; }
    var carrySave = t.getAttribute('data-pp-carry-save');
    if (carrySave) {
      var cid = +carrySave, cEmp = D.byId(cid);
      var root = t.closest('[data-carry]');
      var newVal = parseFloat(($('.po-carry-new', root) || {}).value);
      var reason = (($('.po-carry-reason', root) || {}).value || '').trim();
      if (!Number.isFinite(newVal)) { V.toast('Проверка', 'Введите новый остаток', 'err'); return; }
      if (!reason) { V.toast('Нужна причина', 'Без причины корректировка запрещена', 'err'); ($('.po-carry-reason', root) || {}).focus && $('.po-carry-reason', root).focus(); return; }
      var delta = D.r2(newVal - (cEmp.carryDebt - cEmp.carryAdvance));
      // применяем к остатку рабочего и пишем запись корректировки
      if (newVal >= 0) { cEmp.carryDebt = newVal; cEmp.carryAdvance = 0; }
      else { cEmp.carryDebt = 0; cEmp.carryAdvance = -newVal; }
      cEmp.to_pay = D.r2(cEmp.carryDebt - cEmp.carryAdvance + cEmp.accrued + cEmp.bonus - cEmp.penalty - cEmp.advance - cEmp.official);
      S.adjustments = S.adjustments || {};
      S.adjustments[cid] = { delta: delta, reason: reason, newValue: newVal };
      closeModal();
      V.toast('Остаток скорректирован', 'Δ ' + (delta > 0 ? '+' : '') + D.moneyRub(delta) + ' · ' + reason, 'ok');
      render(); return;
    }
    var pe = t.getAttribute('data-pp-payee');
    if (pe) {
      $$('[data-pp-payee]', t.closest('.po-payee-pick')).forEach(function (o) { o.classList.toggle('is-on', o === t); });
      return;
    }

    if (t.hasAttribute('data-pp-kind')) {
      $$('.po-zcard', t.closest('.po-modal')).forEach(function (b) { b.classList.toggle('active', b === t); });
      return;
    }
    if (t.hasAttribute('data-pp-q')) {
      var q = t.getAttribute('data-pp-q');
      var mroot0 = t.closest('[data-emp]');
      var inp = $('.po-amount', mroot0);
      var emp = D.byId(+(mroot0 && mroot0.dataset.emp));
      if (!inp || !emp) return;
      var base = Math.max(0, emp.to_pay);
      if (q === 'all') inp.value = base;
      else if (q === 'half') inp.value = Math.round(base / 2);
      else inp.value = 0;
      recalcModal();
      return;
    }
    if (t.hasAttribute('data-pp-official')) { recalcModal(); return; }
    if (t.hasAttribute('data-pp-adj')) { V.toast('Премия/удержание учтены', '«К выплате» пересчитано', 'ok'); return; }

    var saveId = t.getAttribute('data-pp-save') || t.getAttribute('data-pp-save-cart');
    if (saveId) {
      var sid = +saveId, emp = D.byId(sid);
      var mroot = t.closest('[data-emp]');
      var amount = parseFloat(($('.po-amount', mroot) || {}).value) || Math.max(0, emp.to_pay);
      var kindEl = $('.po-zcard.active', mroot);
      var kind = (kindEl && kindEl.getAttribute('data-pp-kind')) || 'salary';
      var toCart = t.hasAttribute('data-pp-save-cart');
      delete S.rejected[sid];
      S.cart = S.cart.filter(function (c) { return c.employee_id !== sid; });
      S.cart.push({ employee_id: sid, kind: kind, pay_amount: amount, comment: toCart ? 'Сохранено из модалки' : 'Черновик' });
      // Если правим уже СОГЛАСОВАННУЮ выплату — снимаем одобрение и требуем
      // повторного согласования ОВ (решение заказчика 15.10.2026).
      var bi = V.rowState(sid);
      var wasApproved = (bi.status === 'approved');
      if (wasApproved) {
        var item = (S.batch && S.batch.items || []).find(function (x) { return x.employee_id === sid; });
        if (item) { item.approval_status = 'pending'; item.reapproved = true; item.pay_amount = amount; }
        else {
          S.batch = S.batch || { id: 'BATCH-' + (2400 + Math.floor(Math.random() * 90)), created_by: D.USERS.dima.name, period: D.PERIOD, status: 'pending_approval', submitted_at: '15.10 ' + new Date().toTimeString().slice(0, 5), items: [] };
          S.batch.items.push({ employee_id: sid, kind: kind, pay_amount: amount, comment: 'Правка после согласования', approval_status: 'pending', reapproved: true });
        }
        S.reapproved = S.reapproved || {}; S.reapproved[sid] = true;
      }
      closeModal();
      V.toast(wasApproved ? 'Отправлено на повторное согласование' : (toCart ? 'Сохранено и в корзине' : 'Сохранено, готова к отправке'),
        wasApproved ? 'Сумма изменена — ОВ подтвердит заново' : emp.fio.split(' ')[0],
        wasApproved ? 'warn' : 'ok');
      render(); return;
    }

    if (t.hasAttribute('data-pp-cart-open')) { openCart(); return; }
    if (t.hasAttribute('data-pp-cart-close')) { closeCart(); return; }
    if (t.hasAttribute('data-pp-cart-clear')) { V.S.cart = []; closeCart(); V.toast('Корзина очищена', '', 'warn'); render(); return; }
    var del = t.getAttribute('data-pp-cart-del');
    if (del) { V.S.cart = V.S.cart.filter(function (c) { return c.employee_id !== +del; }); render(); openCart(); return; }

    if (t.hasAttribute('data-pp-cart-submit')) {
      var how = t.getAttribute('data-pp-cart-submit'); // 'approve' | 'pay' | '' (ранее)
      var toApprove = V.S.cart.filter(function (c) { var s = V.rowState(c.employee_id); return s.status !== 'approved'; });
      var toPay = V.S.cart.filter(function (c) { var s = V.rowState(c.employee_id); return s.status === 'approved'; });
      var msgs = [];
      if (how !== 'pay' && toApprove.length) {
        S.batch = {
          id: 'BATCH-' + (2400 + Math.floor(Math.random() * 90)),
          created_by: D.USERS.dima.name, period: D.PERIOD, status: 'pending_approval',
          submitted_at: '15.10 ' + new Date().toTimeString().slice(0, 5),
          items: toApprove.map(function (c) {
            return { employee_id: c.employee_id, kind: c.kind, pay_amount: c.pay_amount, comment: c.comment, approval_status: 'pending' };
          })
        };
        msgs.push('на согласование: ' + toApprove.length);
      }
      if (how !== 'approve' && toPay.length) {
        msgs.push('к выплате: ' + toPay.length);
        V.S.cart = V.S.cart.filter(function (c) { var s = V.rowState(c.employee_id); return s.status !== 'approved'; });
      }
      closeCart();
      V.toast('Готово', msgs.join(' · ') || 'Корзина обработана', 'ok');
      render(); return;
    }

    if (t.hasAttribute('data-apcard')) { t.closest('.ap-card').classList.toggle('is-open'); return; }

    // ── Согласование ОВ ────────────────────────────────────────────────
    if (t.hasAttribute('data-pp-ov-approve')) {
      V.toast('Согласовано', 'Дальше: бухгалтерия', 'ok');
      t.closest('.ap-card').classList.remove('is-open'); return;
    }
    if (t.hasAttribute('data-pp-ov-reject')) {
      V.toast('Отклонено', 'Заявителю ушёл комментарий', 'err');
      t.closest('.ap-card').classList.remove('is-open'); return;
    }
    // «Согласовать всех» на вкладках кассы/счетов — НЕ трогает пачку выплат
    if (t.hasAttribute('data-pp-ov-approve-all')) {
      var src = t.getAttribute('data-pp-ov-approve-all');
      if (src === 'batch') { approveAllBatch(); }
      else { V.toast('Согласовано', src === 'cash' ? 'Все заявки кассы → бухгалтерия' : 'Все счета → бухгалтерия', 'ok'); }
      render(); return;
    }
    if (t.hasAttribute('data-pp-ov-approve-batch')) { approveAllBatch(); V.toast('Пачка утверждена', 'Дима может выплачивать', 'ok'); render(); return; }
    if (t.hasAttribute('data-pp-ov-reject-batch')) {
      if (S.batch) {
        S.batch.items.forEach(function (i) {
          i.approval_status = 'rejected';
          i.reject_reason = 'вернул всю пачку';
          // запоминаем причину, чтобы строка у Димы показала «Возврат»
          S.rejected[i.employee_id] = 'вернул всю пачку';
        });
        S.batch = null;
      }
      V.toast('Пачка возвращена Диме', 'Строки помечены «Возврат»', 'err'); render(); return;
    }
    var ia = t.getAttribute('data-pp-item-approve');
    if (ia && S.batch) { S.batch.items.forEach(function (i) { if (i.employee_id === +ia) i.approval_status = 'approved'; }); V.toast('Одобрено', D.byId(+ia).fio.split(' ')[0], 'ok'); render(); return; }
    var ir = t.getAttribute('data-pp-item-reject');
    if (ir && S.batch) {
      S.batch.items.forEach(function (i) { if (i.employee_id === +ir) { i.approval_status = 'rejected'; i.reject_reason = 'уточнить лимит НПД'; } });
      V.toast('Возврат Диме', D.byId(+ir).fio.split(' ')[0] + ' · с комментарием', 'warn'); render(); return;
    }
    if (t.hasAttribute('data-pp-withdraw')) { V.toast('Отозвано', 'Вернулось в корзину Димы', 'warn'); return; }
    if (t.hasAttribute('data-pp-pay')) { V.toast('Выплачено', 'Рабочему ушёл код подтверждения', 'ok'); return; }
  });

  function approveAllBatch() { if (S.batch) S.batch.items.forEach(function (i) { i.approval_status = 'approved'; }); }

  // ── Модалка + живой пересчёт ───────────────────────────────────────────
  function openModal(empId) {
    closeModal();
    var ov = document.createElement('div');
    ov.className = 'pp-ov modal-ov'; ov.style.zIndex = '90';
    ov.innerHTML = '<div style="position:fixed;inset:0;display:grid;place-items:center;padding:20px;overflow:auto">' +
      '<div style="width:min(760px,100%);background:var(--bg1);border:1px solid var(--brd);border-radius:16px;box-shadow:var(--shadow-xl);padding:24px">' +
      '<div class="row mb-4"><b style="font-size:17px">Выплата — ' + esc(D.byId(empId).fio) + '</b>' +
      '<button class="pp-dr__x" style="margin-left:auto" data-pp-modal-close>✕</button></div>' +
      '<div class="po-modal" data-emp="' + empId + '">' + V.payModal(empId) + '</div></div></div>';
    document.body.appendChild(ov);
    var inp = $('.po-amount', ov);
    if (inp) inp.addEventListener('input', recalcModal);
  }
  function recalcModal() {
    var root = $('.po-modal[data-emp]'); if (!root) return;
    var emp = D.byId(+root.dataset.emp);
    var amount = parseFloat(($('.po-amount', root) || {}).value) || 0;
    var officialCb = $('input', root.querySelector('.po-official-toggle'));
    var mode = emp.mode === 'cash' && officialCb && officialCb.checked ? 'ndfl' : emp.mode;
    var pseudo = { mode: mode };
    var c = V.calcFor ? V.calcFor(pseudo, amount) : null;
    // считаем напрямую по константам (устойчиво к отсутствию helper)
    var got, total;
    if (mode === 'se') { got = D.r2(amount * D.CALC.seInfoCoef); total = D.r2(amount * D.CALC.seTransferCoef); }
    else if (mode === 'ndfl') { got = D.r2(amount * (1 + D.CALC.officialMarkupRate)); total = got; }
    else { got = amount; total = amount; }
    var wa = $('.po-wa-head', root); if (wa) wa.textContent = '💰 Вам произведена выплата ' + D.moneyRub(got);
    var tot = $('.po-wa-total b', root); if (tot) tot.textContent = D.moneyRub(got);
    var hint = $('.po-hint', root);
    var left = D.r2(Math.max(0, Math.max(0, emp.to_pay) - amount));
    if (hint) hint.innerHTML = 'Останется к выплате: <b>' + D.moneyRub(left) + '</b>';
  }
  function closeModal() { $$('.modal-ov').forEach(function (o) { o.remove(); }); }

  // ── Модалка «кому платим в этот день» (клик по столбцу) ────────────────
  function openChartDayModal(day) {
    closeModal();
    var ov = document.createElement('div');
    ov.className = 'pp-ov modal-ov'; ov.style.zIndex = '90';
    ov.innerHTML = '<div style="position:fixed;inset:0;display:grid;place-items:center;padding:20px;overflow:auto">' +
      '<div style="width:min(680px,100%);background:var(--bg1);border:1px solid var(--brd);border-radius:16px;box-shadow:var(--shadow-xl);padding:22px">' +
      '<div class="row mb-3"><b style="font-size:17px">Кому платим в этот день</b>' +
      '<button class="pp-dr__x" style="margin-left:auto" data-pp-modal-close>✕</button></div>' +
      V.chartDayModal(day) + '</div></div>';
    document.body.appendChild(ov);
  }

  // ── Модалка корректировки остатка ──────────────────────────────────────
  function openCarryModal(empId) {
    closeModal();
    var emp = D.byId(empId);
    var cur = D.r2(emp.carryDebt - emp.carryAdvance);
    var ov = document.createElement('div');
    ov.className = 'pp-ov modal-ov'; ov.style.zIndex = '90';
    ov.innerHTML = '<div style="position:fixed;inset:0;display:grid;place-items:center;padding:20px;overflow:auto">' +
      '<div style="width:min(560px,100%);background:var(--bg1);border:1px solid var(--brd);border-radius:16px;box-shadow:var(--shadow-xl);padding:24px">' +
      '<div class="row mb-4"><b style="font-size:17px">Корректировка остатка</b>' +
      '<button class="pp-dr__x" style="margin-left:auto" data-pp-modal-close>✕</button></div>' +
      V.carryModal(empId) + '</div></div>';
    document.body.appendChild(ov);
    var inp = $('.po-carry-new', ov);
    var prev = $('#carry_new_preview', ov);
    var deltaEl = $('#carry_delta', ov);
    var upd = function () {
      var val = parseFloat(inp.value);
      if (!Number.isFinite(val)) val = 0;
      var d = D.r2(val - cur);
      if (prev) prev.textContent = D.moneyRub(val);
      if (deltaEl) deltaEl.value = (d > 0 ? '+' : '') + D.money(d) + ' ₽';
    };
    if (inp) { inp.addEventListener('input', upd); upd(); }
  }

  // ── Корзина drawer ─────────────────────────────────────────────────────
  function openCart() { closeCart(); document.getElementById('drawerHost').innerHTML = V.cartDrawer(); }
  function closeCart() { document.getElementById('drawerHost').innerHTML = ''; }

  // ── Тема ───────────────────────────────────────────────────────────────
  function setTheme(th) {
    document.documentElement.setAttribute('data-theme', th);
    S.theme = th;
    try { localStorage.setItem('pp-theme', th); } catch (_) {}
    $$('[data-theme-btn]').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-theme-btn') === th); });
    if ((location.hash || '').slice(1) === 'payouts') setTimeout(drawChart, 30);
  }

  // ── Инициализация ──────────────────────────────────────────────────────
  window.addEventListener('hashchange', render);
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (!t) return;
    var amt = t.getAttribute && t.getAttribute('data-pp-plan-amt');
    if (amt) { var p = planItem(+amt); if (p) { var v = parseFloat(t.value); p.to_transfer = Number.isFinite(v) && v >= 0 ? D.r2(v) : 0; } return; }
    var dt = t.getAttribute && t.getAttribute('data-pp-plan-date');
    if (dt) { var p2 = planItem(+dt); if (p2) { p2.pay_date_iso = t.value; p2.pay_date = t.value.split('-').reverse().join('.'); } return; }
    var cm = t.getAttribute && t.getAttribute('data-pp-plan-cmt');
    if (cm) { S.planComments = S.planComments || {}; S.planComments[+cm] = t.value; return; }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t && t.getAttribute && t.getAttribute('data-pp-plan-amt')) {
      var p = planItem(+t.getAttribute('data-pp-plan-amt'));
      if (p) { var v = parseFloat(t.value); p.to_transfer = Number.isFinite(v) && v >= 0 ? D.r2(v) : 0; }
    }
  });
  $$('[data-theme-btn]').forEach(function (b) { b.addEventListener('click', function () { setTheme(b.getAttribute('data-theme-btn')); }); });
  window.addEventListener('resize', function () { if ((location.hash || '').slice(1) === 'payouts') drawChart(); });

  var saved = 'dark';
  try { saved = localStorage.getItem('pp-theme') || 'dark'; } catch (_) {}
  setTheme(saved);
  if (!location.hash) location.hash = '#payouts';
  render();
})();
