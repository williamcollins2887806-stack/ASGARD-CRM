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
  const payoutLabel = (p) => PLATFORM_LABELS[p] || p;

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
      html = `<div class="tablewrap"><table class="asg" id="po_table">
        <thead><tr>
          <th>ФИО</th><th style="text-align:right">Остаток</th>
          <th style="text-align:right">Начислено</th><th style="text-align:right">Аванс</th>
          <th style="text-align:right">Удержание</th><th style="text-align:right">Оклад</th>
          <th style="text-align:right">К выплате</th><th></th>
        </tr></thead><tbody id="po_rows"></tbody></table></div>`;
      body.innerHTML = html;

      const tbody = $('#po_rows');
      const active = rows.filter((r) => r.to_pay > 0 && !r.paid_this_period);
      const zero = rows.filter((r) => r.to_pay <= 0 && !r.paid_this_period);
      const done = rows.filter((r) => r.paid_this_period);
      tbody.innerHTML = [...active, ...zero, ...done].map(rowHtml).join('');

      // Кнопки — внутри таблицы (контейнер), не по document.
      const root = $('#po_body');
      Array.from(root.querySelectorAll('.po-pay')).forEach((b) => {
        b.onclick = () => openPayModal(parseInt(b.dataset.id, 10));
      });
      Array.from(root.querySelectorAll('.po-confirm')).forEach((b) => {
        b.onclick = () => confirmByManager(parseInt(b.dataset.pid, 10));
      });
    }
    if (!rows.length) body.innerHTML = html;
  }

  function rowHtml(r) {
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
      else confirmBadge = '<span class="badge warning">ждёт подтверждения</span>';
    }
    // «Подтвердить за рабочего» — только для ещё не подтверждённых (awaiting).
    const canConfirm = isDone && r.confirm !== 'confirmed';
    const btn = canConfirm
      ? `<button class="btn ghost po-confirm" data-pid="${r.payment_id}">Подтвердить за рабочего</button>`
      : (isDone ? '' : `<button class="btn primary po-pay" data-id="${r.employee_id}">Выплатить</button>`);
    return `<tr class="${cls} ${flag}">
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
    $('#po_kpi').innerHTML = [
      kpi('К выплате за месяц', fmtR(t.to_pay), true),
      kpi('Начислено', fmtR(t.accrued), false),
      kpi('Остаток с прошлых', fmtR(t.carry), false),
      kpi('Сотрудников', fmt(t.employees), false),
    ].join('');
  }
  function kpi(label, val, accent) {
    return `<div class="po-kpi${accent ? ' po-kpi--accent' : ''}">
      <div class="po-kpi-label">${label}</div>
      <div class="po-kpi-value">${val}</div></div>`;
  }

  // ─────────────────────────────────────────── график по месяцам (canvas)
  async function renderChart(state) {
    const host = $('#po_chart');
    if (!host) return;
    host.innerHTML = `<div class="po-chart-box">
      <div class="po-chart-cap">Выплаты по месяцам ${state.year} года</div>
      <canvas class="po-canvas" height="120"></canvas></div>`;
    let series_;
    try {
      const series = (await apiFetch(`/api/payouts/monthly-series/${state.year}`)).series || [];
      series_ = series.map((s) => s.paid);
    } catch (_) { series_ = new Array(12).fill(0); }
    drawLine(host.querySelector('.po-canvas'), series_, MONTHS.map((x) => x.slice(0, 3)));
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
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const max = Math.max(1, ...values);
    const pad = 22, stepX = (w - pad * 2) / Math.max(1, values.length - 1);
    g.strokeStyle = cAccent; g.lineWidth = 2; g.beginPath();
    values.forEach((v, i) => {
      const x = pad + i * stepX, y = (h - pad) - (v / max) * (h - pad * 2);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
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

    let card = { total_paid_all_time: 0, avg_per_year: 0, by_year: [], current_year_months: [] };
    try { card = await apiFetch(`/api/payouts/employee/${employeeId}/summary`); } catch (_) { /* мягкий фолбэк: данные необязательны */ }

    const body = `
      <div class="po-modal">
        <div class="po-kpi-grid" style="margin-bottom:0">
          ${kpi('Выплачено за всё время', fmtR(card.total_paid_all_time), false)}
          ${kpi('Среднее за год', fmtR(card.avg_per_year), false)}
          ${kpi('К выплате сейчас', fmtR(row.to_pay), true)}
        </div>
        <div class="po-chart-box">
          <div class="po-chart-cap">Выплаты за ${state.year} год</div>
          <canvas class="po-canvas-emp" height="110"></canvas>
        </div>
        <div class="po-years"></div>

        <div class="po-kind-row">
          <span class="po-kind-label">Что выплачиваем:</span>
          <div class="po-kind-group">
            <button type="button" class="btn ghost po-kind" data-kind="advance">Аванс</button>
            <button type="button" class="btn ghost po-kind" data-kind="salary">Зарплата</button>
          </div>
        </div>

        <div class="po-form-grid">
          <div>
            <label class="po-lbl po-amount-label" for="po_amount">Сколько выплачиваем</label>
            <input class="input po-amount" id="po_amount" type="number" min="0" step="0.01" placeholder="0" inputmode="decimal">
          </div>
          <div class="po-transfer-wrap">
            <label class="po-lbl" for="po_transfer">Сколько переводим (рабочему на руки)</label>
            <input class="input po-transfer" id="po_transfer" type="number" min="0" step="0.01" placeholder="0" inputmode="decimal">
          </div>
        </div>
        <div class="po-quick" role="group" aria-label="Быстрый выбор суммы">
          <button type="button" class="po-chip" data-quick="all" aria-label="Вся сумма к выплате">Всё к выплате</button>
          <button type="button" class="po-chip" data-quick="half" aria-label="Половина суммы">Половина</button>
          <button type="button" class="po-chip" data-quick="clear" aria-label="Очистить суммы">Очистить</button>
        </div>

        <div class="po-hint" aria-live="polite"></div>

        <div class="po-method-block">
          <div class="po-lbl">Способ выплаты</div>
          <div class="po-method"><span class="po-method-icon">${isSe ? '📱' : '💵'}</span><span class="po-method-text"></span></div>
          <div class="po-recipient-wrap">
            <label class="po-lbl" for="po_recipient">Кому идти за деньгами (ФИО)</label>
            <input class="input po-recipient" id="po_recipient" placeholder="например: Путков Д. / РП">
          </div>
        </div>

        <div class="po-preview" aria-live="polite"></div>

        <div class="po-actions">
          <button type="button" class="btn ghost po-cancel">Отмена</button>
          <button type="button" class="btn primary po-do">Подтвердить и выплатить</button>
        </div>
      </div>`;

    let kind = 'advance';
    let armedOver = false;        // подтверждение превышения заработка
    let armedDuplicate = false;   // подтверждение повторной выплаты за период

    const KIND_LABEL = { advance: 'Аванс', salary: 'Зарплата' };
    const methodText = isSe
      ? 'Перевод через СЗ-сервис (ReStaff и др.) — налог 6% сверху'
      : 'Выплата наличными (способ определяется автоматически)';

    // Контракт showModal: все элементы ищем внутри возвращённого overlay (D-226).
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

      drawLine(q('.po-canvas-emp'),
        (card.current_year_months || []).map((m) => m.paid),
        MONTHS.map((x) => x.slice(0, 3)));
      q('.po-years').textContent = (card.by_year || []).length
        ? (card.by_year || []).map((y) => `${y.year}: ${fmtR(y.paid)}`).join(' · ')
        : 'выплат за прошлые годы нет';
      q('.po-method-text').textContent = methodText;

      const setKind = (k) => {
        kind = k;
        qa('.po-kind').forEach((b) => b.classList.toggle('active', b.dataset.kind === k));
        // «Сколько переводим» имеет смысл только для НЕ-СЗ (там возможен возврат в кассу).
        q('.po-transfer-wrap').style.display = isSe ? 'none' : 'block';
        // «Кому идти за деньгами» — для наличных (не-СЗ).
        q('.po-recipient-wrap').style.display = isSe ? 'none' : 'block';
        recalc(root);
      };
      qa('.po-kind').forEach((b) => { b.onclick = () => setKind(b.dataset.kind); });
      q('.po-amount').oninput = () => recalc(root);
      q('.po-transfer').oninput = () => recalc(root);
      // Быстрый выбор суммы
      qa('.po-chip').forEach((b) => {
        b.onclick = () => {
          const qy = b.dataset.quick;
          if (qy === 'clear') { q('.po-amount').value = ''; q('.po-transfer').value = ''; }
          else if (qy === 'all') { q('.po-amount').value = String(Math.max(0, row.to_pay || 0)); q('.po-transfer').value = ''; }
          else if (qy === 'half') { q('.po-amount').value = String(Math.round((row.to_pay || 0) / 2)); q('.po-transfer').value = ''; }
          recalc(root);
        };
      });
      q('.po-cancel').onclick = () => hideModal();
      q('.po-do').onclick = () => doPay(root);
      setKind('advance');
    }

    function recalc(root) {
      if (!root) return { pay: 0, transfer: 0, over: false };
      const pay = parseFloat(root.querySelector('.po-amount').value) || 0;
      let transfer = pay, tax = 0;
      if (isSe) {
        tax = Math.round(pay * taxRate * 100) / 100;
        transfer = Math.round((pay + tax) * 100) / 100;
      } else {
        const t = parseFloat(root.querySelector('.po-transfer').value);
        transfer = Number.isFinite(t) && t > 0 ? t : pay;
      }
      const earn = (row.to_pay || 0);
      const over = pay > earn && pay > 0;
      const after = Math.round((earn - pay) * 100) / 100;

      const hint = root.querySelector('.po-hint');
      if (over) hint.innerHTML = `<span class="po-warn">Сотрудник заработал ${fmtR(earn)} — выплата больше. Нужно подтверждение.</span>`;
      else if (pay > 0) hint.innerHTML = `После выплаты останется: <b>${fmtR(Math.max(0, after))}</b>`;
      else hint.innerHTML = '';

      const rows = [];
      rows.push(`<div class="po-preview-row"><span>Выплачиваем (${KIND_LABEL[kind]})</span><b>${fmtR(pay)}</b></div>`);
      if (isSe) {
        rows.push(`<div class="po-preview-row"><span>Налог СЗ (${Math.round(taxRate * 100)}%)</span><b>${fmtR(tax)}</b></div>`);
        rows.push(`<div class="po-preview-row po-preview-total"><span>К переводу на СЗ-сервис</span><b class="po-ok">${fmtR(transfer)}</b></div>`);
      } else {
        rows.push(`<div class="po-preview-row po-preview-total"><span>Переводим рабочему</span><b class="po-ok">${fmtR(transfer)}</b></div>`);
        if (transfer > pay) {
          rows.push(`<div class="po-preview-row"><span>Рабочий возвращает в кассу</span><b class="po-warn">${fmtR(transfer - pay)}</b></div>`);
        }
      }
      root.querySelector('.po-preview').innerHTML = rows.join('');
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
        toast('Внимание', 'Сотрудник столько не заработал. Нажмите «Подтвердить» ещё раз', 'warn');
        return;
      }
      const payload = {
        employee_id: employeeId, year: state.year, month: state.month, kind,
        pay_amount: pay, confirm_over: over || undefined,
        confirm_duplicate: armedDuplicate || undefined,
        // Способ определяется системой: СЗ → restaff, иначе → cash.
        payout_platform: isSe ? 'restaff' : 'cash',
        payout_recipient_note: (!isSe && root.querySelector('.po-recipient'))
          ? (root.querySelector('.po-recipient').value || null) : null,
      };
      if (!isSe) payload.transfer_amount = transfer;
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
          toast('Внимание', e.data.message || 'Выплата за этот период уже была. Нажмите «Подтвердить» ещё раз', 'warn');
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

  // Карточка сотрудника (для архива) + экспорт расчётного листа
  async function openEmployeeCard(employeeId, y, m) {
    let card, hist;
    try {
      card = await apiFetch(`/api/payouts/employee/${employeeId}/summary`);
      hist = await apiFetch(`/api/payouts/history/${employeeId}`);
    } catch (e) { toast('Ошибка', e.message, 'err'); return; }
    const ops = (hist.operations || []).filter((o) => o.pay_year === y && o.pay_month === m);
    const body = `
      <div class="po-kpi-grid" style="margin-bottom:12px">
        ${kpi('За всё время', fmtR(card.total_paid_all_time), false)}
        ${kpi('Среднее за год', fmtR(card.avg_per_year), false)}
      </div>
      <div style="font-size:12px;color:var(--t2);margin-bottom:6px">Расчётная ведомость ${MONTHS[m - 1]} ${y}</div>
      <div class="tablewrap"><table class="asg"><thead><tr><th>Тип</th><th style="text-align:right">Сумма</th><th>Способ</th><th>Статус</th></tr></thead>
      <tbody>${ops.map((o) => `<tr><td>${typeLabel(o.type)}</td><td style="text-align:right">${fmtR(o.amount)}</td>
        <td>${esc(o.payment_method || '—')}${o.payout_platform ? ' · ' + esc(payoutLabel(o.payout_platform)) : ''}</td>
        <td>${esc(o.confirmation_status || o.status)}</td></tr>`).join('') || '<tr><td colspan="4">Нет операций</td></tr>'}</tbody></table></div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px">
        <button class="btn ghost po-statement">Скачать расчётный лист (Excel)</button>
      </div>`;
    const overlay = showModal({ title: esc(card.employee?.fio || 'Сотрудник'), html: body, wide: true });
    const sb = overlay ? overlay.querySelector('.po-statement') : null;
    if (sb) sb.onclick = () => downloadFile(`/api/payouts/statement/${employeeId}/${y}/${m}`, `statement-${employeeId}-${y}-${m}.xlsx`);
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
