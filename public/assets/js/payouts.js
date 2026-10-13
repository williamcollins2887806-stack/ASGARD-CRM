/**
 * ASGARD CRM — Страница выплат (#/payouts)
 * ═══════════════════════════════════════════════════════════════════════════
 * Единый центр выплат (Дима Путков + админ/директора/бухгалтер):
 *   • список сотрудников: остаток / начислено / аванс / удержание-штраф /
 *     оклад / к выплате, кнопки «Выплатить» и «Подтвердить за рабочего»;
 *   • выплаченные уходят вниз серым, ожидающие подтверждения — жёлтые,
 *     просроченные 72ч — красные; бейдж «переплата»;
 *   • мини-дашборд сезона и график по месяцам;
 *   • модалка: карточка сотрудника (выплаты за всё время, среднее по годам,
 *     график текущего года) + форма «Аванс/Зарплата» с налогом СЗ;
 *   • архив: год → месяц → расчётные ведомости.
 *
 * Только дизайн-система CRM (токены темы), без системных цветов и сторонних
 * библиотек. Графики — canvas по токенам.
 */
window.AsgardPayoutsPage = (function () {
  'use strict';
  const { $, $$, esc, toast, showModal, hideModal } = AsgardUI;

  const fmt = (n) => (n == null ? '—' : new Intl.NumberFormat('ru-RU').format(Math.round(n)));
  const fmtR = (n) => fmt(n) + ' ₽';
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const PLATFORM_LABELS = {
    restaff: 'СЗ-сервис (ReStaff)', card: 'Перевод с карты',
    bank: 'Бухгалтерия через банк', cash: 'Наличные', other: 'Иное',
  };

  let ctx = null; // { token, user, layout }

  async function apiFetch(url) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + ctx.token } });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || ('HTTP ' + r.status));
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
    if (!r.ok) { const err = new Error(data.message || data.error || ('HTTP ' + r.status)); err.data = data; throw err; }
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

  // ─────────────────────────────────────────────────────────── render
  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    ctx = { token: auth.token, user: auth.user, layout };

    // Доступ: базовые роли ИЛИ персональный грант (проверяем на бэке)
    let allowed = ['ADMIN', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(auth.user.role);
    try {
      const me = await apiFetch('/api/payouts/me');
      allowed = !!me.allowed;
    } catch (_) {}
    if (!allowed) {
      toast('Доступ', 'Страница выплат недоступна', 'err');
      location.hash = '#/home';
      return;
    }

    const now = new Date();
    const state = {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      view: 'list',        // list | archive
      archiveYear: now.getFullYear(),
      data: null,
    };

    await layout(`
      <div class="panel">
        <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:8px">
            <button class="btn ghost" id="po_prev">‹</button>
            <span id="po_period" style="font-size:16px;font-weight:600;color:var(--t1);min-width:170px;text-align:center"></span>
            <button class="btn ghost" id="po_next">›</button>
            <span id="po_ready" style="margin-left:8px"></span>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn ghost" id="po_export">Excel</button>
            <button class="btn ghost" id="po_tab_list">Текущие выплаты</button>
            <button class="btn ghost" id="po_tab_archive">Архив</button>
          </div>
        </div>
        <div id="po_kpi" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:18px"></div>
        <div id="po_chart" style="margin-bottom:18px"></div>
        <div id="po_body"></div>
      </div>
    `, { title: title || 'Выплаты' });

    $('#po_prev').onclick = () => { shiftMonth(-1); };
    $('#po_next').onclick = () => { shiftMonth(1); };
    $('#po_tab_list').onclick = () => { state.view = 'list'; load(); };
    $('#po_tab_archive').onclick = () => { state.view = 'archive'; load(); };
    $('#po_export').onclick = () => downloadFile(`/api/payouts/export/${state.year}/${state.month}`, `payouts-${state.year}-${state.month}.xlsx`);

    async function shiftMonth(delta) {
      let m = state.month + delta, y = state.year;
      if (m < 1) { m = 12; y--; }
      if (m > 12) { m = 1; y++; }
      state.month = m; state.year = y;
      await load();
    }

    async function load() {
      $('#po_period').textContent = MONTHS[state.month - 1] + ' ' + state.year;
      if (state.view === 'list') await loadList(state);
      else await loadArchive(state);
    }

    await load();
    return () => {};
  }

  // ─────────────────────────────────────────────────────── список
  async function loadList(state) {
    const body = $('#po_body');
    body.innerHTML = '<div class="empty">Загрузка…</div>';
    let data;
    try {
      data = await apiFetch(`/api/payouts/list/${state.year}/${state.month}`);
    } catch (e) {
      body.innerHTML = `<div class="empty">Ошибка: ${esc(e.message)}</div>`;
      return;
    }
    state.data = data;

    // KPI + график сезона
    renderKpi(data);
    renderChart(state);

    // Готовность периода (мягкое предупреждение)
    const ready = $('#po_ready');
    if (data.ready_to_pay) {
      ready.innerHTML = '<span class="badge" style="background:var(--ok-bg);color:var(--ok-t)">Табель закрыт — можно платить</span>';
    } else {
      const msgs = (data.warnings || []).filter((w) => w.level === 'warn').map((w) => w.message).join('; ');
      ready.innerHTML = `<span class="badge" style="background:var(--warn-bg);color:var(--warn-t)">Внимание: ${esc(msgs || 'есть незакрытые данные')}</span>`;
    }

    const rows = data.rows || [];
    const payable = rows.filter((r) => r.to_pay > 0);
    const paidDown = rows.filter((r) => r.paid_this_period);

    // Раздел «К выплате» + «Выплаченные» (серые)
    let html = '';
    if (!rows.length) {
      html = '<div class="empty">Нет сотрудников к выплате за этот месяц</div>';
    } else {
      html += `<div class="tablewrap"><table class="asg" id="po_table">
        <thead><tr>
          <th>ФИО</th><th style="text-align:right">Остаток</th>
          <th style="text-align:right">Начислено</th><th style="text-align:right">Аванс</th>
          <th style="text-align:right">Удержание</th><th style="text-align:right">Оклад</th>
          <th style="text-align:right">К выплате</th><th></th>
        </tr></thead><tbody id="po_rows"></tbody></table></div>`;
    }
    body.innerHTML = html;

    if (rows.length) {
      const tbody = $('#po_rows');
      ctx._rows = rows;
      // активные — сверху (to_pay>0), потом нулевые, потом выплаченные (серые)
      const rest = rows.slice();
      const active = rest.filter((r) => r.to_pay > 0 && !r.paid_this_period);
      const zero = rest.filter((r) => r.to_pay <= 0 && !r.paid_this_period);
      const done = rest.filter((r) => r.paid_this_period);
      const order = [...active, ...zero, ...done];
      tbody.innerHTML = order.map((r) => rowHtml(r, done.includes(r))).join('');
      // кнопки
      $$('#po_rows .po-pay').forEach((b) => {
        b.onclick = () => openPayModal(parseInt(b.dataset.id, 10), null, state);
      });
      $$('#po_rows .po-confirm').forEach((b) => {
        b.onclick = () => confirmByManager(parseInt(b.dataset.pid, 10), state);
      });
    }
  }

  function rowHtml(r, isDone) {
    const dim = isDone ? 'opacity:.45;pointer-events:auto;' : '';
    const flag = r.paid_this_period
      ? (r.confirm === 'disputed' ? 'background:var(--err-bg);'
        : (r.confirm === 'confirmed' || r.confirm == null ? '' : (r.overdue ? 'background:var(--err-bg);' : 'background:var(--warn-bg);')))
      : (r.warning ? 'background:var(--warn-bg);' : '');
    const over = r.overpaid ? ' <span class="badge" style="background:var(--err-bg);color:var(--err-t)">переплата</span>' : '';
    // Бейдж подтверждения — только для выплат нового флоу (confirmation_status задан).
    const confirmBadge = r.paid_this_period && r.confirm != null && r.confirm !== 'confirmed'
      ? (r.confirm === 'disputed'
        ? '<span class="badge" style="background:var(--err-bg);color:var(--err-t)">спор</span>'
        : (r.overdue
          ? '<span class="badge" style="background:var(--err-bg);color:var(--err-t)">не подтвердил</span>'
          : '<span class="badge" style="background:var(--warn-bg);color:var(--warn-t)">ждёт подтверждения</span>'))
      : '';
    const btn = r.paid_this_period
      ? `<button class="btn ghost po-confirm" data-pid="${r.payment_id}" title="Подтвердить за рабочего">Подтвердить за рабочего</button>`
      : `<button class="btn primary po-pay" data-id="${r.employee_id}">Выплатить</button>`;
    return `<tr style="${dim}${flag}">
      <td>${esc(r.fio)}${over} ${confirmBadge}</td>
      <td style="text-align:right">${fmt(r.carry)}</td>
      <td style="text-align:right">${fmt(r.accrued)}</td>
      <td style="text-align:right">${fmt(r.advance)}</td>
      <td style="text-align:right">${fmt(r.penalty)}</td>
      <td style="text-align:right">${fmt(r.official)}</td>
      <td style="text-align:right;font-weight:700;color:${r.to_pay > 0 ? 'var(--ok-t)' : 'var(--t2)'}">${fmt(r.to_pay)}</td>
      <td style="text-align:right;white-space:nowrap">${btn}</td>
    </tr>`;
  }

  function renderKpi(data) {
    const t = data.totals || {};
    $('#po_kpi').innerHTML = `
      ${kpi('К выплате за месяц', fmtR(t.to_pay), 'var(--ok-bg)', 'var(--ok-t)')}
      ${kpi('Начислено', fmtR(t.accrued), 'var(--bg2)', 'var(--t1)')}
      ${kpi('Остаток с прошлых', fmtR(t.carry), 'var(--bg2)', 'var(--t2)')}
      ${kpi('Сотрудников', fmt(t.employees), 'var(--bg2)', 'var(--t2)')}
    `;
  }
  function kpi(label, val, bg, color) {
    return `<div style="padding:14px;background:${bg};border-radius:var(--r-md)">
      <div style="font-size:12px;color:${color};opacity:.8">${label}</div>
      <div style="font-size:20px;font-weight:700;color:${color}">${val}</div></div>`;
  }

  // ─────────────────────────────────────────── график по месяцам (canvas)
  async function renderChart(state) {
    const host = $('#po_chart');
    if (!host) return;
    host.innerHTML = `<div class="po-chart-box">
      <div class="po-chart-cap">Выплаты по месяцам ${state.year} года</div>
      <canvas class="po-canvas" height="120"></canvas></div>`;
    let series_ = new Array(12).fill(0);
    try {
      const series = (await apiFetch(`/api/payouts/monthly-series/${state.year}`)).series || [];
      series_ = series.map((s) => s.paid);
    } catch (_) { series_ = new Array(12).fill(0); }
    drawLine($('.po-canvas'), series_, MONTHS.map((x) => x.slice(0, 3)));
  }

  function drawLine(canvas, values, labels) {
    if (!canvas) return;
    const css = getComputedStyle(document.documentElement);
    const pick = (...names) => {
      for (const n of names) { const v = css.getPropertyValue(n).trim(); if (v) return v; }
      return 'transparent';
    };
    const cAccent = pick('--blue-l', '--blue', '--info-t');
    const cText = pick('--t3', '--t2');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600, h = 120;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const max = Math.max(1, ...values);
    const pad = 22, stepX = (w - pad * 2) / Math.max(1, values.length - 1);
    // линия
    g.strokeStyle = cAccent; g.lineWidth = 2; g.beginPath();
    values.forEach((v, i) => {
      const x = pad + i * stepX, y = (h - pad) - (v / max) * (h - pad * 2);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
    // точки + подписи
    g.fillStyle = cAccent;
    values.forEach((v, i) => {
      const x = pad + i * stepX, y = (h - pad) - (v / max) * (h - pad * 2);
      g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
      g.fillStyle = cText; g.font = '10px sans-serif'; g.textAlign = 'center';
      g.fillText(labels[i] || '', x, h - 6);
      g.fillStyle = cAccent;
    });
  }

  // ─────────────────────────────────────────────────── архив
  async function loadArchive(state) {
    const body = $('#po_body');
    body.innerHTML = '<div class="empty">Загрузка…</div>';
    let years = [];
    try { years = (await apiFetch('/api/payouts/archive/years')).years || []; } catch (_) {}
    if (!years.length) years = [new Date().getFullYear()];

    body.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
        <label style="color:var(--t2)">Год:</label>
        <select id="po_ay" class="input" style="max-width:120px">${years.map((y) => `<option ${y === state.archiveYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <label style="color:var(--t2)">Месяц:</label>
        <select id="po_am" class="input" style="max-width:160px">${MONTHS.map((m, i) => `<option value="${i + 1}" ${i + 1 === state.month ? 'selected' : ''}>${m}</option>`).join('')}</select>
      </div>
      <div id="po_arch_body"><div class="empty">Выберите период</div></div>`;

    async function loadArchMonth() {
      const y = parseInt($('#po_ay').value, 10), m = parseInt($('#po_am').value, 10);
      const host = $('#po_arch_body');
      host.innerHTML = '<div class="empty">Загрузка…</div>';
      try {
        const d = await apiFetch(`/api/payouts/archive/${y}/${m}`);
        if (!d.rows || !d.rows.length) { host.innerHTML = '<div class="empty">Нет выплат за этот период</div>'; return; }
        host.innerHTML = `<div class="tablewrap"><table class="asg"><thead><tr>
          <th>ФИО</th><th style="text-align:right">Выплачено</th><th>По типам</th></tr></thead>
          <tbody>${d.rows.map((r) => `<tr>
            <td><a href="javascript:void(0)" class="po-arch-open" data-id="${r.employee_id}">${esc(r.fio)}</a></td>
            <td style="text-align:right">${fmtR(r.total)}</td>
            <td style="color:var(--t2);font-size:12px">${Object.entries(r.by_type || {}).map(([k, v]) => `${typeLabel(k)}: ${fmt(v)}`).join(' · ')}</td>
          </tr>`).join('')}</tbody></table></div>`;
        $$('.po-arch-open').forEach((a) => { a.onclick = () => openEmployeeCard(parseInt(a.dataset.id, 10), y, m); });
      } catch (e) {
        host.innerHTML = `<div class="empty">Ошибка: ${esc(e.message)}</div>`;
      }
    }
    $('#po_ay').onchange = loadArchMonth;
    $('#po_am').onchange = loadArchMonth;
    await loadArchMonth();
  }

  function typeLabel(t) {
    return { salary: 'ЗП', advance: 'Аванс', bonus: 'Премия', penalty: 'Штраф', per_diem: 'Суточные' }[t] || t;
  }

  // ─────────────────────────────────────────────────── модалка выплаты
  async function openPayModal(employeeId, _unused, state) {
    let preview;
    try {
      preview = await apiFetch(`/api/payouts/preview/${employeeId}?year=${state.year}&month=${state.month}`);
    } catch (e) { toast('Ошибка', e.message, 'err'); return; }
    const row = preview.row || {};
    const isSe = !!preview.is_self_employed;
    const taxRate = preview.tax_rate || 0.06;

    let card = { total_paid_all_time: 0, avg_per_year: 0, by_year: [], current_year_months: [] };
    try { card = await apiFetch(`/api/payouts/employee/${employeeId}/summary`); } catch (_) {}

    const body = `
      <div class="po-modal">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px">
          ${kpi('Выплачено за всё время', fmtR(card.total_paid_all_time), 'var(--bg2)', 'var(--t1)')}
          ${kpi('Среднее за год', fmtR(card.avg_per_year), 'var(--bg2)', 'var(--t2)')}
          ${kpi('К выплате сейчас', fmtR(row.to_pay), 'var(--ok-bg)', 'var(--ok-t)')}
        </div>
        <div class="po-chart-box">
          <div class="po-chart-cap">Выплаты за ${state.year} год</div>
          <canvas class="po-canvas-emp"></canvas>
        </div>
        <div class="po-years"></div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <button class="btn ghost po-kind" data-kind="advance" style="flex:1">Аванс</button>
          <button class="btn ghost po-kind" data-kind="salary" style="flex:1">Зарплата</button>
        </div>
        <div class="po-form-grid">
          <div><div class="po-lbl">Сколько выплачиваем</div>
            <input class="input po-amount" type="number" min="0" step="0.01" placeholder="0"></div>
          <div class="po-transfer-wrap"><div class="po-lbl po-transfer-lbl">Сколько переводим</div>
            <input class="input po-transfer" type="number" min="0" step="0.01" placeholder="0"></div>
        </div>
        <div class="po-hint"></div>
        <div class="po-platforms"></div>
        <div class="po-preview"></div>
        <div class="po-actions">
          <button class="btn ghost po-cancel">Назад</button>
          <button class="btn primary po-do">Подтвердить и выплатить</button>
        </div>
      </div>`;

    let kind = 'advance';
    let confirmingOver = false;

    showModal({
      title: 'Выплата — ' + esc(preview.employee.fio || ''),
      html: body,
      wide: true,
      icon: '💰',
      onMount: ({ modal, body: mbody }) => mount(modal, mbody),
    });

    const q = (root, sel) => root.querySelector(sel);
    const qa = (root, sel) => Array.from(root.querySelectorAll(sel));

    function mount(modal, mbody) {
      if (!modal || !mbody) modal = document;
      const el = (sel) => qa(document, '.po-modal').slice(-1)[0].querySelector(sel);
      const root = qa(document, '.po-modal').slice(-1)[0];

      drawLine(q(root, '.po-canvas-emp'),
        (card.current_year_months || []).map((m) => m.paid),
        MONTHS.map((x) => x.slice(0, 3)));
      q(root, '.po-years').textContent = (card.by_year || []).map((y) => `${y.year}: ${fmtR(y.paid)}`).join(' · ') || 'за текущий год выплат ещё нет';

      const setKind = (k) => {
        kind = k;
        qa(root, '.po-kind').forEach((b) => { b.classList.toggle('active', b.dataset.kind === k); });
        q(root, '.po-transfer-wrap').style.display = isSe ? 'none' : 'block';
        recalc();
      };
      qa(root, '.po-kind').forEach((b) => { b.onclick = () => setKind(b.dataset.kind); });
      q(root, '.po-amount').oninput = recalc;
      q(root, '.po-transfer').oninput = recalc;
      renderPlatforms(root);
      setKind('advance');

      q(root, '.po-cancel').onclick = () => hideModal();
      const doBtn = q(root, '.po-do');
      doBtn.onclick = doPay;
    }

    function renderPlatforms(root) {
      const opts = isSe ? ['restaff', 'other'] : ['cash', 'card', 'bank'];
      q(root, '.po-platforms').innerHTML = `
        <div class="po-lbl">Площадка / способ выплаты</div>
        <select class="input po-platform">${opts.map((o) => `<option value="${o}">${PLATFORM_LABELS[o]}</option>`).join('')}</select>
        <div class="po-lbl" style="margin-top:8px">Кому идти за деньгами (ФИО)</div>
        <input class="input po-recipient" placeholder="например: Путков Д. / РП">`;
    }

    function recalc() {
      const root = qa(document, '.po-modal').slice(-1)[0];
      const pay = parseFloat(q(root, '.po-amount').value) || 0;
      let transfer = pay, tax = 0;
      if (isSe) { tax = Math.round(pay * taxRate * 100) / 100; transfer = Math.round((pay + tax) * 100) / 100; }
      else { const t = parseFloat(q(root, '.po-transfer').value); transfer = Number.isFinite(t) && t > 0 ? t : pay; }
      const earn = (row.to_pay || 0);
      const over = pay > earn && pay > 0;
      q(root, '.po-hint').innerHTML = over
        ? `<span style="color:var(--warn-t)">Сотрудник заработал ${fmtR(earn)} — выплата больше</span>`
        : `Остаток после выплаты: ${fmtR(Math.max(0, earn - pay))}`;
      q(root, '.po-preview').innerHTML = `
        <div>Выплачиваем: <b>${fmtR(pay)}</b></div>
        ${isSe ? `<div>Налог СЗ (${Math.round(taxRate * 100)}%): <b>${fmtR(tax)}</b></div>` : ''}
        <div>Переводим рабочему: <b style="color:var(--ok-t)">${fmtR(transfer)}</b></div>
        ${!isSe && transfer > pay ? `<div style="color:var(--warn-t)">Рабочий возвращает в кассу: ${fmtR(transfer - pay)}</div>` : ''}`;
      return { pay, transfer, tax, over };
    }

    async function doPay() {
      const root = qa(document, '.po-modal').slice(-1)[0];
      const doBtn = q(root, '.po-do');
      const { pay, transfer, over } = recalc();
      if (!(pay > 0)) { toast('Проверка', 'Введите сумму выплаты', 'err'); return; }
      if (over && !confirmingOver) {
        confirmingOver = true;
        toast('Внимание', 'Сотрудник столько не заработал. Нажмите «Подтвердить» ещё раз', 'warn');
        doBtn.classList.add('po-armed');
        return;
      }
      const payload = {
        employee_id: employeeId, year: state.year, month: state.month, kind,
        pay_amount: pay, confirm_over: over || undefined,
        payout_platform: q(root, '.po-platform') ? q(root, '.po-platform').value : null,
        payout_recipient_note: q(root, '.po-recipient') ? q(root, '.po-recipient').value : null,
      };
      if (!isSe) payload.transfer_amount = transfer;
      doBtn.disabled = true;
      try {
        const res = await apiPost('/api/payouts/pay', payload);
        toast('Готово', 'Выплата проведена: ' + fmtR(res.preview.pay_amount), 'ok');
        hideModal();
        await load();
      } catch (e) {
        if (e.data && e.data.requires_confirmation) { confirmingOver = true; toast('Внимание', e.data.message || 'Нужно подтверждение', 'warn'); }
        else { toast('Ошибка', e.message, 'err'); }
        doBtn.disabled = false;
      }
    }
  }

  // Карточка сотрудника (для архива)
  async function openEmployeeCard(employeeId, y, m) {
    let card, hist;
    try {
      card = await apiFetch(`/api/payouts/employee/${employeeId}/summary`);
      hist = await apiFetch(`/api/payouts/history/${employeeId}`);
    } catch (e) { toast('Ошибка', e.message, 'err'); return; }
    const ops = (hist.operations || []).filter((o) => o.pay_year === y && o.pay_month === m);
    const body = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:12px">
        ${kpi('За всё время', fmtR(card.total_paid_all_time), 'var(--bg2)', 'var(--t1)')}
        ${kpi('Среднее за год', fmtR(card.avg_per_year), 'var(--bg2)', 'var(--t2)')}
      </div>
      <div style="font-size:12px;color:var(--t2);margin-bottom:6px">Расчётная ведомость ${MONTHS[m - 1]} ${y}</div>
      <div class="tablewrap"><table class="asg"><thead><tr><th>Тип</th><th style="text-align:right">Сумма</th><th>Способ</th><th>Статус</th></tr></thead>
      <tbody>${ops.map((o) => `<tr><td>${typeLabel(o.type)}</td><td style="text-align:right">${fmtR(o.amount)}</td>
        <td>${esc(o.payment_method || '—')}${o.payout_platform ? ' · ' + esc(o.payout_platform) : ''}</td>
        <td>${esc(o.confirmation_status || o.status)}</td></tr>`).join('') || '<tr><td colspan="4">Нет операций</td></tr>'}</tbody></table></div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px">
        <button class="btn ghost po-statement">Скачать расчётный лист (Excel)</button>
      </div>`;
    const overlay = showModal({ title: esc(card.employee?.fio || 'Сотрудник'), html: body, wide: true });
    const sb = overlay && overlay.querySelector ? overlay.querySelector('.po-statement') : null;
    if (sb) sb.onclick = () => downloadFile(`/api/payouts/statement/${employeeId}/${y}/${m}`, `statement-${employeeId}-${y}-${m}.xlsx`);
  }

  async function confirmByManager(paymentId, state) {
    try {
      await apiPost(`/api/payouts/${paymentId}/confirm-by-manager`, {});
      toast('Готово', 'Подтверждено за рабочего', 'ok');
      await load();
    } catch (e) { toast('Ошибка', e.message, 'err'); }
  }

  return { render };
})();
