/**
 * ASGARD CRM — Планирование выплат (1-е число) + График платежей (V391)
 * ═══════════════════════════════════════════════════════════════════════════
 * Порт рендера prototypes/payout-approvals (1:1): таблица распределения сумм
 * и дат с лимитом НПД, массовые действия, согласование; график по дням месяца
 * (СЗ / наличка / НДФЛ) с суммами без наведения и модалкой «кому платим».
 *
 * Монтируется в панель вкладки «Планирование на 1-е» экрана согласований.
 */
window.AsgardPayoutPlan = (function () {
  'use strict';
  const { toast, esc, money, showModal, hideModal } = AsgardUI;
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const fmt = (n) => (n == null ? '—' : money(n));
  const fmtR = (n) => (n == null ? '—' : money(n) + ' ₽');
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const moneyShort = (v) => {
    const n = num(v);
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'М';
    if (Math.abs(n) >= 1e3) return Math.round(n / 1e3) + 'К';
    return String(Math.round(n));
  };

  let st = {
    year: new Date().getFullYear(),
    month: (new Date().getMonth() + 1),
    data: null,
    calc: null,
    chartYM: null,
    host: null,
  };

  function headers() {
    const auth = typeof AsgardAuth !== 'undefined' ? AsgardAuth.getAuth() : null;
    return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (auth?.token || localStorage.getItem('asgard_token') || '') };
  }
  async function api(url, opts) {
    const r = await fetch(url, Object.assign({ headers: headers() }, opts || {}));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Показываем и «что случилось» (message), и «что делать» (hint).
      const parts = [];
      if (d.message) parts.push(String(d.message));
      else if (d.error && typeof d.error === 'string') parts.push(String(d.error));
      if (d.hint) parts.push(String(d.hint));
      throw new Error(parts.length ? parts.join(' ') : 'Ошибка запроса (' + r.status + '). Повторите действие.');
    }
    return d;
  }
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  };
  const peopleWord = (n) => plural(n, 'получатель', 'получателя', 'получателей');
  const initials = (fio) => {
    const p = String(fio || '').trim().split(/\s+/);
    return ((p[0] || '')[0] || '') + ((p[1] || '')[0] || '');
  };
  const tagOf = (row) => (row.is_self_employed ? '<span class="pp-tag pp-tag--se">СЗ</span>'
    : (row.is_officially_employed ? '<span class="pp-tag pp-tag--ndfl">НДФЛ +15%</span>'
      : '<span class="pp-tag pp-tag--cash">Наличные</span>'));

  // ─── Точка входа (вкладка «Планирование на 1-е») ────────────────────────
  async function renderInto(panel) {
    st.host = panel;
    // Период планирования — следующий месяц (план на 1-е число).
    const now = new Date();
    if (!st.data) {
      st.year = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
      st.month = now.getMonth() === 11 ? 1 : now.getMonth() + 2;
    }
    panel.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Загрузка плана…</div>';
    try {
      st.data = await api(`/api/payout-plan/${st.year}/${st.month}`);
      st.calc = st.data.calc || null;   // коэффициенты с сервера (единый источник)
    } catch (e) {
      panel.innerHTML = `<div class="empty-state">Ошибка: ${esc(e.message)}</div>`;
      return;
    }
    render();
  }

  function render() {
    const panel = st.host;
    if (!panel || !st.data) return;
    const P = st.data;
    const rows = (P.rows || []).map(rowHtml).join('');
    const t = P.totals || {};
    const planSum = (P.rows || []).reduce((s, r) => s + num(r.to_transfer), 0);
    const approvedSum = (P.rows || []).filter((r) => r.approved).reduce((s, r) => s + num(r.to_transfer), 0);
    const approvedCnt = (P.rows || []).filter((r) => r.approved).length;
    const pct = planSum ? Math.round(approvedSum / planSum * 100) : 0;

    panel.innerHTML = `
      <div class="po-head"><div>
        <div class="po-head-title">Планирование выплат · ${MONTHS[st.month - 1]} ${st.year}</div>
        <div class="po-head-sub">1-е число · табель закрыт. Директор распределяет суммы и даты, затем согласует.</div>
      </div>
      <div class="po-head-actions">
        <button class="btn ghost sm" id="pp_chart_open">📊 График платежей</button>
      </div></div>

      <div class="pl-dash">
        <div class="pl-dash__i"><span class="pl-dash__l">К выплате всего</span>
          <b class="num">${fmtR(t.to_pay)}</b>
          <span class="pl-dash__c">Лимит НПД ${fmtR(P.monthly_limit)} · строк ${t.employees || 0}</span></div>
        <div class="pl-dash__i pl-dash__i--ok"><span class="pl-dash__l">Согласовано</span>
          <b class="num">${fmtR(approvedSum)}</b>
          <div class="ap-prog mt-2"><div class="ap-prog__bar"><div class="ap-prog__fill" style="width:${pct}%"></div></div>
          <div class="ap-prog__t">${approvedCnt}/${(P.rows || []).length}</div></div></div>
      </div>

      <div class="pl-bulk">
        <div class="pl-bulk__t">Применить ко всем</div>
        <div class="pl-bulk__row">
          <label class="pl-bulk__f"><span class="po-lbl">Дата перевода</span>
            <input class="input" type="date" id="pl_bulk_date"></label>
          <label class="pl-bulk__f"><span class="po-lbl">Сумма</span>
            <select class="input" id="pl_bulk_mode">
              <option value="max">по максимуму (СЗ — до лимита, наличка/НДФЛ — весь долг)</option>
              <option value="debt">вся сумма к выплате</option>
              <option value="half">половина</option>
            </select></label>
          <button class="btn primary" id="pl_apply_all">Применить ко всем</button>
          <button class="btn gold" id="pl_approve_all">Согласовать всех заполненных</button>
        </div>
      </div>

      <div class="tablewrap"><table class="asg po-table pl-table">
        <thead><tr>
          <th class="po-chkcell"></th><th>ФИО · способ · через кого</th><th>Лимит НПД (месяц)</th>
          <th class="right">К выплате</th><th class="right">Налог / сбор</th>
          <th class="right">Сумма к переводу</th><th class="right">Человеку придёт</th>
          <th class="right">Дата перевода</th><th>Комментарий директора</th><th></th>
        </tr></thead>
        <tbody id="pl_rows">${rows || '<tr><td colspan="10">Нет данных за период</td></tr>'}</tbody>
      </table></div>

      <div class="dim mt-3" style="font-size:11.5px">
        После согласования выплаты попадают Диме Путкову в корзину — он нажимает «Выплатить».
        Дата перевода — не раньше указанной. СЗ: рабочему ×1.064, всего к переводу ×(1.064/0.96)×1.22 (НДС 22% + сбор площадки). НДФЛ: +15%.
      </div>`;

    wire();
  }

  function rowHtml(r) {
    const limitCell = r.is_self_employed
      ? (r.se_can_exceed
        ? '<span class="dim" style="font-size:11.5px">лимит не ограничен</span>'
        : `<div class="pl-lim"><div class="pl-lim__bar"><i style="width:${r.se_limit ? Math.round(Math.min(100, (num(r.se_remaining) / num(r.se_limit)) * 100)) : 0}%"></i></div>
           <span class="pl-lim__t">${fmtR(r.se_remaining)} свободно из ${fmt(r.se_limit)}</span></div>`)
      : '<span class="dim" style="font-size:11.5px">без лимита НПД</span>';
    const via = r.is_self_employed
      ? (r.payee_employee_id ? 'получатель НПД' : 'на себя')
      : (r.is_officially_employed ? 'счёт физлица' : 'касса');
    // Налог/сбор и «человеку придёт» — считаем по той же формуле, что сервер
    // (payout-calc.js): СЗ ×1.064 рабочему и ×(1.064/0.96)×1.22 к переводу,
    // НДФЛ +15%, наличка 1:1. Коэффициенты приходят с бэка (calc в списке).
    const c = calcRow(r, num(r.to_transfer));
    return `<tr class="${r.approved ? 'pl-row-on' : ''}">
      <td class="po-chkcell"><span class="po-chk ${r.approved ? 'is-on' : ''}" role="checkbox" aria-checked="${r.approved}"></span></td>
      <td><div class="po-fio"><div class="po-fio__name">${esc(r.fio)}</div>
        <div class="po-fio__badges mt-2">${tagOf(r)}<span class="dim" style="font-size:11px">${esc(via)}</span></div></div></td>
      <td>${limitCell}</td>
      <td class="right num">${fmt(r.to_pay)}</td>
      <td class="right"><span class="num">${fmt(c.tax)}</span>
        <div class="pl-max">${r.is_self_employed ? 'сбор+НДС' : (r.is_officially_employed ? '+15%' : '1:1')}</div></td>
      <td class="right">
        <input class="input pl-amount num" type="number" step="1000" min="0" max="${r.max_amount}"
          value="${r.to_transfer}" data-pl-amt="${r.employee_id}" placeholder="0">
        <div class="pl-max">макс. ${fmt(r.max_amount)}</div>
      </td>
      <td class="right"><span class="num" style="color:var(--ok-t)">${fmt(c.got)}</span></td>
      <td class="right"><input class="input pl-date" type="date" value="${r.pay_date || ''}" data-pl-date="${r.employee_id}"></td>
      <td><input class="input pl-cmt" placeholder="комментарий" value="${esc(r.comment || '')}" data-pl-cmt="${r.employee_id}"></td>
      <td class="right">${r.approved
        ? `<span class="badge success">согласовано</span> <button class="btn ghost sm" data-pl-unapprove="${r.employee_id}">Снять</button>`
        : `<button class="btn ok sm" data-pl-approve="${r.employee_id}">Согласовать</button>`}</td>
    </tr>`;
  }

  /** Расчёт по строке: рабочему придёт / налог и сбор / всего к переводу.
   *  Коэффициенты — с сервера (calc), чтобы фронт не дублировал формулы. */
  function calcRow(r, pay) {
    const c = st.calc || {};
    const seInfo = num(c.se_info_coef) || 1.064;
    const seTransfer = num(c.se_transfer_coef) || (1.064 / 0.96) * 1.22;
    const ndflRate = num(c.official_markup_rate) || 0.15;
    if (r.is_self_employed) {
      const got = r2(pay * seInfo), total = r2(pay * seTransfer);
      return { got, total, tax: r2(total - got) };
    }
    if (r.is_officially_employed) {
      const got = r2(pay * (1 + ndflRate));
      return { got, total: got, tax: r2(got - pay) };
    }
    return { got: r2(pay), total: r2(pay), tax: 0 };
  }

  function wire() {
    const panel = st.host;
    const co = panel.querySelector('#pp_chart_open');
    if (co) co.onclick = () => openChart(panel);

    const applyAll = panel.querySelector('#pl_apply_all');
    if (applyAll) applyAll.onclick = async () => {
      const dateEl = panel.querySelector('#pl_bulk_date');
      const mode = panel.querySelector('#pl_bulk_mode').value;
      const items = (st.data.rows || []).map((r) => {
        let amt = num(r.to_transfer);
        if (mode === 'max') amt = num(r.max_amount);
        else if (mode === 'debt') amt = Math.max(0, num(r.to_pay));
        else if (mode === 'half') amt = Math.round((num(r.max_amount) || num(r.to_pay)) / 2);
        return { employee_id: r.employee_id, to_transfer: amt, pay_date: dateEl.value || null };
      });
      try {
        const res = await api('/api/payout-plan/save', { method: 'POST', body: JSON.stringify({ year: st.year, month: st.month, items }) });
        toast('Применено', res.message || 'Суммы распределены', res.capped ? 'warn' : 'ok');
        await reload();
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    };

    const approveAll = panel.querySelector('#pl_approve_all');
    if (approveAll) approveAll.onclick = async () => {
      try {
        await saveAll();  // сначала фиксируем текущие значения полей
        const res = await api(`/api/payout-plan/${st.year}/${st.month}/approve`, { method: 'POST', body: JSON.stringify({}) });
        toast('Согласовано', `Позиций: ${res.approved} — ушли Диме в корзину`, 'ok');
        await reload();
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    };

    // автосохранение значений при изменении поля
    Array.from(panel.querySelectorAll('[data-pl-amt],[data-pl-date],[data-pl-cmt]')).forEach((el) => {
      el.onchange = () => saveRow(parseInt(el.dataset.plAmt || el.dataset.plDate || el.dataset.plCmt, 10));
    });
    // точечное согласование строки
    Array.from(panel.querySelectorAll('[data-pl-approve]')).forEach((b) => {
      b.onclick = async () => {
        const empId = parseInt(b.dataset.plApprove, 10);
        try {
          await api('/api/payout-plan/save', { method: 'POST', body: JSON.stringify({ year: st.year, month: st.month, items: [rowValues(empId)] }) });
          await api(`/api/payout-plan/${st.year}/${st.month}/approve`, { method: 'POST', body: JSON.stringify({ employee_ids: [empId] }) });
          toast('Согласовано', 'Строка ушла Диме в корзину', 'ok');
          await reload();
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      };
    });
    // снять согласование строки (нужно, если поняли — сумму/дату надо поправить)
    Array.from(panel.querySelectorAll('[data-pl-unapprove]')).forEach((b) => {
      b.onclick = async () => {
        const empId = parseInt(b.dataset.plUnapprove, 10);
        try {
          await api(`/api/payout-plan/${st.year}/${st.month}/unapprove`, { method: 'POST', body: JSON.stringify({ employee_ids: [empId] }) });
          toast('Снято', 'Согласование отозвано — правьте и согласуйте снова', 'warn');
          await reload();
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      };
    });
  }

  function rowValues(employeeId) {
    const panel = st.host;
    const amt = panel.querySelector(`[data-pl-amt="${employeeId}"]`);
    const date = panel.querySelector(`[data-pl-date="${employeeId}"]`);
    const cmt = panel.querySelector(`[data-pl-cmt="${employeeId}"]`);
    return {
      employee_id: employeeId,
      to_transfer: amt ? num(amt.value) : 0,
      pay_date: date && date.value ? date.value : null,
      comment: cmt ? (cmt.value || null) : null,
    };
  }

  async function saveRow(employeeId) {
    try {
      const res = await api('/api/payout-plan/save', {
        method: 'POST', body: JSON.stringify({ year: st.year, month: st.month, items: [rowValues(employeeId)] }),
      });
      if (res.capped) toast('Лимит НПД', 'Сумма ограничена остатком лимита', 'warn');
      await reload();
    } catch (e) { toast('Ошибка', e.message, 'err'); }
  }

  async function saveAll() {
    const items = (st.data.rows || []).map((r) => rowValues(r.employee_id));
    return api('/api/payout-plan/save', { method: 'POST', body: JSON.stringify({ year: st.year, month: st.month, items }) });
  }

  async function reload() {
    st.data = await api(`/api/payout-plan/${st.year}/${st.month}`);
    render();
  }

  // ═══ ГРАФИК ПЛАТЕЖЕЙ ═════════════════════════════════════════════════════
  async function openChart(panel) {
    st.chartYM = { year: st.year, month: st.month };
    const host = document.createElement('div');
    host.className = 'pp-ov';
    host.style.zIndex = '95';
    host.innerHTML = `<div style="position:fixed;inset:0;display:grid;place-items:center;padding:20px;overflow:auto">
      <div style="width:min(1240px,100%);background:var(--bg1);border:1px solid var(--brd);border-radius:16px;box-shadow:var(--shadow-xl);padding:22px" id="pc_host"></div></div>`;
    document.body.appendChild(host);
    const close = () => host.remove();
    host.addEventListener('click', (e) => { if (e.target === host || e.target.closest('[data-pc-close]')) close(); });
    await drawChart(host.querySelector('#pc_host'));
  }

  async function drawChart(root) {
    const ym = st.chartYM;
    let data;
    try {
      data = await api(`/api/payout-plan/schedule/${ym.year}/${ym.month}`);
    } catch (e) { root.innerHTML = `<div class="empty-state">Ошибка: ${esc(e.message)}</div>`; return; }
    const days = data.days || [];
    const t = data.totals || {};
    let max = 1;
    days.forEach((d) => { max = Math.max(max, d.se + d.cash + d.ndfl); });

    const bars = days.map((d) => {
      const sum = d.se + d.cash + d.ndfl;
      const empty = !sum;
      const h = (v) => Math.max(3, Math.round(v / max * 210));
      const hasSe = d.se > 0, hasCash = d.cash > 0, hasNdfl = d.ndfl > 0;
      const types = (hasSe ? 1 : 0) + (hasCash ? 1 : 0) + (hasNdfl ? 1 : 0);
      if (empty) {
        return `<div class="pc-col pc-col--empty"><div class="pc-col__nums"></div><div class="pc-col__trio"></div>
          <div class="pc-col__total dim">—</div><div class="pc-col__day">${d.day}</div></div>`;
      }
      return `<div class="pc-col" data-pc-day="${d.day}" title="${d.day}. — всего ${fmtR(sum)}">
        <div class="pc-col__nums">
          ${hasSe ? `<span class="pc-n pc-n--se">${moneyShort(d.se)}</span>` : ''}
          ${hasCash ? `<span class="pc-n pc-n--cash">${moneyShort(d.cash)}</span>` : ''}
          ${hasNdfl ? `<span class="pc-n pc-n--ndfl">${moneyShort(d.ndfl)}</span>` : ''}
        </div>
        <div class="pc-col__trio">
          ${hasSe ? `<div class="pc-col__bar" style="height:${h(d.se)}px"><i class="pc-se"></i></div>` : ''}
          ${hasCash ? `<div class="pc-col__bar" style="height:${h(d.cash)}px"><i class="pc-cash"></i></div>` : ''}
          ${hasNdfl ? `<div class="pc-col__bar" style="height:${h(d.ndfl)}px"><i class="pc-ndfl"></i></div>` : ''}
        </div>
        <div class="pc-col__total num">${moneyShort(sum)}</div>
        <div class="pc-col__day ${types === 3 ? 'pc-day-3' : types === 2 ? 'pc-day-2' : ''}">${d.day}</div>
      </div>`;
    }).join('');

    root.innerHTML = `
      <div class="po-head"><div><div class="po-head-title">График платежей</div>
        <div class="po-head-sub">Сколько денег нужно в каждый день. Кликните по столбцу — покажет, кому платим.</div></div>
        <div class="po-head-actions"><button class="btn ghost sm" data-pc-close>✕ Закрыть</button></div></div>
      <div class="pc-nav">
        <button class="btn ghost sm" data-pc-prev>‹ Пред.</button>
        <div class="pc-nav__m">${MONTHS[ym.month - 1]} ${ym.year}</div>
        <button class="btn ghost sm" data-pc-next>След. ›</button>
      </div>
      <div class="pc-legend">
        <span class="pc-lg"><i class="pc-se"></i>Самозанятые (ReStaff)</span>
        <span class="pc-lg"><i class="pc-cash"></i>Наличные (касса)</span>
        <span class="pc-lg"><i class="pc-ndfl"></i>Перевод с НДФЛ (+15%)</span>
      </div>
      <div class="pc-chart"><div class="pc-chart__grid">
        <div class="pc-y"><span>${moneyShort(max)}</span><span>${moneyShort(max * 0.5)}</span><span>0</span></div>
        <div class="pc-bars">${bars || '<div class="empty-state" style="padding:40px"><div class="title">Нет выплат в этом месяце</div></div>'}</div>
      </div></div>
      <div class="pc-facts">
        <div class="pc-fact"><i class="pc-se"></i><span>СЗ</span><b class="num">${fmtR(t.se)}</b></div>
        <div class="pc-fact"><i class="pc-cash"></i><span>Наличные</span><b class="num">${fmtR(t.cash)}</b></div>
        <div class="pc-fact"><i class="pc-ndfl"></i><span>НДФЛ</span><b class="num">${fmtR(t.ndfl)}</b></div>
        <div class="pc-fact pc-fact--all"><span>Всего за месяц</span><b class="num">${fmtR(t.total)}</b></div>
      </div>`;

    root.querySelector('[data-pc-prev]').onclick = () => shift(-1);
    const nx = root.querySelector('[data-pc-next]');
    if (nx) nx.onclick = () => shift(1);
    Array.from(root.querySelectorAll('[data-pc-day]')).forEach((el) => {
      el.onclick = () => {
        Array.from(root.querySelectorAll('.pc-col')).forEach((c) => c.classList.toggle('is-on', c === el));
        openDayModal(parseInt(el.dataset.pcDay, 10));
      };
    });
  }

  async function shift(delta) {
    let m = st.chartYM.month + delta, y = st.chartYM.year;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    st.chartYM = { year: y, month: m };
    const host = document.querySelector('#pc_host');
    if (host) await drawChart(host);
  }

  /** Модалка «кому платим в этот день». */
  async function openDayModal(day) {
    const ym = st.chartYM;
    let data;
    try { data = await api(`/api/payout-plan/day/${ym.year}/${ym.month}/${day}`); }
    catch (e) { toast('Ошибка', e.message, 'err'); return; }
    const items = data.items || [];
    const rows = items.map((i) => {
      const cat = i.category === 'se' ? '<span class="pp-tag pp-tag--se">СЗ</span>'
        : (i.category === 'ndfl' ? '<span class="pp-tag pp-tag--ndfl">НДФЛ</span>'
          : '<span class="pp-tag pp-tag--cash">Наличные</span>');
      return `<div class="cd-line">
        <div class="pp-it__av" style="width:28px;height:28px;font-size:11px">${initials(i.fio)}</div>
        <div><div class="cd-name">${esc(i.fio)}</div>
          <div class="cd-sub">${cat}${i.payee_fio ? ' · через ' + esc(i.payee_fio) : ''}</div></div>
        <div class="cd-sum"><span class="num">${fmtR(i.to_transfer)}</span></div>
      </div>`;
    }).join('') || '<div class="dim">В этот день выплат нет</div>';
    const tt = data.totals || {};
    const ov = document.createElement('div');
    ov.className = 'pp-ov';
    ov.style.zIndex = '100';
    ov.innerHTML = `<div style="position:fixed;inset:0;display:grid;place-items:center;padding:20px;overflow:auto">
      <div style="width:min(680px,100%);background:var(--bg1);border:1px solid var(--brd);border-radius:16px;box-shadow:var(--shadow-xl);padding:22px">
        <div class="row mb-3"><b style="font-size:17px">Кому платим в этот день</b>
          <button class="pp-dr__x" style="margin-left:auto" data-cd-close>✕</button></div>
        <div class="cd-head">
          <div><div class="cd-head__d">${day} ${MONTHS[ym.month - 1]} ${ym.year}</div>
            <div class="cd-head__s">${items.length} ${peopleWord(items.length)} · всего ${fmtR(tt.all)}</div></div>
          <div class="cd-head__cats">
            ${tt.se ? `<span class="cd-cat cd-cat--se">СЗ ${fmtR(tt.se)}</span>` : ''}
            ${tt.cash ? `<span class="cd-cat cd-cat--cash">Нал ${fmtR(tt.cash)}</span>` : ''}
            ${tt.ndfl ? `<span class="cd-cat cd-cat--ndfl">НДФЛ ${fmtR(tt.ndfl)}</span>` : ''}
          </div>
        </div>
        <div class="cd-list">${rows}</div>
      </div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-cd-close]')) ov.remove(); });
  }

  return { renderInto };
})();
