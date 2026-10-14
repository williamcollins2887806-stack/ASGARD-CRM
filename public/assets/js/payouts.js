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
    if (!r.ok) {
      const err = new Error(data.message || data.error || ('HTTP ' + r.status));
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
          <th class="po-num">№</th>
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
        const sep = (i === active.length && done.length) ? '<tr class="po-sep"><td colspan="9">Выплаченные</td></tr>' : '';
        return sep + rowHtml(r, i + 1);
      }).join('');
      // Нумерация: активные = 1..N; выплаченные — продолжают список
      tbody.innerHTML = html2;

      // Кнопки — внутри таблицы (контейнер), не по document.
      const root = $('#po_body');
      Array.from(root.querySelectorAll('.po-pay')).forEach((b) => {
        b.onclick = () => openPayModal(parseInt(b.dataset.id, 10));
      });
      Array.from(root.querySelectorAll('.po-confirm')).forEach((b) => {
        b.onclick = () => confirmByManager(parseInt(b.dataset.pid, 10));
      });
      Array.from(root.querySelectorAll('.po-revert')).forEach((b) => {
        b.onclick = () => revertPayout(parseInt(b.dataset.pid, 10));
      });
    }
    if (!rows.length) body.innerHTML = html;
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
    // Кнопки: активному всегда доступна «Выплатить» (можно доплатить после
    // аванса, баг 14.10.2026). Если за период уже была выплата, дополнительно
    // показываем подтверждение и отмену.
    const hadPayment = !!r.has_payment_this_period;
    let btn = '';
    if (!isDone) {
      btn = `<button class="btn primary po-pay" data-id="${r.employee_id}">Выплатить</button> `;
      if (hadPayment && r.payment_id) {
        if (r.confirm !== 'confirmed') {
          btn += `<button class="btn ghost po-confirm" data-pid="${r.payment_id}">Подтвердить за рабочего</button> `;
        }
        btn += `<button class="btn ghost danger po-revert" data-pid="${r.payment_id}" title="Удалить выплату и вернуть в реестр">Отменить</button>`;
      }
    } else {
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
    return `<tr class="${cls} ${flag}">
      <td class="po-num">${n}</td>
      <td>${esc(r.fio)}${over} ${confirmBadge}</td>
      <td style="text-align:right">${fmt(carryShown)}</td>
      <td style="text-align:right">${fmt(r.accrued)}</td>
      <td style="text-align:right">${fmt(advanceShown)}</td>
      <td style="text-align:right">${fmt(r.penalty)}</td>
      <td style="text-align:right">${fmt(r.official)}</td>
      <td style="text-align:right;font-weight:700;color:${r.to_pay > 0 ? 'var(--ok-t)' : 'var(--t2)'}">${fmt(r.to_pay)}</td>
      <td style="text-align:right;white-space:nowrap">${btn}</td>
    </tr>`;
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
            <input class="input po-recipient" id="po_recipient" placeholder="например: Путков Д. / РП">
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

        <div class="po-actions">
          <button type="button" class="btn ghost po-cancel">Отмена</button>
          <button type="button" class="btn primary po-do">Подтвердить и выплатить</button>
        </div>
      </div>`;

    let kind = 'advance';
    let armedOver = false;
    let armedDuplicate = false;
    let official = false; // галка «переводим официально» (только для не-СЗ)

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

      const setKind = (k) => {
        kind = k;
        qa('.po-kind').forEach((b) => b.classList.toggle('active', b.dataset.kind === k));
        q('.po-transfer-wrap').style.display = (isSe || official) ? 'none' : 'block';
        q('.po-recipient-wrap').style.display = (isSe || official) ? 'none' : 'block';
        recalc(root);
      };
      qa('.po-kind').forEach((b) => { b.onclick = () => setKind(b.dataset.kind); });
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
      q('.po-do').onclick = () => doPay(root);
      // Сразу заполняем суммой «к выплате», чтобы предпросмотр был виден
      // без единого ввода (иначе Дима не видел, что получит рабочий).
      if (toPay > 0) q('.po-amount').value = String(toPay);
      setKind('advance');
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
