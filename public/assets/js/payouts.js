/**
 * ASGARD CRM — Страница выплат (#/payouts)
 * ═══════════════════════════════════════════════════════════════════════════
 * Единый центр выплат (Дима Путков + админ/директора/бухгалтер):
 *   • список сотрудников: остаток / начислено / аванс / удержание-штраф /
 *     оклад / к выплате, кнопки «Выплатить» и «Подтвердить за рабочего»;
 *   • выплаченные уходят вниз серым, ожидающие подтверждения — жёлтые,
 *     просроченные 72ч — красные; бейдж «переплата»;
 *   • мини-дашборд сезона (KPI) и график по месяцам (canvas);
 *   • модалка: карточка сотрудника + форма «Аванс/Зарплата» с налогом СЗ;
 *   • архив: год → месяц → расчётные ведомости; экспорт Excel.
 *
 * Только дизайн-система CRM (токены темы + классы DS), без системных цветов
 * и сторонних библиотек.
 */
window.AsgardPayoutsPage = (function () {
  'use strict';
  const { $, esc, toast, showModal, hideModal, money } = AsgardUI;

  // Форматтеры — на базе DS (money), копейки сохраняются в toString.
  const fmt = (n) => (n == null ? '—' : money(n));
  const fmtR = (n) => (n == null ? '—' : money(n) + ' ₽');
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const PLATFORM_LABELS = {
    restaff: 'СЗ-сервис (ReStaff)', card: 'Перевод с карты',
    bank: 'Бухгалтерия через банк', cash: 'Наличные', other: 'Иное',
  };
  const TYPE_LABELS = { salary: 'ЗП', advance: 'Аванс', bonus: 'Премия', penalty: 'Штраф', per_diem: 'Суточные' };
  const typeLabel = (t) => TYPE_LABELS[t] || t;

  // Состояние активного рендера (одна страница = один контекст).
  let ctx = null; // { token, user, state, reload }

  // Человеческое сообщение об ошибке: «что случилось» + «что делать».
  // Сервер отдаёт { message, hint }; показываем оба — пользователь должен
  // понимать, что произошло и какой следующий шаг (правило продукта).
  function humanMsg(data, fallback) {
    const parts = [];
    if (data && data.message) parts.push(String(data.message));
    else if (data && data.error && typeof data.error === 'string') parts.push(String(data.error));
    if (data && data.hint) parts.push(String(data.hint));
    return parts.length ? parts.join(' ') : (fallback || 'Не удалось выполнить операцию');
  }

  async function apiFetch(url) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + ctx.token } });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(humanMsg(e, 'Ошибка HTTP ' + r.status));
    }
    return r.json();
  }
  async function apiPost(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + ctx.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(humanMsg(data, 'Ошибка HTTP ' + r.status));
      err.data = data;
      throw err;
    }
    return data;
  }

  /** Скачать файл (Excel) авторизованно → blob → ссылка. */
  async function downloadFile(url, filename) {
    try {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + ctx.token } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href; a.download = filename || 'export.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (e) { toast('Ошибка', 'Не удалось скачать: ' + e.message, 'err'); }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // V391: КОРЗИНА ВЫПЛАТ + СОГЛАСОВАНИЕ ДИРЕКТОРОМ
  // ═══════════════════════════════════════════════════════════════════════
  // Поток: Дима собирает корзину → «Отправить на согласование» → директор одобряет
  // поштучно/списком или возвращает с причиной → Дима выплачивает ТОЛЬКО
  // одобренные. Если Дима правит уже одобренную сумму — согласование
  // снимается, нужна повторная проверка директором (иначе можно подменить сумму).
  //
  // Источник правды — сервер (/api/payout-cart), локальное состояние лишь кэш.
  const cart = {
    items: [],      // черновик: {employee_id, kind, pay_amount, comment}
    batch: null,    // список: {batch_id, status, items:[{employee_id, approval_status, reject_reason, reapproved, pay_amount, ...}]}
    approved: [],   // одобренные позиции за период
    loaded: false,
  };

  /** Загрузить корзину/списка за период. */
  async function loadCart() {
    const st = ctx.state;
    try {
      const [mine, appr] = await Promise.all([
        apiFetch(`/api/payout-cart/${st.year}/${st.month}`),
        apiFetch(`/api/payout-cart/approved/${st.year}/${st.month}`),
      ]);
      const items = mine.items || [];
      // Черновик = позиции списка в статусе draft/pending с approval='pending' без отправки
      cart.batch = items.length ? {
        batch_id: items[0].batch_id,
        status: items[0].status,
        submitted_at: items[0].submitted_at,
        items: items.map((i) => ({
          employee_id: i.employee_id, kind: i.kind, pay_amount: Number(i.pay_amount),
          approval_status: i.approval_status, reject_reason: i.reject_reason,
          reapproved: i.reapproved, comment: i.comment, item_id: i.item_id,
          payee_employee_id: i.payee_employee_id, fio: i.fio,
        })),
      } : null;
      cart.approved = (appr.items || []).map((i) => ({
        employee_id: i.employee_id, pay_amount: Number(i.pay_amount), item_id: i.item_id,
        paid_count: i.paid_count, fio: i.fio,
      }));
      cart.items = (cart.batch ? cart.batch.items : []).map((i) => ({
        employee_id: i.employee_id, kind: i.kind, pay_amount: i.pay_amount, comment: i.comment,
      }));
      cart.loaded = true;
    } catch (e) { cart.loaded = false; }
  }

  /** Позиция списка по сотруднику (если он в списке/корзине). */
  function batchItem(employeeId) {
    if (!cart.batch) return null;
    return cart.batch.items.find((i) => i.employee_id === employeeId) || null;
  }

  /** Состояние строки: null | draft | pending | approved | reapproved | rejected. */
  function rowState(employeeId) {
    const it = batchItem(employeeId);
    if (it) {
      if (it.reapproved) return { status: 'reapproved', reason: it.reject_reason };
      const st = it.approval_status || 'pending';
      // Список ещё черновик (не отправлена) → «Готова к отправке»
      if (cart.batch.status === 'draft' && st === 'pending') return { status: 'draft', reason: null };
      return { status: st, reason: it.reject_reason };
    }
    return { status: null, reason: null };
  }

  /** Итоги по набору позиций. */
  function calcTotals(items) {
    let pay = 0, got = 0, total = 0;
    for (const it of items) {
      const c = calcItemAmounts(it.employee_id, it.pay_amount);
      pay += it.pay_amount; got += c.got; total += c.total;
    }
    return { pay: r2(pay), got: r2(got), total: r2(total), count: items.length };
  }

  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  /** Пересчёт сумм по строке реестра (тот же контур, что и на сервере). */
  function calcItemAmounts(employeeId, pay) {
    const rows = (ctx.rowsCache || []);
    const row = rows.find((x) => x.employee_id === employeeId);
    const seInfo = Number((ctx.calc && ctx.calc.se_info_coef)) || 1.064;
    const seTransfer = Number((ctx.calc && ctx.calc.se_transfer_coef)) || (1.064 / 0.96) * 1.22;
    const ndflRate = Number((ctx.calc && ctx.calc.official_markup_rate)) || 0.15;
    const isSe = !!(row && (row.is_self_employed || row._isSe));
    if (isSe) {
      return { got: r2(pay * seInfo), total: r2(pay * seTransfer) };
    }
    if (row && (row._isNdfll || row._official)) {
      return { got: r2(pay * (1 + ndflRate)), total: r2(pay * (1 + ndflRate)) };
    }
    return { got: r2(pay), total: r2(pay) };
  }

  // ─────────────────────────────────────────────────────────── render
  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    ctx = { token: auth.token, user: auth.user };

    // Доступ: базовые роли ИЛИ персональный грант (проверяем на бэке)
    let allowed = ['ADMIN', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(auth.user.role);
    try {
      const me = await apiFetch('/api/payouts/me');
      allowed = !!me.allowed;
    } catch (_) { /* сеть/авторизация — решаем по роли */ }
    if (!allowed) {
      toast('Доступ', 'Страница выплат недоступна', 'err');
      location.hash = '#/home';
      return;
    }

    // Платим ЗА предыдущий календарный месяц (выплаты 10–15 числа).
    // В октябре (до 15.10) платим за сентябрь; в ноябре — за октябрь и т.д.
    const now = new Date();
    let payY = now.getFullYear();
    let payM = now.getMonth(); // getMonth() 0-based → это уже «предыдущий» в 1-based
    if (payM < 1) { payM = 12; payY--; }
    const state = {
      year: payY,
      month: payM,           // месяц НАЧИСЛЕНИЯ, за который платим
      view: 'list',          // list | archive
      archiveYear: payY,
    };
    ctx.state = state;

    const todayLabel = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

    await layout(`
      <div class="panel">
        <div class="po-head">
          <div class="po-head-main">
            <div class="po-head-title" id="po_period"></div>
            <div class="po-head-sub">Сегодня ${esc(todayLabel)} — выплачиваем заработок за прошлый месяц</div>
          </div>
          <div class="po-head-actions">
            <span id="po_ready"></span>
            <button class="btn ghost" id="po_export">Excel</button>
            <button class="btn ghost" id="po_tab_archive">Архив</button>
          </div>
        </div>
        <div id="po_kpi" class="po-kpi-grid" aria-live="polite"></div>
        <div id="po_chart" style="margin-bottom:18px"></div>
        <div id="po_body"></div>
      </div>
    `, { title: title || 'Выплаты' });

    $('#po_tab_archive').onclick = () => { state.view = state.view === 'archive' ? 'list' : 'archive'; load(); };
    $('#po_export').onclick = () => downloadFile(`/api/payouts/export/${state.year}/${state.month}`, `payouts-${state.year}-${state.month}.xlsx`);

    // load() живёт в области видимости render() и доступна модалке через ctx.reload.
    async function load() {
      $('#po_period').textContent = 'Выплата за ' + MONTHS[state.month - 1] + ' ' + state.year;
      if (state.view === 'list') await loadList(state);
      else await loadArchive(state);
    }
    ctx.reload = load;

    await load();
    return () => {};
  }

  // ─────────────────────────────────────────────────────── список
  async function loadList(state) {
    const body = $('#po_body');
    body.innerHTML = '<div class="empty-state">Загрузка…</div>';
    let data;
    try {
      data = await apiFetch(`/api/payouts/list/${state.year}/${state.month}`);
    } catch (e) {
      body.innerHTML = `<div class="empty-state">Ошибка: ${esc(e.message)}</div>`;
      return;
    }

    renderKpi(data);
    renderChart(state);

    // V391: подтягиваем корзину/списка за период ДО отрисовки строк —
    // от её состояния зависят бейджи, чекбоксы и доступность «Выплатить».
    await loadCart();

    // Кэш строк — для пересчёта сумм в корзине без повторных запросов.
    ctx.rowsCache = data.rows || [];

    // Готовность периода (мягкое предупреждение, не блокирует)
    const ready = $('#po_ready');
    if (data.ready_to_pay) {
      ready.innerHTML = '<span class="badge success">Табель закрыт — можно платить</span>';
    } else {
      const msgs = (data.warnings || []).filter((w) => w.level === 'warn').map((w) => w.message).join('; ');
      ready.innerHTML = `<span class="badge warning">Внимание: ${esc(msgs || 'есть незакрытые данные')}</span>`;
    }

    const rows = data.rows || [];
    let html = '';
    if (!rows.length) {
      html = '<div class="empty-state">Нет сотрудников к выплате за этот месяц</div>';
    } else {
      html = `<div class="tablewrap"><table class="asg po-table" id="po_table">
        <thead><tr>
          <th class="po-num">№</th><th class="po-chkcell"></th>
          <th>ФИО</th><th style="text-align:right">Остаток</th>
          <th style="text-align:right">Начислено</th><th style="text-align:right">Аванс</th>
          <th style="text-align:right">Удержание</th><th style="text-align:right">Оклад</th>
          <th style="text-align:right">К выплате</th><th></th>
        </tr></thead><tbody id="po_rows"></tbody></table></div>`;
      body.innerHTML = html;

      const tbody = $('#po_rows');
      // Активные — все, кому ещё есть что выплатить (в т.ч. к_выплате = 0,
      // если это результат аванса). В «Выплаченные» уходит только тот, у кого
      // платить больше нечего И выплата за период была (см. payout-row.js).
      const active = rows.filter((r) => !r.paid_this_period);
      const done = rows.filter((r) => r.paid_this_period);
      const ordered = [...active, ...done];
      // Разделитель перед «Выплаченные»
      let html2 = ordered.map((r, i) => {
        const sep = (i === active.length && done.length) ? '<tr class="po-sep"><td colspan="10">Выплаченные</td></tr>' : '';
        return sep + rowHtml(r, i + 1);
      }).join('');
      // Нумерация: активные = 1..N; выплаченные — продолжают список
      tbody.innerHTML = html2;

      // Кнопки — внутри таблицы (контейнер), не по document.
      const root = $('#po_body');
      Array.from(root.querySelectorAll('.po-pay')).forEach((b) => {
        b.onclick = () => openPayModal(parseInt(b.dataset.id, 10));
      });
      Array.from(root.querySelectorAll('.po-edit')).forEach((b) => {
        b.onclick = () => openPayModal(parseInt(b.dataset.id, 10));
      });
      Array.from(root.querySelectorAll('.po-confirm')).forEach((b) => {
        b.onclick = () => confirmByManager(parseInt(b.dataset.pid, 10));
      });
      Array.from(root.querySelectorAll('.po-revert')).forEach((b) => {
        b.onclick = () => revertPayout(parseInt(b.dataset.pid, 10));
      });
      // V391: чекбокс «в корзину» и правка остатка.
      Array.from(root.querySelectorAll('[data-cart-chk]')).forEach((el) => {
        el.onclick = () => toggleCart(parseInt(el.dataset.cartChk, 10));
      });
      Array.from(root.querySelectorAll('[data-carry]')).forEach((b) => {
        b.onclick = () => openCarryModal(parseInt(b.dataset.carry, 10));
      });
    }
    if (!rows.length) body.innerHTML = html;
    renderCartBar();
  }

  function rowHtml(r, n) {
    const isDone = !!r.paid_this_period;
    let cls = '';
    let flag = '';
    if (isDone) {
      cls = 'po-row-done';
      if (r.confirm === 'disputed') flag = 'po-row-bad';
      else if (r.confirm != null && r.confirm !== 'confirmed') flag = r.overdue ? 'po-row-bad' : 'po-row-wait';
    } else if (r.warning) {
      flag = 'po-row-wait';
    }
    const over = r.overpaid ? ' <span class="badge danger">переплата</span>' : '';
    // Бейдж подтверждения — только для выплат нового флоу (confirmation_status задан).
    let confirmBadge = '';
    if (isDone && r.confirm != null && r.confirm !== 'confirmed') {
      if (r.confirm === 'disputed') confirmBadge = '<span class="badge danger">спор</span>';
      else if (r.overdue) confirmBadge = '<span class="badge danger">не подтвердил</span>';
      else confirmBadge = '<span class="badge warning">ждёт подтв.</span>';
    } else if (isDone && r.confirm === 'confirmed') {
      confirmBadge = '<span class="badge success">✓ подтв.</span>';
    }
    // ── V391: состояние согласования строки ───────────────────────────────
    const st = rowState(r.employee_id);
    const status = st.status;   // null|draft|pending|approved|reapproved|rejected
    let aCls = '';
    let ready = '';
    if (status === 'draft') {
      aCls = 'po-row-draft';
      ready = '<span class="po-ready po-ready--draft"><i class="pulse"></i>Готова к отправке на согласование</span>';
    } else if (status === 'pending') {
      aCls = 'po-row-pending';
      ready = '<span class="po-ready po-ready--pending"><i class="pulse"></i>Ждёт согласования директора</span>';
    } else if (status === 'approved') {
      aCls = 'po-row-approved';
      ready = '<span class="po-ready po-ready--approved"><i class="pulse"></i>Согласовано · можно платить</span>';
    } else if (status === 'reapproved') {
      aCls = 'po-row-reapproved';
      ready = '<span class="po-ready po-ready--pending"><i class="pulse"></i>Правка после согласования · ждёт повторного согласования</span>';
    } else if (status === 'rejected') {
      aCls = 'po-row-rejected';
      ready = `<span class="po-ready po-ready--rejected"><i class="pulse"></i>Возврат: ${esc(st.reason || 'с комментарием')}</span>`;
    }

    // Чекбокс в корзину: доступен, пока позиция не ушла на согласование.
    // Согласованные/ожидающие — «замок» (нельзя тихо убрать из списка).
    // ⚠️ Позиции, уже лежащие в корзине, ОБЯЗАНЫ быть отмечены (is-on) — иначе
    // пользователь не видит, что уже выбрано, и не может снять выбор.
    const inCartNow = cart.items.some((it) => it.employee_id === r.employee_id);
    const locked = (status === 'pending' || status === 'approved' || status === 'reapproved');
    const chk = locked
      ? `<span class="po-chk is-on" data-locked="1" title="${status === 'approved' ? 'Согласовано' : 'Ждёт согласования'}"></span>`
      : `<span class="po-chk ${inCartNow ? 'is-on' : ''}" data-cart-chk="${r.employee_id}" role="checkbox" aria-checked="${inCartNow ? 'true' : 'false'}" tabindex="0" title="Отметить для выплаты"></span>`;

    // Кнопки: «Выплатить» ТОЛЬКО после согласования (ТЗ №7).
    const hadPayment = !!r.has_payment_this_period;
    let btn = '';
    if (!isDone) {
      if (status === 'approved') {
        btn = `<button class="btn ok po-pay" data-id="${r.employee_id}">Выплатить</button> ` +
          `<button class="btn ghost po-edit" data-id="${r.employee_id}" title="Изменить сумму — потребуется повторное согласование">Поправить</button> `;
      } else if (status === 'pending' || status === 'reapproved') {
        btn = `<button class="btn" disabled title="Ждёт согласования директора">Выплатить 🔒</button> ` +
          `<button class="btn ghost po-edit" data-id="${r.employee_id}">Поправить</button> `;
      } else if (status === 'rejected') {
        btn = `<button class="btn primary po-edit" data-id="${r.employee_id}" title="Вернули — исправьте и отправьте снова">Исправить</button> `;
      } else {
        // Свободная строка: выплата допускается только через корзину+согласование,
        // но оставляем «Выплатить» для совместимости (гейт проверит сервер).
        btn = `<button class="btn primary po-pay" data-id="${r.employee_id}">Выплатить</button> `;
      }
      if (hadPayment && r.payment_id) {
        if (r.confirm !== 'confirmed') {
          btn += `<button class="btn ghost po-confirm" data-pid="${r.payment_id}">Подтвердить за рабочего</button> `;
        }
        btn += `<button class="btn ghost danger po-revert" data-pid="${r.payment_id}" title="Удалить выплату и вернуть в реестр">Отменить</button>`;
      }
    } else {
      confirmBadge += '';
      if (r.confirm !== 'confirmed') {
        btn += `<button class="btn ghost po-confirm" data-pid="${r.payment_id}">Подтвердить за рабочего</button> `;
      }
      if (r.payment_id) {
        btn += `<button class="btn ghost danger po-revert" data-pid="${r.payment_id}" title="Удалить выплату и вернуть в реестр">Отменить</button>`;
      }
    }
    // Остаток: положительный — долг компании рабочему. Отрицательный — это
    // переплата/ранее выданный аванс: показываем его в колонке «Аванс»
    // (заказчик 14.10.2026), а не отрицательным числом в «Остатке».
    const carryShown = r.carry_debt != null ? r.carry_debt : Math.max(0, r.carry);
    const advanceShown = (Number(r.advance) || 0) + (r.carry_advance != null ? r.carry_advance : Math.max(0, -(r.carry) || 0));
    // Кнопка корректировки остатка — только на свободной строке (не в списке).
    const carryEdit = (!status && !isDone)
      ? `<button class="po-carry-edit" data-carry="${r.employee_id}" title="Скорректировать остаток (с причиной)"><em>✎</em> правка</button>`
      : '';
    const payeeBadge = (r.se_payee_id || r.se_payee2_fio)
      ? '<span class="pp-tag pp-tag--payee">через получателя</span>' : '';
    const methodTag = r.is_self_employed ? '<span class="pp-tag pp-tag--se">СЗ</span>'
      : (r.is_officially_employed ? '<span class="pp-tag pp-tag--ndfl">НДФЛ +15%</span>'
        : '<span class="pp-tag pp-tag--cash">Наличные</span>');
    return `<tr class="${cls} ${flag} ${aCls}">
      <td class="po-num">${n}</td>
      <td class="po-chkcell">${chk}</td>
      <td><div class="po-fio"><div class="po-fio__name">${esc(r.fio)}${over} ${confirmBadge}</div>
        <span class="po-fio__badges">${methodTag}${payeeBadge}</span>
        ${ready ? `<div class="mt-2">${ready}</div>` : ''}</div></td>
      <td style="text-align:right">${fmt(carryShown)}${carryEdit}</td>
      <td style="text-align:right">${fmt(r.accrued)}</td>
      <td style="text-align:right">${fmt(advanceShown)}</td>
      <td style="text-align:right">${fmt(r.penalty)}</td>
      <td style="text-align:right">${fmt(r.official)}</td>
      <td style="text-align:right;font-weight:700;color:${r.to_pay > 0 ? 'var(--ok-t)' : 'var(--t2)'}">${fmt(r.to_pay)}</td>
      <td style="text-align:right;white-space:nowrap">${btn}</td>
    </tr>`;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // V391: КОРЗИНА — sticky-bar, drawer, отправка на согласование
  // ═══════════════════════════════════════════════════════════════════════

  /** Отметить/снять сотрудника в корзине (чекбокс строки). */
  async function toggleCart(employeeId) {
    const row = (ctx.rowsCache || []).find((r) => r.employee_id === employeeId);
    if (!row) return;
    const inCart = cart.items.some((i) => i.employee_id === employeeId);
    if (inCart) {
      // Убираем позицию из черновика (локально + на сервере).
      // ⚠️ Бэкенд ждёт DELETE (не POST) — иначе 404 и позиция остаётся в БД.
      const bi = batchItem(employeeId);
      cart.items = cart.items.filter((i) => i.employee_id !== employeeId);
      if (bi && bi.item_id) {
        try {
          await fetch('/api/payout-cart/items/' + bi.item_id, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + ctx.token },
          });
        } catch (_) {}
      }
    } else {
      // Сумма по умолчанию — «к выплате» (можно поправить в корзине).
      const pay = Math.max(0, Number(row.to_pay) || 0);
      cart.items.push({ employee_id: employeeId, kind: 'advance', pay_amount: pay, comment: '' });
    }
    refreshRows();
    renderCartBar();
  }

  /** Перерисовать только чекбоксы/бейджи строк без полной перезагрузки. */
  function refreshRows() {
    const tbody = $('#po_rows');
    if (!tbody || !ctx.rowsCache) return;
    const active = ctx.rowsCache.filter((r) => !r.paid_this_period);
    const done = ctx.rowsCache.filter((r) => r.paid_this_period);
    const ordered = [...active, ...done];
    tbody.innerHTML = ordered.map((r, i) => {
      const sep = (i === active.length && done.length) ? '<tr class="po-sep"><td colspan="10">Выплаченные</td></tr>' : '';
      return sep + rowHtml(r, i + 1);
    }).join('');
    const root = $('#po_body');
    Array.from(root.querySelectorAll('.po-pay, .po-edit')).forEach((b) => {
      b.onclick = () => openPayModal(parseInt(b.dataset.id, 10));
    });
    // V391: чекбоксы и правка остатка перерисовываются — привязываем заново.
    // ⚠️ Класс is-on выставляет сам rowHtml (по cart.items), здесь НЕ трогаем:
    // ручной сброс «is-on» затирал отметки и ломал снятие галочки.
    Array.from(root.querySelectorAll('[data-cart-chk]')).forEach((el) => {
      el.onclick = () => toggleCart(parseInt(el.dataset.cartChk, 10));
    });
    Array.from(root.querySelectorAll('[data-carry]')).forEach((b) => {
      b.onclick = () => openCarryModal(parseInt(b.dataset.carry, 10));
    });
  }

  /** Sticky-bar корзины внизу страницы. */
  function renderCartBar() {
    let host = document.getElementById('pp_cart_bar');
    if (!host) {
      host = document.createElement('div');
      host.id = 'pp_cart_bar';
      document.body.appendChild(host);
    }
    if (!cart.items.length) { host.innerHTML = ''; return; }
    const t = calcTotals(cart.items);
    let seN = 0, ndN = 0;
    for (const it of cart.items) {
      const row = (ctx.rowsCache || []).find((r) => r.employee_id === it.employee_id);
      if (row && row.is_self_employed) seN++;
      else if (row && row.is_officially_employed) ndN++;
    }
    const cashN = cart.items.length - seN - ndN;
    host.innerHTML = `
      <div class="pp-bar">
        <div class="pp-bar__ic">🛒</div>
        <div class="pp-bar__main">
          <div class="pp-bar__t">Корзина выплат · <b>${cart.items.length}</b> получателей</div>
          <div class="pp-bar__s">${cashN} нал · ${seN} СЗ · ${ndN} НДФЛ</div>
        </div>
        <div class="pp-bar__chips">
          ${cashN ? `<span class="pp-tag pp-tag--cash">${cashN}</span>` : ''}
          ${seN ? `<span class="pp-tag pp-tag--se">${seN}</span>` : ''}
          ${ndN ? `<span class="pp-tag pp-tag--ndfl">${ndN}</span>` : ''}
        </div>
        <div class="pp-bar__sum">${fmtR(t.total)}<small>всего к переводу</small></div>
        <div class="pp-bar__actions">
          <button class="btn ghost" id="pp_cart_clear">Очистить</button>
          <button class="btn gold" id="pp_cart_open">Открыть корзину</button>
        </div>
      </div>`;
    document.getElementById('pp_cart_clear').onclick = clearCart;
    document.getElementById('pp_cart_open').onclick = openCartDrawer;
  }

  /** Очистить корзину. ⚠️ Удаляем позиции и НА СЕРВЕРЕ, иначе после reload
   *  черновик вернётся с сервера и sticky-bar снова появится. */
  async function clearCart() {
    const batch = cart.batch;
    // 1) удаляем позиции черновика в БД (DELETE /items/:id)
    if (batch && batch.status === 'draft') {
      for (const it of batch.items) {
        if (!it.item_id) continue;
        try {
          await fetch('/api/payout-cart/items/' + it.item_id, {
            method: 'DELETE', headers: { Authorization: 'Bearer ' + ctx.token },
          });
        } catch (_) {}
      }
    }
    // 2) локально чистим всё, кроме уже одобренных (их убирать нельзя)
    cart.items = [];
    if (batch) {
      batch.items = batch.items.filter((i) => i.approval_status !== 'pending');
      if (!batch.items.length) batch.status = null;
    }
    refreshRows();
    renderCartBar();
    toast('Корзина', 'Очищена', 'ok');
  }

  /** Позиция корзины в drawer — подробная карточка. */
  function cartItemHtml(it) {
    const row = (ctx.rowsCache || []).find((r) => r.employee_id === it.employee_id) || {};
    const c = calcItemAmounts(it.employee_id, it.pay_amount);
    const st = rowState(it.employee_id);
    const isSe = !!row.is_self_employed;
    const modeTag = isSe ? '<span class="pp-tag pp-tag--se">СЗ</span>'
      : (row.is_officially_employed ? '<span class="pp-tag pp-tag--ndfl">НДФЛ +15%</span>'
        : '<span class="pp-tag pp-tag--cash">Наличные</span>');
    const payee = row.se_payee_fio || row.se_payee2_fio || null;
    const stTag = st.status === 'approved'
      ? '<span class="badge success">к выплате</span>'
      : (st.status === 'rejected' ? `<span class="badge danger">возврат: ${esc(st.reason || '')}</span>`
        : '<span class="badge warning">на согласование</span>');
    return `<div class="pp-it">
      <div class="pp-it__top">
        <div class="pp-it__av">${initials(row.fio || '')}</div>
        <div style="min-width:0">
          <div class="pp-it__name">${esc(row.fio || '')}</div>
          <div class="pp-it__meta">${modeTag} · ${it.kind === 'advance' ? 'Аванс' : 'Зарплата'}${payee ? ' · через ' + esc(payee) : ''}</div>
        </div>
        <button class="pp-it__del" data-cart-del="${it.employee_id}" title="Убрать">✕</button>
      </div>
      <div class="row" style="margin:8px 0 2px;gap:6px">${stTag}
        <span class="pp-tag pp-tag--cash">ост. ${fmt(row.carry_debt != null ? row.carry_debt : Math.max(0, row.carry || 0))}</span>
        <span class="pp-tag pp-tag--se">нач. ${fmt(row.accrued)}</span>
      </div>
      <div class="pp-it__grid">
        <div class="pp-cell"><div class="pp-cell__l">К выплате</div><div class="pp-cell__v num">${fmt(row.to_pay)}</div></div>
        <div class="pp-cell"><div class="pp-cell__l">Выплачиваем</div><div class="pp-cell__v num" style="color:var(--info-t)">${fmt(it.pay_amount)}</div></div>
        <div class="pp-cell pp-cell--got"><div class="pp-cell__l">Человеку придёт</div><div class="pp-cell__v num">${fmt(c.got)}</div></div>
        <div class="pp-cell pp-cell--total"><div class="pp-cell__l">Всего к переводу</div><div class="pp-cell__v num">${fmt(c.total)}</div></div>
      </div>
      <div class="pp-note">налог/сбор ${fmt(c.total - c.got)}${it.comment ? ` · «${esc(it.comment)}»` : ''}</div>
    </div>`;
  }

  /** Drawer корзины: две группы (на согласование / уже согласовано) + итоги. */
  function openCartDrawer() {
    let ov = document.getElementById('pp_cart_drawer');
    if (ov) ov.remove();
    ov = document.createElement('div');
    ov.id = 'pp_cart_drawer';
    const t = calcTotals(cart.items);
    const toApprove = cart.items.filter((it) => rowState(it.employee_id).status !== 'approved');
    const toPay = cart.items.filter((it) => rowState(it.employee_id).status === 'approved');
    const tA = calcTotals(toApprove), tP = calcTotals(toPay);

    let body = '';
    if (!cart.items.length) {
      body = `<div class="empty-state"><div class="icon">🛒</div><div class="title">Корзина пуста</div>
        <div class="desc">Отметьте выплаты галочкой слева от ФИО</div></div>`;
    } else {
      if (toApprove.length) {
        body += `<div class="pp-group-h"><span>На согласование · ${toApprove.length} · ${fmtR(tA.total)}</span></div>` +
          toApprove.map(cartItemHtml).join('');
      }
      if (toPay.length) {
        body += `<div class="pp-group-h"><span>Согласовано — к выплате · ${toPay.length} · ${fmtR(tP.total)}</span></div>` +
          toPay.map(cartItemHtml).join('');
      }
      body += `<div class="pp-tot">
        <div class="pp-tot__row"><span>Выплачиваем (в счёт начисленного)</span><b>${fmtR(t.pay)}</b></div>
        <div class="pp-tot__row"><span>Получат работники</span><b>${fmtR(t.got)}</b></div>
        <div class="pp-tot__row"><span>Налоги и сбор площадки</span><b>${fmtR(t.total - t.got)}</b></div>
        <div class="pp-tot__row pp-tot__row--big"><span>Всего к переводу</span><b>${fmtR(t.total)}</b></div>
      </div>
      <div class="pp-wa-mini"><div class="pp-wa-mini__t">Что увидит рабочий в приложении</div>
        <div class="po-wa-row"><span>Переведено рабочему</span><b class="po-ok">${fmtR(t.got)}</b></div>
        <div class="po-wa-row"><span>Получат</span><b>${t.count} чел.</b></div>
        <div class="po-wa-note">Каждый получит уведомление и подтвердит получение кодом.</div></div>`;
    }

    let foot;
    if (toApprove.length && toPay.length) {
      foot = `<button class="btn ghost" data-cart-submit="approve" style="flex:1">На согласование (${toApprove.length})</button>
        <button class="btn ok" data-cart-submit="pay" style="flex:1">Выплатить согласованных (${toPay.length})</button>`;
    } else if (toApprove.length) {
      foot = `<button class="btn gold" data-cart-submit="approve" style="flex:1">Отправить на согласование (${toApprove.length})</button>`;
    } else {
      foot = `<button class="btn ok" data-cart-submit="pay" style="flex:1">Выплатить списком (${toPay.length})</button>`;
    }

    ov.innerHTML = `<div class="pp-ov" data-cart-close></div>
      <aside class="pp-dr">
        <div class="pp-dr__hd"><div><div class="pp-dr__title">Корзина выплат</div>
          <div class="pp-dr__sub">${t.count} получателей · за ${MONTHS[ctx.state.month - 1]} ${ctx.state.year}</div></div>
          <button class="pp-dr__x" data-cart-close>✕</button></div>
        <div class="pp-dr__body">${body}</div>
        <div class="pp-dr__foot">
          <div class="row mb-3" style="justify-content:space-between"><span class="dim">Итого к переводу</span><b class="num" style="font-size:20px;font-weight:900">${fmtR(t.total)}</b></div>
          <div class="row mt-3" style="gap:8px">
            <button class="btn ghost" data-cart-clear style="flex:0 0 auto">Очистить</button>${foot}
          </div>
          <div class="dim mt-2" style="font-size:11.5px;text-align:center">Неодобренные уйдут на согласование, одобренные — сразу к выплате</div>
        </div>
      </aside>`;
    document.body.appendChild(ov);

    Array.from(ov.querySelectorAll('[data-cart-close]')).forEach((b) => { b.onclick = () => ov.remove(); });
    Array.from(ov.querySelectorAll('[data-cart-clear]')).forEach((b) => {
      b.onclick = async () => {
        await clearCart();
        ov.remove();
        await ctx.reload();
      };
    });
    Array.from(ov.querySelectorAll('[data-cart-del]')).forEach((b) => {
      b.onclick = () => { toggleCart(parseInt(b.dataset.cartDel, 10)); ov.remove(); openCartDrawer(); };
    });
    Array.from(ov.querySelectorAll('[data-cart-submit]')).forEach((b) => {
      b.onclick = () => submitCart(b.dataset.cartSubmit, ov);
    });
  }

  /** Отправить корзину на согласование ИЛИ выплатить согласованные списком. */
  async function submitCart(mode, ov) {
    const st = ctx.state;
    if (mode === 'approve') {
      try {
        // 1) сначала сохраняем все неодобренные позиции в списку
        for (const it of cart.items) {
          const stt = rowState(it.employee_id).status;
          if (stt === 'approved') continue;
          await apiPost('/api/payout-cart/draft', {
            employee_id: it.employee_id, year: st.year, month: st.month,
            kind: it.kind, pay_amount: it.pay_amount, comment: it.comment || null,
          });
        }
        // 2) отправляем списку на согласование
        const res = await apiPost('/api/payout-cart/submit', { year: st.year, month: st.month });
        if (ov) ov.remove();
        toast('Отправлено', 'Корзина ушла Олегу Викторовичу на согласование', 'ok');
        await ctx.reload();
      } catch (e) { toast('Ошибка', e.message, 'err'); }
      return;
    }
    // mode === 'pay' — списком выплачиваем ТОЛЬКО согласованных
    const toPay = cart.items.filter((it) => rowState(it.employee_id).status === 'approved');
    if (!toPay.length) { toast('Проверка', 'Нет согласованных выплат', 'err'); return; }
    if (ov) ov.remove();
    const btns = document.querySelectorAll('[data-cart-submit]');
    if (btns.length) btns.forEach((b) => { b.disabled = true; });
    let ok = 0, fail = 0;
    for (const it of toPay) {
      try {
        await apiPost('/api/payouts/pay', {
          employee_id: it.employee_id, year: st.year, month: st.month, kind: it.kind,
          pay_amount: it.pay_amount,
        });
        ok++;
      } catch (e) { fail++; }
    }
    toast(fail ? 'Частично' : 'Готово', `Выплачено: ${ok}${fail ? ', ошибок: ' + fail : ''}`, fail ? 'warn' : 'ok');
    cart.items = cart.items.filter((it) => rowState(it.employee_id).status !== 'approved');
    await ctx.reload();
  }

  // ── Модалка корректировки остатка (было → стало, причина обязательна) ──
  function openCarryModal(employeeId) {
    const row = (ctx.rowsCache || []).find((r) => r.employee_id === employeeId) || {};
    const cur = r2((Number(row.carry_debt) || 0) - (Number(row.carry_advance) || 0));
    const body = `
      <div class="po-modal" data-carry="${employeeId}">
        <div class="po-section-title">Корректировка остатка · ${esc(row.fio || '')}</div>
        <div class="po-adj-delta">
          <div class="po-adj-delta__side"><div class="po-adj-delta__l">Сейчас</div><div class="po-adj-delta__v">${fmtR(cur)}</div></div>
          <div class="po-adj-delta__arrow">→</div>
          <div class="po-adj-delta__side"><div class="po-adj-delta__l">Нужно</div><div class="po-adj-delta__v po-adj-delta__v--new" id="carry_new">${fmtR(cur)}</div></div>
        </div>
        <div class="po-form-grid">
          <div><label class="po-lbl">Новый остаток, ₽ (можно отрицательный)</label>
            <input class="input po-carry-new" type="number" step="0.01" value="${cur}"></div>
          <div><label class="po-lbl">Расхождение (посчитается)</label>
            <input class="input" id="carry_delta" value="0 ₽" readonly></div>
        </div>
        <div><label class="po-lbl">Причина корректировки — обязательно</label>
          <textarea class="input po-carry-reason" rows="2" placeholder="Например: зачли переплату по авансу, согласовано с директором"></textarea>
          <div class="help muted mt-2" style="font-size:11.5px">Причина появится у рабочего в приложении, в табеле, в истории и в расчётном листе.</div>
        </div>
        <div class="po-actions">
          <button class="btn ghost po-carry-cancel">Отмена</button>
          <button class="btn gold po-carry-save">Применить корректировку</button>
        </div>
      </div>`;
    const overlay = showModal({ title: 'Корректировка остатка', html: body, wide: false, icon: '✎' });
    const inp = overlay.querySelector('.po-carry-new');
    const prev = overlay.querySelector('#carry_new');
    const deltaEl = overlay.querySelector('#carry_delta');
    const upd = () => {
      const v = parseFloat(inp.value);
      const val = Number.isFinite(v) ? r2(v) : 0;
      const d = r2(val - cur);
      prev.textContent = fmtR(val);
      deltaEl.value = (d > 0 ? '+' : '') + fmtR(d);
    };
    inp.oninput = upd; upd();
    overlay.querySelector('.po-carry-cancel').onclick = () => hideModal();
    overlay.querySelector('.po-carry-save').onclick = async () => {
      const reason = (overlay.querySelector('.po-carry-reason').value || '').trim();
      if (!reason) { toast('Нужна причина', 'Без причины корректировка остатка запрещена', 'err'); return; }
      const v = parseFloat(inp.value);
      if (!Number.isFinite(v)) { toast('Проверка', 'Введите число', 'err'); return; }
      try {
        const res = await apiPost('/api/payouts/carry-adjustment', {
          employee_id: employeeId, year: ctx.state.year, month: ctx.state.month,
          new_amount: r2(v), reason,
        });
        hideModal();
        toast('Готово', `Остаток: ${fmtR(res.carry_before)} → ${fmtR(res.carry_after)}`, 'ok');
        await ctx.reload();
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    };
  }

  /** Инициалы для аватарки. */
  function initials(fio) {
    const p = String(fio || '').trim().split(/\s+/);
    return ((p[0] || '')[0] || '') + ((p[1] || '')[0] || '');
  }

  function renderKpi(data) {
    const t = data.totals || {};
    $('#po_kpi').innerHTML = [
      kpi('К выплате за месяц', fmtR(t.to_pay), true),
      kpi('Начислено', fmtR(t.accrued), false),
      kpi('Остаток с прошлых', fmtR(t.carry), false),
      kpi('Сотрудников', fmt(t.employees), false),    ].join('');
  }
  function kpi(label, val, accent) {
    return `<div class="po-kpi${accent ? ' po-kpi--accent' : ''}">
      <div class="po-kpi-label">${label}</div>
      <div class="po-kpi-value">${val}</div></div>`;
  }

  // ─────────────────────────────── график: начислено vs выплачено (canvas)
  async function renderChart(state) {
    const host = $('#po_chart');
    if (!host) return;
    host.innerHTML = `<div class="po-chart-box">
      <div class="po-chart-head">
        <div class="po-chart-cap">Начислено и выплачено по месяцам ${state.year}</div>
        <div class="po-chart-legend">
          <span class="po-lg"><i class="po-lg-dot po-lg-acc"></i>Начислено</span>
          <span class="po-lg"><i class="po-lg-dot po-lg-paid"></i>Выплачено</span>
        </div>
      </div>
      <canvas class="po-canvas"></canvas>
    </div>`;
    let accrued, paid;
    try {
      const series = (await apiFetch(`/api/payouts/monthly-series/${state.year}`)).series || [];
      accrued = series.map((s) => s.accrued || 0);
      paid = series.map((s) => s.paid || 0);
    } catch (_) {
      accrued = new Array(12).fill(0); paid = new Array(12).fill(0);
    }
    drawDualChart(host.querySelector('.po-canvas'), accrued, paid, MONTHS.map((x) => x.slice(0, 3)));
  }

  /** Две сглаженные линии с заливкой — по образцу графика телефонии. */
  function drawDualChart(canvas, accValues, paidValues, labels) {
    if (!canvas) return;
    const css = getComputedStyle(document.documentElement);
    const pick = (...names) => { for (const n of names) { const v = css.getPropertyValue(n).trim(); if (v) return v; } return 'transparent'; };
    const colAcc = pick('--blue-l', '--blue', '--info-t');
    const colPaid = pick('--ok-t', '--ok');
    const colGrid = pick('--brd');
    const colText = pick('--t3', '--t2');

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 640;
    const H = 220;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const PAD = { top: 16, right: 16, bottom: 28, left: 56 };
    const cw = W - PAD.left - PAD.right;
    const ch = H - PAD.top - PAD.bottom;
    const maxVal = Math.max(1, ...accValues, ...paidValues);

    // Сетка + подписи оси Y
    g.strokeStyle = colGrid; g.lineWidth = 1;
    const lines = 4;
    for (let i = 0; i <= lines; i++) {
      const yy = PAD.top + (ch / lines) * i;
      g.beginPath(); g.moveTo(PAD.left, yy); g.lineTo(PAD.left + cw, yy); g.stroke();
      g.fillStyle = colText; g.font = '11px system-ui, sans-serif'; g.textAlign = 'right';
      const v = maxVal - (maxVal / lines) * i;
      g.fillText(shortMoney(v), PAD.left - 8, yy + 4);
    }
    // Ось X
    g.fillStyle = colText; g.font = '11px system-ui, sans-serif'; g.textAlign = 'center';
    labels.forEach((l, i) => {
      const x = PAD.left + (cw / Math.max(labels.length - 1, 1)) * i;
      g.fillText(l, x, H - PAD.bottom + 18);
    });

    const toPts = (data) => data.map((v, i) => ({
      x: PAD.left + (cw / Math.max(data.length - 1, 1)) * i,
      y: PAD.top + ch - (v / maxVal) * ch,
    }));

    function series(pts, color, fill) {
      if (pts.length < 2) return;
      if (fill) {
        const grad = g.createLinearGradient(0, PAD.top, 0, PAD.top + ch);
        grad.addColorStop(0, hexA(color, 0.22));
        grad.addColorStop(1, hexA(color, 0.0));
        g.beginPath();
        g.moveTo(pts[0].x, PAD.top + ch);
        g.lineTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i - 1], c = pts[i], cx = (p.x + c.x) / 2;
          g.quadraticCurveTo(p.x + (cx - p.x) * 0.7, p.y, cx, (p.y + c.y) / 2);
          g.quadraticCurveTo(c.x - (c.x - cx) * 0.7, c.y, c.x, c.y);
        }
        g.lineTo(pts[pts.length - 1].x, PAD.top + ch);
        g.closePath(); g.fillStyle = grad; g.fill();
      }
      g.beginPath(); g.strokeStyle = color; g.lineWidth = 2.4;
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], c = pts[i], cx = (p.x + c.x) / 2;
        g.quadraticCurveTo(p.x + (cx - p.x) * 0.7, p.y, cx, (p.y + c.y) / 2);
        g.quadraticCurveTo(c.x - (c.x - cx) * 0.7, c.y, c.x, c.y);
      }
      g.stroke();
      // точки
      pts.forEach((pt) => {
        g.beginPath(); g.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
        g.fillStyle = color; g.fill();
        g.strokeStyle = pick('--bg1', '--bg2'); g.lineWidth = 1.5; g.stroke();
      });
    }

    const pAcc = toPts(accValues), pPaid = toPts(paidValues);
    series(pAcc, colAcc, true);
    series(pPaid, colPaid, true);
  }

  /** HEX/rgb → rgba с прозрачностью (для градиента). */
  function hexA(color, a) {
    const c = String(color).trim();
    const m = c.match(/^#([0-9a-f]{6})$/i);
    if (m) { const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
    const r = c.match(/^rgba?\(([^)]+)\)$/i);
    if (r) { const p = r[1].split(',').map((s) => s.trim()); return `rgba(${p[0]},${p[1]},${p[2]},${a})`; }
    return c;
  }
  function shortMoney(v) {
    const n = Number(v) || 0;
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'М';
    if (Math.abs(n) >= 1e3) return Math.round(n / 1e3) + 'К';
    return String(Math.round(n));
  }

  // ─────────────────────────────────────────────────── архив
  async function loadArchive(state) {
    const body = $('#po_body');
    body.innerHTML = '<div class="empty-state">Загрузка…</div>';
    let years = [];
    try { years = (await apiFetch('/api/payouts/archive/years')).years || []; } catch (_) { /* мягкий фолбэк: данные необязательны */ }
    if (!years.length) years = [new Date().getFullYear()];

    body.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
        <label for="po_ay" style="color:var(--t2)">Год:</label>
        <select id="po_ay" class="input" style="max-width:120px">${years.map((y) => `<option ${y === state.archiveYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <label for="po_am" style="color:var(--t2)">Месяц:</label>
        <select id="po_am" class="input" style="max-width:160px">${MONTHS.map((m, i) => `<option value="${i + 1}" ${i + 1 === state.month ? 'selected' : ''}>${m}</option>`).join('')}</select>
      </div>
      <div id="po_arch_body"><div class="empty-state">Выберите период</div></div>`;

    const hostRoot = body;
    async function loadArchMonth() {
      const y = parseInt(hostRoot.querySelector('#po_ay').value, 10);
      const m = parseInt(hostRoot.querySelector('#po_am').value, 10);
      const host = hostRoot.querySelector('#po_arch_body');
      host.innerHTML = '<div class="empty-state">Загрузка…</div>';
      try {
        const d = await apiFetch(`/api/payouts/archive/${y}/${m}`);
        if (!d.rows || !d.rows.length) { host.innerHTML = '<div class="empty-state">Нет выплат за этот период</div>'; return; }
        const byType = (bt) => Object.entries(bt || {}).map(([k, v]) => `${typeLabel(k)}: ${fmt(v)}`).join(' · ');
        const archRow = (r) => `<tr>
            <td><button type="button" class="po-arch-open" data-id="${r.employee_id}">${esc(r.fio)}</button></td>
            <td style="text-align:right">${fmtR(r.total)}</td>
            <td style="color:var(--t2);font-size:12px">${byType(r.by_type)}</td>
          </tr>`;
        host.innerHTML = `<div class="tablewrap"><table class="asg"><thead><tr>
          <th>ФИО</th><th style="text-align:right">Выплачено</th><th>По типам</th></tr></thead>
          <tbody>${d.rows.map(archRow).join('')}</tbody></table></div>`;
        Array.from(host.querySelectorAll('.po-arch-open')).forEach((a) => {
          a.onclick = () => openEmployeeCard(parseInt(a.dataset.id, 10), y, m);
        });
      } catch (e) {
        host.innerHTML = `<div class="empty-state">Ошибка: ${esc(e.message)}</div>`;
      }
    }
    hostRoot.querySelector('#po_ay').onchange = loadArchMonth;
    hostRoot.querySelector('#po_am').onchange = loadArchMonth;
    await loadArchMonth();
  }

  // ─────────────────────────────────────────────────── модалка выплаты
  async function openPayModal(employeeId) {
    const state = ctx.state;
    let preview;
    try {
      preview = await apiFetch(`/api/payouts/preview/${employeeId}?year=${state.year}&month=${state.month}`);
    } catch (e) { toast('Ошибка', e.message, 'err'); return; }
    const row = preview.row || {};
    const isSe = !!preview.is_self_employed;
    const taxRate = preview.tax_rate || 0.06;
    // Коэффициенты пересчёта — с сервера (единый источник payout-calc.js).
    // Фронт НЕ дублирует формулы: только перемножает.
    const calc = preview.calc || {};
    const seInfoCoef = Number(calc.se_info_coef) || 1.064;
    const seTransferCoef = Number(calc.se_transfer_coef) || (1.064 / 0.96) * 1.22;
    const officialMarkupRate = Number(calc.official_markup_rate) || 0.15;
    const isNonSe = !isSe;
    // Получатели НПД (V391): у рабочего может быть до двух. Выбор «через кого»
    // при каждой выплате — иначе непонятно, на кого идут деньги и лимит НПД.
    const payees = [];
    if (preview.employee && preview.employee.se_payee_id) {
      payees.push({ id: preview.employee.se_payee_id, fio: preview.employee.se_payee_fio || null, phone: preview.employee.se_payee_phone || null });
    }
    if (preview.employee && preview.employee.se_payee_id_2) {
      payees.push({ id: preview.employee.se_payee_id_2, fio: preview.employee.se_payee2_fio || null, phone: preview.employee.se_payee2_phone || null });
    }
    const payee = payees.length === 1 ? payees[0] : null;
    // Состояние согласования: правим одобренную → потребуется пересогласование.
    const preState = rowState(employeeId);
    const wasApproved = preState.status === 'approved';

    let card = { total_paid_all_time: 0, avg_per_year: 0, by_year: [], current_year_months: [] };
    let monthly = { series: [] };
    try {
      const [c, m] = await Promise.all([
        apiFetch(`/api/payouts/employee/${employeeId}/summary`),
        apiFetch(`/api/payouts/employee/${employeeId}/monthly?year=${state.year}`),
      ]);
      card = c; monthly = m;
    } catch (_) { /* мягкий фолбэк: данные необязательны */ }

    const toPay = Math.round((row.to_pay || 0) * 100) / 100;
    const body = `
      <div class="po-modal">
        <div class="po-modal-kpis">
          <div class="po-mk">
            <div class="po-mk-label">К выплате сейчас</div>
            <div class="po-mk-value po-mk-accent">${fmtR(toPay)}</div>
          </div>
          <div class="po-mk">
            <div class="po-mk-label">Заработано (начислено)</div>
            <div class="po-mk-value">${fmtR(row.accrued)}</div>
          </div>
          <div class="po-mk">
            <div class="po-mk-label">Получено за всё время</div>
            <div class="po-mk-value">${fmtR(card.total_paid_all_time)}</div>
          </div>
        </div>

        <div class="po-chart-box">
          <div class="po-chart-head">
            <div class="po-chart-cap">Начислено и получено за ${state.year}</div>
            <div class="po-chart-legend">
              <span class="po-lg"><i class="po-lg-dot po-lg-acc"></i>Начислено</span>
              <span class="po-lg"><i class="po-lg-dot po-lg-paid"></i>Получено</span>
            </div>
          </div>
          <canvas class="po-canvas-emp"></canvas>
        </div>

        <div class="po-kind-section">
          <div class="po-section-title">Что выплачиваем</div>
          <div class="po-kind-cards">
            <button type="button" class="po-zcard po-kind" data-kind="advance">
              <span class="po-zcard-ico">💸</span>
              <span class="po-zcard-t">Аванс</span>
              <span class="po-zcard-d">часть заработка досрочно</span>
            </button>
            <button type="button" class="po-zcard po-kind" data-kind="salary">
              <span class="po-zcard-ico">💰</span>
              <span class="po-zcard-t">Зарплата</span>
              <span class="po-zcard-d">выплата за месяц</span>
            </button>
          </div>
        </div>

        <div class="po-section-title">Сумма</div>
        <div class="po-form-grid">
          <div>
            <label class="po-lbl" for="po_amount">Выплачиваем (в счёт начисленного)</label>
            <input class="input po-amount" id="po_amount" type="number" min="0" step="0.01" placeholder="0" inputmode="decimal">
          </div>
          <div class="po-transfer-wrap">
            <label class="po-lbl" for="po_transfer">Переводим рабочему (на руки)</label>
            <input class="input po-transfer" id="po_transfer" type="number" min="0" step="0.01" placeholder="0" inputmode="decimal">
          </div>
        </div>
        <div class="po-quick" role="group" aria-label="Быстрый выбор суммы">
          <button type="button" class="po-chip" data-quick="all">Всё к выплате</button>
          <button type="button" class="po-chip" data-quick="half">Половина</button>
          <button type="button" class="po-chip" data-quick="clear">Очистить</button>
        </div>
        <div class="po-hint" aria-live="polite"></div>

        <div class="po-method-block">
          <div class="po-section-title">Способ выплаты</div>
          <div class="po-method"><span class="po-method-icon">${isSe ? '📱' : '💵'}</span><span class="po-method-text"></span></div>
          ${payees.length === 1 ? `
          <div class="po-payee">
            <span class="po-payee-ico">🔁</span>
            <div class="po-payee-txt">
              <b>Выплата через получателя НПД</b>
              <span>${esc(payee.fio || ('ID ' + payee.id))}${payee.phone ? ' · ' + esc(payee.phone) : ''}</span>
              <small>Деньги и лимит НПД идут на получателя, не на самого рабочего</small>
            </div>
          </div>` : ''}
          ${payees.length > 1 ? `
          <div class="po-payee-pick">
            <div class="po-section-title">Через кого переводим</div>
            <div class="po-payee-pick__list">
              ${payees.map((p, i) => `
                <label class="po-payee-opt ${i === 0 ? 'is-on' : ''}" data-payee="${p.id}">
                  <span class="po-payee-opt__radio"></span>
                  <span><span class="po-payee-opt__t">${esc(p.fio || ('ID ' + p.id))}</span>
                  <br><span class="po-payee-opt__s">${esc(p.phone || '')} · НПД-лимит получателя</span></span>
                </label>`).join('')}
            </div>
          </div>` : ''}
          ${wasApproved ? `
          <div class="po-payee" style="background:var(--warn-bg);border-color:var(--brd-gold)">
            <span class="po-payee-ico">⚠️</span>
            <div class="po-payee-txt"><b>Выплата уже согласована</b>
              <small>Если измените сумму — согласование снимется, потребуется повторное подтверждение.</small></div>
          </div>` : ''}
          ${isNonSe ? `
          <label class="po-official-toggle">
            <input type="checkbox" class="po-official">
            <span class="po-official-box"></span>
            <span class="po-official-txt">
              Переводим официально <b>+${Math.round(officialMarkupRate * 100)}%</b>
              <small>например: 100 000 ₽ → ${fmtR(Math.round(100000 * (1 + officialMarkupRate)))}</small>
            </span>
          </label>` : ''}
          <div class="po-recipient-wrap">
            <label class="po-lbl" for="po_recipient">Кому идти за деньгами (ФИО)</label>
            <input class="input po-recipient" id="po_recipient" placeholder="например: Путков Д. / руководитель проекта">
          </div>
        </div>

        <div class="po-adj-section">
          <div class="po-section-title">Премия / удержание</div>
          <p class="po-adj-head">Сумма сразу попадёт в «К выплате», табель и расчётный лист. Деньги переводятся отдельно кнопкой выплаты.</p>
          <div class="po-form-grid">
            <div>
              <label class="po-lbl" for="po_bonus">🎁 Премия, ₽</label>
              <input class="input po-bonus-amount" id="po_bonus" type="number" min="0" step="0.01" placeholder="0" inputmode="decimal">
              <input class="input po-bonus-comment" id="po_bonus_comment" placeholder="Кто согласовал и за что" autocomplete="off">
            </div>
            <div>
              <label class="po-lbl" for="po_penalty">⛔ Удержание / штраф, ₽</label>
              <input class="input po-penalty-amount" id="po_penalty" type="number" min="0" step="0.01" placeholder="0" inputmode="decimal">
              <input class="input po-penalty-comment" id="po_penalty_comment" placeholder="За что удержание" autocomplete="off">
            </div>
          </div>
          <div class="po-adj-actions">
            <button type="button" class="btn ghost po-adj-save" disabled>Применить премию / удержание</button>
            <span class="po-adj-status" aria-live="polite"></span>
          </div>
        </div>

        <div class="po-section-title">Так это увидит рабочий в приложении</div>
        <div class="po-wa" aria-live="polite"></div>

        <div class="pp-wa-mini">
          <div class="pp-wa-mini__t">Что увидит директор на согласовании</div>
          <div class="po-ov-preview" aria-live="polite"></div>
        </div>

        <div class="po-actions">
          <button type="button" class="btn ghost po-cancel">Отмена</button>
          <button type="button" class="btn ghost po-save-exit">Сохранить и выйти</button>
          <button type="button" class="btn primary po-do">Сохранить и в корзину</button>
        </div>
      </div>`;

    let kind = 'advance';
    let armedOver = false;
    let armedDuplicate = false;
    let official = false; // галка «переводим официально» (только для не-СЗ)
    let chosenPayee = payees.length ? payees[0].id : null; // «через кого» (V391)

    const KIND_LABEL = { advance: 'Аванс', salary: 'Зарплата' };

    const overlay = showModal({
      title: 'Выплата — ' + esc(preview.employee.fio || ''),
      html: body,
      wide: true,
      icon: '💰',
      onMount: () => mount(overlay),
    });

    function mount(root) {
      const q = (sel) => root.querySelector(sel);
      const qa = (sel) => Array.from(root.querySelectorAll(sel));

      drawDualChart(q('.po-canvas-emp'),
        (monthly.series || []).map((m) => m.accrued || 0),
        (monthly.series || []).map((m) => m.paid || 0),
        MONTHS.map((x) => x.slice(0, 3)));

      // Текст способа: СЗ / через получателя / официально / наличные.
      const methodEl = q('.po-method-text');
      const chosenPayeeFio = () => {
        const p = payees.find((x) => x.id === chosenPayee);
        return p ? (p.fio || ('ID ' + p.id)) : null;
      };
      const paintMethod = () => {
        if (!methodEl) return;
        const pf = chosenPayeeFio();
        if (isSe && payees.length) methodEl.textContent = 'Самозанятый: перевод через СЗ-сервис на получателя ' + pf;
        else if (isSe) methodEl.textContent = 'Самозанятый: перевод через СЗ-сервис';
        else if (official) methodEl.textContent = 'Официально: перевод на счёт (+' + Math.round(officialMarkupRate * 100) + '%)';
        else methodEl.textContent = 'Наличными из кассы';
      };
      paintMethod();

      const setKind = (k) => {
        kind = k;
        qa('.po-kind').forEach((b) => b.classList.toggle('active', b.dataset.kind === k));
        q('.po-transfer-wrap').style.display = (isSe || official) ? 'none' : 'block';
        q('.po-recipient-wrap').style.display = (isSe || official) ? 'none' : 'block';
        recalc(root);
      };
      qa('.po-kind').forEach((b) => { b.onclick = () => setKind(b.dataset.kind); });
      // V391: выбор «через кого» (если получателей двое)
      qa('.po-payee-opt').forEach((el) => {
        el.onclick = (ev) => {
          ev.preventDefault();
          chosenPayee = parseInt(el.dataset.payee, 10);
          qa('.po-payee-opt').forEach((x) => x.classList.toggle('is-on', x === el));
          paintMethod();
        };
      });
      q('.po-amount').oninput = () => recalc(root);
      q('.po-transfer').oninput = () => recalc(root);
      qa('.po-chip').forEach((b) => {
        b.onclick = () => {
          const qy = b.dataset.quick;
          if (qy === 'clear') { q('.po-amount').value = ''; q('.po-transfer').value = ''; }
          else if (qy === 'all') { q('.po-amount').value = String(Math.max(0, toPay)); q('.po-transfer').value = ''; }
          else if (qy === 'half') { q('.po-amount').value = String(Math.round(toPay / 2)); q('.po-transfer').value = ''; }
          recalc(root);
        };
      });

      // Галка «переводим официально» (+15%, канал банк, кассу не трогаем)
      const offEl = q('.po-official');
      if (offEl) {
        offEl.onchange = () => {
          official = offEl.checked;
          q('.po-transfer-wrap').style.display = (isSe || official) ? 'none' : 'block';
          q('.po-recipient-wrap').style.display = (isSe || official) ? 'none' : 'block';
          paintMethod();
          recalc(root);
        };
      }

      // Премия / удержание — моментальная запись суммы в «к выплате»
      const adjSave = q('.po-adj-save');
      const adjStatus = q('.po-adj-status');
      const syncAdj = () => {
        if (!adjSave) return;
        const hasAmt = parseFloat(q('.po-bonus-amount').value) > 0 || parseFloat(q('.po-penalty-amount').value) > 0;
        adjSave.disabled = !hasAmt;
      };
      q('.po-bonus-amount').oninput = syncAdj;
      q('.po-penalty-amount').oninput = syncAdj;
      q('.po-bonus-amount').onchange = () => saveAdjustment(root, 'bonus');
      q('.po-penalty-amount').onchange = () => saveAdjustment(root, 'penalty');
      adjSave.onclick = async () => {
        const b = await saveAdjustment(root, 'bonus');
        const p = await saveAdjustment(root, 'penalty');
        if (b || p) { adjStatus.textContent = 'Готово ✓'; setTimeout(() => { adjStatus.textContent = ''; }, 2500); }
      };

      q('.po-cancel').onclick = () => hideModal();
      q('.po-do').onclick = () => saveToCart(root, true);
      const saveExit = q('.po-save-exit');
      if (saveExit) saveExit.onclick = () => saveToCart(root, false);
      // Сразу заполняем суммой «к выплате», чтобы предпросмотр был виден
      // без единого ввода (иначе Дима не видел, что получит рабочий).
      if (toPay > 0) q('.po-amount').value = String(toPay);
      setKind('advance');
    }

    /** V391: сохранить позицию в корзину (и опционально открыть её).
     *  Выплата НЕ проводится здесь: сначала согласование директором (ТЗ №7).
     *  Если правим уже одобренную — сервер снимет одобрение (пересогласование). */
    async function saveToCart(root, openDrawer) {
      const pay = parseFloat(root.querySelector('.po-amount').value) || 0;
      if (!(pay > 0)) { toast('Проверка', 'Введите сумму выплаты', 'err'); return; }
      const comment = (root.querySelector('.po-recipient') ? root.querySelector('.po-recipient').value : '') || null;
      try {
        const res = await apiPost('/api/payout-cart/draft', {
          employee_id: employeeId, year: state.year, month: state.month,
          kind, pay_amount: r2(pay),
          payee_employee_id: isSe ? chosenPayee : null,
          comment,
          official_transfer: official || undefined,
        });
        hideModal();
        toast(res.reapproved ? 'На повторное согласование' : 'Сохранено',
          res.message || 'Позиция сохранена в корзине', res.reapproved ? 'warn' : 'ok');
        await ctx.reload();
        if (openDrawer) openCartDrawer();
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    }

    /** Записать премию/удержание, не закрывая модалку. Возвращает true при успехе. */
    async function saveAdjustment(root, type) {
      const isBonus = type === 'bonus';
      const amtEl = root.querySelector(isBonus ? '.po-bonus-amount' : '.po-penalty-amount');
      const cmtEl = root.querySelector(isBonus ? '.po-bonus-comment' : '.po-penalty-comment');
      const amount = parseFloat(amtEl.value) || 0;
      if (!(amount > 0)) return false;
      const comment = (cmtEl.value || '').trim();
      if (!comment) {
        toast('Нужен комментарий', isBonus
          ? 'Укажите: кто согласовал премию и за что'
          : 'Укажите: за что удержание/штраф', 'err');
        cmtEl.focus();
        return false;
      }
      try {
        await apiPost('/api/payouts/adjustment', {
          employee_id: employeeId, year: state.year, month: state.month,
          type, amount, comment,
        });
        toast('Записано', (isBonus ? 'Премия ' : 'Удержание ') + fmtR(amount) + ' — учтено в «К выплате»', 'ok');
        // Пересобрать модалку с новым «к выплате» (пользователь не теряет контекст)
        hideModal();
        await ctx.reload();
        openPayModal(employeeId);
        return true;
      } catch (e) {
        toast('Ошибка', e.message, 'err');
        return false;
      }
    }

    function recalc(root) {
      if (!root) return { pay: 0, transfer: 0, over: false };
      const pay = parseFloat(root.querySelector('.po-amount').value) || 0;
      let transfer = pay, info = pay;
      if (isSe) {
        // Рабочему показываем X × 1.064; реальный перевод — X × (1.064/0.96) × 1.22.
        info = Math.round(pay * seInfoCoef * 100) / 100;
        transfer = Math.round(pay * seTransferCoef * 100) / 100;
      } else if (official) {
        // «Официально»: +15% к переводу, канал — банк.
        transfer = Math.round(pay * (1 + officialMarkupRate) * 100) / 100;
        info = transfer;
      } else {
        const t = parseFloat(root.querySelector('.po-transfer').value);
        transfer = Number.isFinite(t) && t > 0 ? t : pay;
        info = transfer;
      }
      const over = pay > toPay && pay > 0;
      const after = Math.round((toPay - pay) * 100) / 100;

      const hint = root.querySelector('.po-hint');
      if (over) hint.innerHTML = `<span class="po-warn">Рабочий заработал ${fmtR(toPay)} — выплата больше. Потребуется подтверждение.</span>`;
      else if (pay > 0) hint.innerHTML = `Останется к выплате: <b>${fmtR(Math.max(0, after))}</b>`;
      else hint.innerHTML = '';

      // Предпросмотр БАННЕРА РАБОЧЕГО — ровно то, что увидит рабочий.
      // СЗ: показываем только X × 1.064 (внутренняя кухня Рестаф/НДС скрыта).
      // `info` уже посчитан выше в этой же функции.
      root.querySelector('.po-wa').innerHTML = `
        <div class="po-wa-card">
          <div class="po-wa-head">💰 Вам произведена выплата ${fmtR(info)}</div>
          <div class="po-wa-sec">${KIND_LABEL[kind]} за ${MONTHS[state.month - 1]} ${state.year}</div>
          <div class="po-wa-row po-wa-total"><span>Переведено рабочему</span><b class="po-ok">${fmtR(info)}</b></div>
          ${!isSe && !official && transfer > pay ? `<div class="po-wa-row"><span>Возврат в кассу</span><b class="po-warn">${fmtR(transfer - pay)}</b></div>` : ''}
          <div class="po-wa-row"><span>Способ</span><b>${esc(isSe
            ? 'СЗ-сервис (ReStaff)'
            : (official ? 'Официально, перевод на счёт' : 'Наличными'))}</b></div>
          <div class="po-wa-note">Рабочий получит уведомление и подтвердит получение кодом.</div>
        </div>`;

      // V391: предпросмотр для директора — что именно он согласует (как в рендере).
      // СЗ: показываем налог/сбор и «всего к переводу» (внутренняя кухня ReStaff+НДС).
      const ovPreview = root.querySelector('.po-ov-preview');
      if (ovPreview) {
        const got = isSe ? Math.round(pay * seInfoCoef * 100) / 100 : (official ? transfer : pay);
        const total = isSe ? Math.round(pay * seTransferCoef * 100) / 100 : (official ? transfer : pay);
        const tax = Math.round((total - got) * 100) / 100;
        const payeeNames = payees.map((p) => p.fio || ('ID ' + p.id));
        ovPreview.innerHTML = `
          <div class="po-wa-row"><span>Выплачиваем</span><b>${fmtR(pay)}</b></div>
          <div class="po-wa-row"><span>Налог / сбор <span class="dim">(${isSe ? 'сбор+НДС 22%' : official ? '+15% НДФЛ' : '1:1'})</span></span><b>${fmtR(tax)}</b></div>
          <div class="po-wa-row"><span>Человеку придёт</span><b class="po-ok">${fmtR(got)}</b></div>
          <div class="po-wa-row"><span>Всего к переводу</span><b style="color:var(--gold)">${fmtR(total)}</b></div>
          ${payees.length ? `<div class="po-wa-row"><span>Через кого</span><b>${esc(payees.length > 1 ? (chosenPayeeFio() || 'выбрать получателя') : payeeNames[0])}</b></div>` : ''}`;
      }
      return { pay, transfer, over };
    }

    async function doPay(root) {
      if (!root) return;
      const doBtn = root.querySelector('.po-do');
      const { pay, transfer, over } = recalc(root);
      if (!(pay > 0)) { toast('Проверка', 'Введите сумму выплаты', 'err'); root.querySelector('.po-amount').focus(); return; }
      if (over && !armedOver) {
        armedOver = true;
        doBtn.classList.add('po-armed');
        toast('Внимание', 'Рабочий столько не заработал. Нажмите «Подтвердить» ещё раз', 'warn');
        return;
      }
      const payload = {
        employee_id: employeeId, year: state.year, month: state.month, kind,
        pay_amount: pay, confirm_over: over || undefined,
        confirm_duplicate: armedDuplicate || undefined,
        official_transfer: official || undefined,
        payout_platform: isSe ? 'restaff' : (official ? 'bank' : 'cash'),
        payout_recipient_note: (!isSe && !official && root.querySelector('.po-recipient'))
          ? (root.querySelector('.po-recipient').value || null) : null,
      };
      if (!isSe && !official) payload.transfer_amount = transfer;
      doBtn.disabled = true;
      doBtn.textContent = 'Проводим…';
      try {
        const res = await apiPost('/api/payouts/pay', payload);
        toast('Готово', 'Выплата проведена: ' + fmtR(res.preview.pay_amount), 'ok');
        hideModal();
        await ctx.reload();
      } catch (e) {
        const rc = e.data && e.data.requires_confirmation;
        if (rc && e.data.error === 'duplicate_payment') {
          armedDuplicate = true;
          doBtn.classList.remove('po-armed');
          toast('Внимание', e.data.message || 'Выплата за этот период уже была. Нажмите ещё раз', 'warn');
        } else if (rc) {
          armedOver = true;
          doBtn.classList.add('po-armed');
          toast('Внимание', e.data.message || 'Нужно подтверждение', 'warn');
        } else {
          toast('Ошибка', e.message, 'err');
        }
        doBtn.disabled = false;
        doBtn.textContent = 'Подтвердить и выплатить';
      }
    }
  }

  // ─────────────────────────────────────────────── отмена выплаты
  async function revertPayout(paymentId) {
    const ok = await (AsgardUI.confirm
      ? AsgardUI.confirm('Отменить выплату?', 'Запись о выплате будет удалена, а сотрудник вернётся в список «к выплате». Это действие необратимо.')
      : Promise.resolve(true));
    if (!ok) return;
    try {
      await apiPost(`/api/payouts/${paymentId}/revert`, {});
      toast('Готово', 'Выплата отменена — сотрудник возвращён в реестр', 'ok');
      await ctx.reload();
    } catch (e) {
      toast('Ошибка', e.data && e.data.message ? e.data.message : e.message, 'err');
    }
  }

  // Карточка сотрудника (для архива) + экспорт расчётного листа
  async function openEmployeeCard(employeeId, y, m) {
    let card, hist;
    try {
      card = await apiFetch(`/api/payouts/employee/${employeeId}/summary`);
      hist = await apiFetch(`/api/payouts/history/${employeeId}`);
    } catch (e) { toast('Ошибка', e.message, 'err'); return; }
    const ops = (hist.operations || []).filter((o) => o.pay_year === y && o.pay_month === m);
    const STATUS_RU = { paid: 'Выплачено', confirmed: 'Получено (подтв.)', pending: 'Ожидает', cancelled: 'Отменено' };
    const body = `
      <div class="po-kpi-grid" style="margin-bottom:12px">
        ${kpi('За всё время', fmtR(card.total_paid_all_time), false)}
        ${kpi('Среднее за год', fmtR(card.avg_per_year), false)}
      </div>
      <div class="po-section-title">Расчётная ведомость · ${MONTHS[m - 1]} ${y}</div>
      <div class="tablewrap"><table class="asg po-table"><thead><tr>
        <th class="po-num">№</th><th>Что</th><th style="text-align:right">Сумма</th><th>Способ</th><th>Статус</th></tr></thead>
      <tbody>${ops.map((o, i) => `<tr>
        <td class="po-num">${i + 1}</td>
        <td>${typeLabel(o.type)}</td>
        <td style="text-align:right">${fmtR(o.amount)}</td>
        <td>${esc(methodRu(o))}</td>
        <td>${esc(STATUS_RU[o.confirmation_status] || STATUS_RU[o.status] || o.status)}</td>
      </tr>`).join('') || '<tr><td colspan="5">Нет операций за этот период</td></tr>'}</tbody></table></div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px">
        <button class="btn ghost po-statement">Скачать расчётный лист (Excel)</button>
      </div>`;
    const overlay = showModal({ title: esc(card.employee?.fio || 'Сотрудник'), html: body, wide: true });
    const sb = overlay ? overlay.querySelector('.po-statement') : null;
    if (sb) sb.onclick = () => downloadFile(`/api/payouts/statement/${employeeId}/${y}/${m}`, `statement-${employeeId}-${y}-${m}.xlsx`);
  }

  /** Способ выплаты по-русски: способ + площадка. */
  function methodRu(o) {
    const base = { cash: 'Наличные', card: 'На карту', transfer: 'Перевод', bank: 'Через банк', self: 'СЗ-сервис', auto: 'Авто-ФОТ' }[o.payment_method] || o.payment_method || '—';
    if (o.payout_platform && o.payout_platform !== 'cash') {
      return base + ' · ' + (PLATFORM_LABELS[o.payout_platform] || o.payout_platform);
    }
    return base;
  }

  async function confirmByManager(paymentId) {
    try {
      await apiPost(`/api/payouts/${paymentId}/confirm-by-manager`, {});
      toast('Готово', 'Подтверждено за рабочего', 'ok');
      await ctx.reload();
    } catch (e) { toast('Ошибка', e.message, 'err'); }
  }

  return { render };
})();
