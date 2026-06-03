/**
 * AsgardOfficialEmployeesPage — Официально устроенные сотрудники
 * =================================================================
 * Route:  #/official-employees
 * Roles:  ADMIN, DIRECTOR_GEN, BUH
 *
 * API:
 *   GET /api/payroll-dashboard/official-employees
 *   PUT /api/payroll-dashboard/official-employees/:id
 */
window.AsgardOfficialEmployeesPage = (function () {
  'use strict';

  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;

  const ALLOWED = ['ADMIN', 'DIRECTOR_GEN', 'BUH'];

  const STATUS_CFG = {
    active:       { label: 'Работает',              bg: 'var(--ok-bg)',   color: 'var(--ok-t)'   },
    unpaid_leave: { label: 'Отпуск без содержания', bg: 'var(--warn-bg)', color: 'var(--warn-t)' },
    maternity:    { label: 'Декрет',                bg: 'var(--info-bg)', color: 'var(--info-t)' },
    sick_leave:   { label: 'Больничный',            bg: 'var(--warn-bg)', color: 'var(--warn-t)' },
    fired:        { label: 'Уволен',                bg: 'var(--err-bg)',  color: 'var(--err-t)'  },
  };

  const LEAVE_STATUSES = new Set(['unpaid_leave', 'maternity', 'sick_leave']);

  /* ── state ──────────────────────────────────────────────────────────── */
  let _token  = '';
  let _data   = [];
  let _editId = null;

  /* ── helpers ────────────────────────────────────────────────────────── */

  function hdr(json = true) {
    const h = { Authorization: 'Bearer ' + _token };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function apiFetch(method, path, body) {
    const opts = { method, headers: hdr() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(path, opts);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || e.error || 'HTTP ' + r.status);
    }
    return r.json();
  }

  const rub = n => new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: 'RUB', maximumFractionDigits: 0,
  }).format(n || 0);

  const fmtDate = s => s ? new Date(s).toLocaleDateString('ru-RU') : '—';

  function statusBadge(key) {
    const s = STATUS_CFG[key] || { label: key || '—', bg: 'var(--bg3)', color: 'var(--t2)' };
    return `<span style="display:inline-block;padding:3px 10px;border-radius:var(--r-sm);
                         font-size:12px;font-weight:600;
                         background:${s.bg};color:${s.color};">${esc(s.label)}</span>`;
  }

  /* ── table ──────────────────────────────────────────────────────────── */

  function buildTable(rows) {
    if (!rows.length) {
      return `<p style="text-align:center;padding:48px;color:var(--t3);font-size:14px;">
                Нет официально устроенных сотрудников
              </p>`;
    }

    const th = label => `
      <th style="padding:10px 14px;text-align:left;color:var(--t2);font-size:13px;
                 font-weight:600;white-space:nowrap;border-bottom:2px solid var(--brd);">
        ${label}
      </th>`;

    const theads = ['ФИО', 'Дата устройства', 'Оклад', 'Несгораемая', 'Статус', 'Долг компании']
      .map(th).join('');

    const tbodies = rows.map(e => {
      const debt       = e.company_debt || e.debt || 0;
      const debtColor  = debt > 0 ? 'var(--err-t)' : debt < 0 ? 'var(--ok-t)' : 'var(--t2)';
      const hireDate   = e.hired_date || e.official_hire_date;
      const name       = e.full_name  || e.fio || '—';
      return `
        <tr class="oe-row" data-id="${e.id}"
            style="border-bottom:1px solid var(--brd);cursor:pointer;transition:background .12s;">
          <td style="padding:10px 14px;color:var(--t1);font-weight:500;">
            ${esc(name)}
            ${e.position || e.role_tag
              ? `<div style="font-size:11px;color:var(--t3);margin-top:2px;">${esc(e.position || e.role_tag)}</div>`
              : ''}
          </td>
          <td style="padding:10px 14px;color:var(--t2);">${fmtDate(hireDate)}</td>
          <td style="padding:10px 14px;color:var(--t1);font-weight:600;">${rub(e.official_salary)}</td>
          <td style="padding:10px 14px;color:var(--t2);">${rub(e.official_non_burnable)}</td>
          <td style="padding:10px 14px;">${statusBadge(e.official_status)}</td>
          <td style="padding:10px 14px;font-weight:700;color:${debtColor};">${rub(debt)}</td>
        </tr>`;
    }).join('');

    return `
      <div style="overflow-x:auto;">
        <table class="asg">
          <thead><tr style="background:var(--bg2);">${theads}</tr></thead>
          <tbody>${tbodies}</tbody>
        </table>
      </div>`;
  }

  /* ── edit modal ─────────────────────────────────────────────────────── */

  function openEditModal(emp) {
    _editId = emp.id;

    const statusOptions = Object.entries(STATUS_CFG)
      .map(([v, s]) => `<option value="${v}"${emp.official_status === v ? ' selected' : ''}>${esc(s.label)}</option>`)
      .join('');

    const inpStyle = `style="width:100%;box-sizing:border-box;padding:9px 11px;
                             border:1px solid var(--brd);border-radius:var(--r-sm);
                             background:var(--bg2);color:var(--t1);font-size:14px;"`;

    const body = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
        <div>
          <label style="display:block;font-size:12px;color:var(--t2);margin-bottom:5px;font-weight:500;">
            Оклад (₽)
          </label>
          <input id="oe_salary" type="number" min="0" step="500"
            value="${emp.official_salary || 0}" ${inpStyle}>
        </div>
        <div>
          <label style="display:block;font-size:12px;color:var(--t2);margin-bottom:5px;font-weight:500;">
            Несгораемая (₽)
          </label>
          <input id="oe_nonburn" type="number" min="0" step="500"
            value="${emp.official_non_burnable || 0}" ${inpStyle}>
        </div>
      </div>

      <div style="margin-bottom:14px;">
        <label style="display:block;font-size:12px;color:var(--t2);margin-bottom:5px;font-weight:500;">
          Статус занятости
        </label>
        <select id="oe_status"
          style="width:100%;padding:9px 11px;border:1px solid var(--brd);border-radius:var(--r-sm);
                 background:var(--bg2);color:var(--t1);font-size:14px;">
          ${statusOptions}
        </select>
      </div>

      <div id="oe_leave_wrap" style="display:${LEAVE_STATUSES.has(emp.official_status) ? 'grid' : 'none'};
                                     grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
        <div>
          <label style="display:block;font-size:12px;color:var(--t2);margin-bottom:5px;font-weight:500;">
            Начало периода
          </label>
          <input id="oe_leave_from" type="date"
            value="${(emp.official_leave_from || '').slice(0, 10)}" ${inpStyle}>
        </div>
        <div>
          <label style="display:block;font-size:12px;color:var(--t2);margin-bottom:5px;font-weight:500;">
            Конец периода
          </label>
          <input id="oe_leave_to" type="date"
            value="${(emp.official_leave_to || '').slice(0, 10)}" ${inpStyle}>
        </div>
      </div>

      <!-- Смена типа занятости -->
      <div style="padding:14px 16px;background:var(--bg2);border-radius:var(--r-md);
                  border:1px solid var(--brd);margin-bottom:22px;">
        <p style="margin:0 0 6px;font-size:12px;color:var(--t2);font-weight:600;
                  text-transform:uppercase;letter-spacing:.04em;">
          Смена типа занятости
        </p>
        <p style="margin:0 0 10px;font-size:12px;color:var(--t3);">
          ⚠ Выполнять только после закрытия расчётного месяца.
          Влияет на зарплату и налоговую отчётность.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button id="oe_to_self"
            style="padding:7px 14px;border:1px solid var(--warn-t);border-radius:var(--r-sm);
                   background:transparent;color:var(--warn-t);cursor:pointer;
                   font-size:13px;font-weight:500;">
            → Перевести в самозанятые
          </button>
          <button id="oe_to_salary"
            style="padding:7px 14px;border:1px solid var(--info-t);border-radius:var(--r-sm);
                   background:transparent;color:var(--info-t);cursor:pointer;
                   font-size:13px;font-weight:500;">
            → Перевести на оклад
          </button>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button id="oe_cancel"
          style="padding:9px 22px;border:1px solid var(--brd);border-radius:var(--r-sm);
                 background:var(--bg2);color:var(--t2);cursor:pointer;font-size:14px;">
          Отмена
        </button>
        <button id="oe_save"
          style="padding:9px 24px;border:none;border-radius:var(--r-sm);background:var(--accent);
                 color:var(--t1);cursor:pointer;font-weight:600;font-size:14px;">
          Сохранить
        </button>
      </div>`;

    const name = emp.full_name || emp.fio || 'Сотрудник';
    showModal(`${esc(name)} — редактирование`, body);

    /* live leave-wrap toggle */
    $('#oe_status').addEventListener('change', () => {
      $('#oe_leave_wrap').style.display =
        LEAVE_STATUSES.has($('#oe_status').value) ? 'grid' : 'none';
    });

    /* cancel */
    $('#oe_cancel').addEventListener('click', () => closeModal());

    /* save */
    $('#oe_save').addEventListener('click', async () => {
      const btn = $('#oe_save');
      btn.disabled = true;
      btn.textContent = 'Сохранение…';
      try {
        await apiFetch('PUT', `/api/payroll-dashboard/official-employees/${_editId}`, {
          official_salary:       parseFloat($('#oe_salary').value)   || 0,
          official_non_burnable: parseFloat($('#oe_nonburn').value)  || 0,
          official_status:       $('#oe_status').value,
          official_leave_from:   $('#oe_leave_from').value || null,
          official_leave_to:     $('#oe_leave_to').value   || null,
        });
        toast('Готово', 'Данные обновлены', 'ok');
        closeModal();
        await load();
      } catch (e) {
        toast('Ошибка', e.message, 'err');
        btn.disabled    = false;
        btn.textContent = 'Сохранить';
      }
    });

    /* transfer to self-employed */
    $('#oe_to_self').addEventListener('click', async () => {
      const ok = await AsgardUI.confirm(
        `Перевести «${name}» в самозанятые?\n\n` +
        'Убедитесь, что текущий месяц закрыт. Изменение типа занятости влияет на расчёт зарплаты и налоговую отчётность.'
      );
      if (!ok) return;
      try {
        await apiFetch('PUT', `/api/payroll-dashboard/official-employees/${_editId}`, {
          is_officially_employed: false,
          is_self_employed:       true,
        });
        toast('Готово', 'Переведён в самозанятые', 'ok');
        closeModal();
        await load();
      } catch (e) {
        toast('Ошибка', e.message, 'err');
      }
    });

    /* transfer to official salary */
    $('#oe_to_salary').addEventListener('click', async () => {
      const ok = await AsgardUI.confirm(
        `Перевести «${name}» на официальный оклад?\n\n` +
        'Убедитесь, что текущий месяц закрыт. Изменение типа занятости влияет на расчёт зарплаты и налоговую отчётность.'
      );
      if (!ok) return;
      try {
        await apiFetch('PUT', `/api/payroll-dashboard/official-employees/${_editId}`, {
          is_officially_employed: true,
          is_self_employed:       false,
        });
        toast('Готово', 'Переведён на официальный оклад', 'ok');
        closeModal();
        await load();
      } catch (e) {
        toast('Ошибка', e.message, 'err');
      }
    });
  }

  /* ── load table ─────────────────────────────────────────────────────── */

  async function load() {
    const wrap = $('#oe_table_wrap');
    if (!wrap) return;
    wrap.innerHTML = `<p style="text-align:center;padding:36px;color:var(--t3);">Загрузка…</p>`;
    try {
      const res = await apiFetch('GET', '/api/payroll-dashboard/official-employees');
      _data = res.employees || (Array.isArray(res) ? res : []);

      /* summary bar */
      const total = _data.length;
      const active = _data.filter(e => e.official_status === 'active').length;
      const onLeave = _data.filter(e => LEAVE_STATUSES.has(e.official_status)).length;
      const totalDebt = _data.reduce((s, e) => s + (e.company_debt || e.debt || 0), 0);
      const debtColor = totalDebt > 0 ? 'var(--err-t)' : 'var(--ok-t)';

      const summary = $('#oe_summary');
      if (summary) {
        summary.innerHTML = `
          <span style="padding:6px 14px;background:var(--bg2);border-radius:var(--r-sm);font-size:13px;color:var(--t2);">
            Всего: <b style="color:var(--t1);">${total}</b>
          </span>
          <span style="padding:6px 14px;background:var(--ok-bg);border-radius:var(--r-sm);font-size:13px;color:var(--ok-t);">
            Работают: <b>${active}</b>
          </span>
          ${onLeave ? `
            <span style="padding:6px 14px;background:var(--warn-bg);border-radius:var(--r-sm);font-size:13px;color:var(--warn-t);">
              В отпуске/больничном: <b>${onLeave}</b>
            </span>` : ''}
          <span style="padding:6px 14px;background:var(--bg2);border-radius:var(--r-sm);font-size:13px;color:${debtColor};">
            Суммарный долг: <b>${rub(totalDebt)}</b>
          </span>`;
      }

      wrap.innerHTML = buildTable(_data);

      $$('.oe-row').forEach(tr => {
        tr.addEventListener('mouseenter', () => { tr.style.background = 'var(--bg2)'; });
        tr.addEventListener('mouseleave', () => { tr.style.background = ''; });
        tr.addEventListener('click', () => {
          const emp = _data.find(e => e.id === +tr.dataset.id);
          if (emp) openEditModal(emp);
        });
      });
    } catch (e) {
      wrap.innerHTML = `
        <p style="text-align:center;padding:36px;color:var(--err-t);">
          Ошибка загрузки: ${esc(e.message)}
        </p>`;
    }
  }

  /* ── main render ────────────────────────────────────────────────────── */

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user  = auth.user;
    _token = auth.token || localStorage.getItem('asgard_token') || localStorage.getItem('auth_token') || '';

    if (!ALLOWED.includes(user.role)) {
      toast('Доступ', 'Недостаточно прав', 'err');
      location.hash = '#/home';
      return;
    }

    const html = `
      <div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;
                    margin-bottom:12px;flex-wrap:wrap;gap:10px;">
          <div class="help">
            Сотрудники на официальном трудоустройстве — оклад + несгораемая часть.
            Кликните на строку для редактирования.
          </div>
          <button class="btn ghost" id="oe_refresh">🔄 Обновить</button>
        </div>

        <div id="oe_summary"
             style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;"></div>

        <div id="oe_table_wrap"
             style="background:var(--bg1);border:1px solid var(--brd);
                    border-radius:var(--r-md);overflow:hidden;">
        </div>
      </div>`;

    await layout(html, { title: title || 'Официально устроенные' });

    $('#oe_refresh').addEventListener('click', load);
    await load();
  }

  return { render };
})();
