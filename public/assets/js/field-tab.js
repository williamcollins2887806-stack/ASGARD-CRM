/**
 * AsgardFieldTab — Desktop CRM «Полевой модуль» (Session 9)
 * ═══════════════════════════════════════════════════════════
 * Вкладка на карточке работы: бригада, логистика, дашборд, табель.
 *
 * API: AsgardFieldTab.openFieldModal(work, user)
 */
window.AsgardFieldTab = (function () {
  'use strict';

  const { $, $$, esc, toast, money, formatDate } = AsgardUI;

  function hdr() {
    const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
    return { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' };
  }
  async function api(path, opts) {
    const r = await fetch('/api/field/manage' + path, { headers: hdr(), ...opts });
    return r.json();
  }
  async function apiRaw(path, opts) {
    return fetch('/api/field/manage' + path, { headers: hdr(), ...opts });
  }
  async function apiField(path, opts) {
    const r = await fetch('/api/field' + path, { headers: hdr(), ...opts });
    return r.json();
  }

  // ── Category labels ──────────────────────────────────────────────
  const CATEGORIES = [
    { value: 'offshore', label: 'МЛСП' },
    { value: 'ground', label: 'Земля' },
    { value: 'ground_heavy', label: 'Земля тяж.' },
    { value: 'warehouse', label: 'Склад' },
  ];

  const ROLES = [
    { value: 'worker', label: 'Рабочий' },
    { value: 'shift_master', label: 'Мастер смены' },
    { value: 'senior_master', label: 'Ст. мастер' },
  ];

  const LOG_TYPES = [
    { value: 'ticket_to', label: '✈️ Туда', short: 'Билет туда' },
    { value: 'hotel', label: '🏨 Отель', short: 'Гостиница' },
    { value: 'ticket_back', label: '✈️ Обратно', short: 'Билет обратно' },
    { value: 'visa', label: '📄 Виза', short: 'Виза/пропуск' },
    { value: 'insurance', label: '🛡️ Страх.', short: 'Страховка' },
  ];

  const STATUS_COLORS = {
    pending: '#f59e0b',
    booked: '#3b82f6',
    sent: '#8b5cf6',
    confirmed: '#10b981',
  };

  // ═══════════════════════════════════════════════════════════════════
  // MAIN ENTRY POINT
  // ═══════════════════════════════════════════════════════════════════
  async function openFieldModal(work, user) {
    // Check if field project exists
    let settings = null;
    try {
      const resp = await fetch(`/api/field/manage/projects/${work.id}/dashboard`, { headers: hdr() });
      if (resp.ok) settings = await resp.json();
    } catch (_) {}

    let settingsData = null;
    try {
      const r2 = await fetch(`/api/data/field_project_settings?work_id=${work.id}`, { headers: hdr() });
      const d2 = await r2.json();
      settingsData = (d2.rows || d2.items || d2 || [])[0] || null;
    } catch (_) {}

    const isActive = !!settingsData?.is_active;

    AsgardUI.showModal({
      title: '⚔️ Полевой модуль — ' + esc(work.work_title || '#' + work.id),
      html: '<div id="fieldTabRoot" style="min-height:400px"><div class="help">Загрузка…</div></div>',
      wide: true,
      onMount: ({ body }) => {
        const root = document.getElementById('fieldTabRoot');
        if (!root) return;
        renderFieldTabs(root, work, user, settingsData, isActive);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // TABS NAVIGATION
  // ═══════════════════════════════════════════════════════════════════
  function renderFieldTabs(root, work, user, settingsData, isActive) {
    const tabs = [
      { id: 'crew', label: '👥 Бригада', render: () => renderCrewTab(content, work, user, settingsData, isActive) },
      { id: 'logistics', label: '✈️ Логистика', render: () => renderLogisticsTab(content, work, user) },
      { id: 'dashboard', label: '📊 Дашборд', render: () => renderDashboardTab(content, work) },
      { id: 'timesheet', label: '📋 Табель', render: () => renderTimesheetTab(content, work) },
      { id: 'funds', label: '💰 Подотчёт', render: () => renderFundsTab(content, work, user) },
      { id: 'packing', label: '📦 Сборы', render: () => renderPackingTab(content, work, user) },
      { id: 'stages', label: '🗺 Маршруты', render: () => renderStagesTab(content, work, user) },
    ];

    root.innerHTML = '';

    // Tab buttons
    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--brd, rgba(255,255,255,0.08));padding-bottom:8px;flex-wrap:wrap';
    tabs.forEach((tab, i) => {
      const btn = document.createElement('button');
      btn.className = 'btn ghost';
      btn.textContent = tab.label;
      btn.dataset.ftab = tab.id;
      btn.style.cssText = 'padding:8px 16px;font-size:13px;border-radius:8px 8px 0 0;' + (i === 0 ? 'border-bottom:2px solid var(--gold, #D4A843);color:var(--gold, #D4A843);' : '');
      btn.addEventListener('click', () => {
        tabBar.querySelectorAll('button').forEach(b => {
          b.style.borderBottom = 'none';
          b.style.color = '';
        });
        btn.style.borderBottom = '2px solid var(--gold, #D4A843)';
        btn.style.color = 'var(--gold, #D4A843)';
        tab.render();
      });
      tabBar.appendChild(btn);
    });
    root.appendChild(tabBar);

    // Content area
    const content = document.createElement('div');
    content.id = 'fieldTabContent';
    root.appendChild(content);

    // Render first tab
    tabs[0].render();
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB 1: БРИГАДА (CREW)
  // ═══════════════════════════════════════════════════════════════════
  async function renderCrewTab(container, work, user, settingsData, isActive) {
    container.innerHTML = '<div class="help">Загрузка бригады…</div>';

    // Load tariffs and employees
    const [tariffsData, empsData, assignData] = await Promise.all([
      api('/tariffs?category=all'),
      fetch('/api/data/employees?limit=2000', { headers: hdr() }).then(r => r.json()),
      fetch(`/api/data/employee_assignments?work_id=${work.id}&limit=500`, { headers: hdr() }).then(r => r.json()),
    ]);

    const allTariffs = tariffsData.tariffs || [];
    const specials = tariffsData.specials || [];
    const allEmployees = (empsData.rows || empsData.items || []).sort((a, b) => (a.fio || '').localeCompare(b.fio || ''));
    const assignments = (assignData.rows || assignData.items || []).filter(a => a.is_active !== false);
    const category = settingsData?.site_category || 'ground';

    container.innerHTML = '';

    // ── Settings bar ──
    const settingsBar = document.createElement('div');
    settingsBar.style.cssText = 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px;padding:12px;background:var(--bg2, #151922);border-radius:8px;border:1px solid var(--brd, rgba(255,255,255,0.08))';

    // Category selector
    const catLabel = document.createElement('span');
    catLabel.textContent = 'Категория объекта:';
    catLabel.style.cssText = 'font-size:13px;color:var(--t2, #8b949e)';
    settingsBar.appendChild(catLabel);

    const catSelect = document.createElement('select');
    catSelect.id = 'fieldCategory';
    catSelect.style.cssText = 'padding:6px 10px;border-radius:6px;background:var(--bg1, #0D1117);color:var(--t1, #e6edf3);border:1px solid var(--brd, rgba(255,255,255,0.08));font-size:13px';
    CATEGORIES.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.value;
      opt.textContent = c.label;
      if (c.value === category) opt.selected = true;
      catSelect.appendChild(opt);
    });
    settingsBar.appendChild(catSelect);

    // Per diem
    const pdLabel = document.createElement('span');
    pdLabel.textContent = 'Суточные ₽/день:';
    pdLabel.style.cssText = 'font-size:13px;color:var(--t2, #8b949e);margin-left:16px';
    settingsBar.appendChild(pdLabel);

    const pdInput = document.createElement('input');
    pdInput.id = 'fieldPerDiem';
    pdInput.value = settingsData?.per_diem || '0';
    pdInput.style.cssText = 'width:80px;padding:6px 10px;border-radius:6px;background:var(--bg1, #0D1117);color:var(--t1, #e6edf3);border:1px solid var(--brd, rgba(255,255,255,0.08));font-size:13px';
    settingsBar.appendChild(pdInput);

    // Activate button
    if (!isActive) {
      const activateBtn = document.createElement('button');
      activateBtn.className = 'btn';
      activateBtn.textContent = '🚀 Запустить Field';
      activateBtn.style.cssText = 'margin-left:auto;background:linear-gradient(135deg,#D4A843,#B8922E);color:#000;font-weight:600';
      activateBtn.addEventListener('click', async () => {
        activateBtn.disabled = true;
        activateBtn.textContent = 'Активация…';
        try {
          await fetch(`/api/field/manage/projects/${work.id}/activate`, {
            method: 'POST', headers: hdr(),
            body: JSON.stringify({
              site_category: catSelect.value,
              per_diem: parseFloat(pdInput.value) || 0,
              schedule_type: 'shift',
              shift_hours: 11,
            })
          });
          toast('Field', 'Полевой модуль активирован! ⚔️', 'ok');
          isActive = true;
          settingsData = { site_category: catSelect.value, per_diem: parseFloat(pdInput.value) || 0, is_active: true };
          renderCrewTab(container, work, user, settingsData, true);
        } catch (e) {
          toast('Ошибка', String(e), 'err');
          activateBtn.disabled = false;
          activateBtn.textContent = '🚀 Запустить Field';
        }
      });
      settingsBar.appendChild(activateBtn);
    } else {
      const badge = document.createElement('span');
      badge.textContent = '✅ Активен';
      badge.style.cssText = 'margin-left:auto;color:#10b981;font-size:13px;font-weight:600';
      settingsBar.appendChild(badge);
    }

    container.appendChild(settingsBar);

    // ── Crew table ──
    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-x:auto;margin-bottom:16px';

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';

    // Header
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr style="background:var(--bg2, #151922)">
      <th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--brd, rgba(255,255,255,0.08));color:var(--t2, #8b949e);font-weight:500;font-size:12px">ФИО</th>
      <th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--brd);color:var(--t2);font-weight:500;font-size:12px">Роль</th>
      <th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--brd);color:var(--t2);font-weight:500;font-size:12px">Тариф</th>
      <th style="padding:8px 6px;text-align:center;border-bottom:1px solid var(--brd);color:var(--t2);font-weight:500;font-size:12px">Баллы</th>
      <th style="padding:8px 6px;text-align:right;border-bottom:1px solid var(--brd);color:var(--t2);font-weight:500;font-size:12px">₽/смену</th>
      <th style="padding:8px 6px;text-align:center;border-bottom:1px solid var(--brd);color:var(--t2);font-weight:500;font-size:12px">Совмещ.</th>
      <th style="padding:8px 6px;text-align:center;border-bottom:1px solid var(--brd);color:var(--t2);font-weight:500;font-size:12px">SMS</th>
      <th style="padding:8px 6px;text-align:center;border-bottom:1px solid var(--brd);color:var(--t2);font-weight:500;font-size:12px"></th>
    </tr>`;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    tbody.id = 'fieldCrewBody';
    table.appendChild(tbody);

    tableWrap.appendChild(table);
    container.appendChild(tableWrap);

    // Populate existing assignments
    const currentCat = catSelect.value;
    const filteredTariffs = allTariffs.filter(t => t.category === currentCat);
    const comboTariffs = specials.concat(allTariffs.filter(t => t.is_combinable));

    for (const a of assignments) {
      const emp = allEmployees.find(e => e.id === a.employee_id);
      if (!emp) continue;
      addCrewRow(tbody, emp, a, filteredTariffs, comboTariffs, allEmployees);
    }

    // Category change → re-filter tariffs
    catSelect.addEventListener('change', () => {
      const newCat = catSelect.value;
      const newFiltered = allTariffs.filter(t => t.category === newCat);
      // Update all tariff dropdowns
      tbody.querySelectorAll('select[data-field="tariff"]').forEach(sel => {
        const curVal = sel.value;
        sel.innerHTML = '<option value="">— выберите —</option>';
        newFiltered.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.id;
          opt.textContent = `${t.position_name} (${t.points}б · ${money(t.rate_per_shift)}₽)`;
          if (String(t.id) === curVal) opt.selected = true;
          sel.appendChild(opt);
        });
        // Trigger points/rate recalc
        sel.dispatchEvent(new Event('change'));
      });
    });

    // ── Action buttons ──
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';

    // Add employee button
    const addBtn = document.createElement('button');
    addBtn.className = 'btn ghost';
    addBtn.textContent = '➕ Добавить сотрудника';
    addBtn.addEventListener('click', () => {
      addCrewRow(tbody, null, null, filteredTariffs, comboTariffs, allEmployees);
    });
    actions.appendChild(addBtn);

    // Save crew button
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn';
    saveBtn.textContent = '💾 Сохранить бригаду';
    saveBtn.addEventListener('click', async () => {
      const rows = tbody.querySelectorAll('tr[data-crew-row]');
      const employees = [];
      rows.forEach(row => {
        const empId = row.querySelector('select[data-field="employee"]')?.value;
        const role = row.querySelector('select[data-field="role"]')?.value;
        const tariffId = row.querySelector('select[data-field="tariff"]')?.value;
        const comboId = row.querySelector('select[data-field="combo"]')?.value;
        if (empId) {
          employees.push({
            employee_id: parseInt(empId),
            field_role: role || 'worker',
            tariff_id: tariffId ? parseInt(tariffId) : null,
            combination_tariff_id: comboId ? parseInt(comboId) : null,
          });
        }
      });

      if (employees.length === 0) {
        toast('Бригада', 'Нет сотрудников для сохранения', 'err');
        return;
      }

      // First ensure project is activated with current settings
      if (isActive) {
        await fetch(`/api/field/manage/projects/${work.id}/activate`, {
          method: 'POST', headers: hdr(),
          body: JSON.stringify({
            site_category: catSelect.value,
            per_diem: parseFloat(pdInput.value) || 0,
          })
        });
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохранение…';
      try {
        const result = await api(`/projects/${work.id}/crew`, {
          method: 'POST',
          body: JSON.stringify({ employees }),
        });
        const ok = result.count || 0;
        toast('Бригада', `Сохранено: ${ok} из ${employees.length}`, 'ok');
        // Refresh
        renderCrewTab(container, work, user, settingsData, isActive);
      } catch (e) {
        toast('Ошибка', String(e), 'err');
      }
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Сохранить бригаду';
    });
    actions.appendChild(saveBtn);

    // SMS button
    const smsBtn = document.createElement('button');
    smsBtn.className = 'btn ghost';
    smsBtn.textContent = '📨 Отправить SMS бригаде';
    smsBtn.addEventListener('click', async () => {
      if (!confirm('Отправить SMS-приглашения всем в бригаде, кому ещё не отправлено?')) return;
      smsBtn.disabled = true;
      smsBtn.textContent = 'Отправка…';
      try {
        const result = await api(`/projects/${work.id}/send-invites`, { method: 'POST', body: '{}' });
        toast('SMS', `Отправлено: ${result.sent}, ошибок: ${result.failed}`, result.failed ? 'warn' : 'ok');
      } catch (e) {
        toast('Ошибка SMS', String(e), 'err');
      }
      smsBtn.disabled = false;
      smsBtn.textContent = '📨 Отправить SMS бригаде';
    });
    actions.appendChild(smsBtn);

    container.appendChild(actions);
  }

  // ── Add a crew row ──
  function addCrewRow(tbody, employee, assignment, tariffs, comboTariffs, allEmployees) {
    const tr = document.createElement('tr');
    tr.dataset.crewRow = '1';
    tr.style.cssText = 'border-bottom:1px solid var(--brd, rgba(255,255,255,0.06))';

    const cellStyle = 'padding:6px 8px;vertical-align:middle';

    // Employee select
    const tdEmp = document.createElement('td');
    tdEmp.style.cssText = cellStyle;
    const selEmp = document.createElement('select');
    selEmp.dataset.field = 'employee';
    selEmp.style.cssText = 'width:100%;min-width:180px;padding:5px;border-radius:4px;background:var(--bg1, #0D1117);color:var(--t1, #e6edf3);border:1px solid var(--brd)';
    selEmp.innerHTML = '<option value="">— сотрудник —</option>';
    allEmployees.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.fio + (e.phone ? ' · ' + e.phone : '');
      if (employee && e.id === employee.id) opt.selected = true;
      selEmp.appendChild(opt);
    });
    tdEmp.appendChild(selEmp);
    tr.appendChild(tdEmp);

    // Role select
    const tdRole = document.createElement('td');
    tdRole.style.cssText = cellStyle;
    const selRole = document.createElement('select');
    selRole.dataset.field = 'role';
    selRole.style.cssText = 'padding:5px;border-radius:4px;background:var(--bg1);color:var(--t1);border:1px solid var(--brd)';
    ROLES.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.value;
      opt.textContent = r.label;
      if (assignment && assignment.field_role === r.value) opt.selected = true;
      selRole.appendChild(opt);
    });
    tdRole.appendChild(selRole);
    tr.appendChild(tdRole);

    // Tariff select
    const tdTariff = document.createElement('td');
    tdTariff.style.cssText = cellStyle;
    const selTariff = document.createElement('select');
    selTariff.dataset.field = 'tariff';
    selTariff.style.cssText = 'min-width:200px;padding:5px;border-radius:4px;background:var(--bg1);color:var(--t1);border:1px solid var(--brd)';
    selTariff.innerHTML = '<option value="">— выберите —</option>';
    tariffs.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.position_name} (${t.points}б · ${money(t.rate_per_shift)}₽)`;
      if (assignment && assignment.tariff_id === t.id) opt.selected = true;
      selTariff.appendChild(opt);
    });
    tdTariff.appendChild(selTariff);
    tr.appendChild(tdTariff);

    // Points (auto)
    const tdPoints = document.createElement('td');
    tdPoints.style.cssText = cellStyle + ';text-align:center;font-weight:600';
    tdPoints.dataset.field = 'points';
    tdPoints.textContent = assignment?.tariff_points || '—';
    tr.appendChild(tdPoints);

    // Rate (auto)
    const tdRate = document.createElement('td');
    tdRate.style.cssText = cellStyle + ';text-align:right;font-weight:600;color:var(--gold, #D4A843)';
    tdRate.dataset.field = 'rate';
    tdRate.textContent = '—';
    tr.appendChild(tdRate);

    // Combination select
    const tdCombo = document.createElement('td');
    tdCombo.style.cssText = cellStyle + ';text-align:center';
    const selCombo = document.createElement('select');
    selCombo.dataset.field = 'combo';
    selCombo.style.cssText = 'padding:5px;border-radius:4px;background:var(--bg1);color:var(--t1);border:1px solid var(--brd);max-width:120px';
    selCombo.innerHTML = '<option value="">Нет</option>';
    comboTariffs.forEach(t => {
      if (!t.is_combinable) return;
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.position_name} (+${t.points || 1}б)`;
      if (assignment && assignment.combination_tariff_id === t.id) opt.selected = true;
      selCombo.appendChild(opt);
    });
    tdCombo.appendChild(selCombo);
    tr.appendChild(tdCombo);

    // SMS status
    const tdSms = document.createElement('td');
    tdSms.style.cssText = cellStyle + ';text-align:center';
    if (assignment?.sms_sent) {
      tdSms.innerHTML = '<span style="color:#10b981" title="SMS отправлено">✅</span>';
    } else if (assignment) {
      tdSms.innerHTML = '<span style="color:#6b7280" title="Не отправлено">📨</span>';
    }
    tr.appendChild(tdSms);

    // Remove button
    const tdDel = document.createElement('td');
    tdDel.style.cssText = cellStyle + ';text-align:center';
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.title = 'Удалить из бригады';
    delBtn.style.cssText = 'background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px;padding:4px 8px';
    delBtn.addEventListener('click', () => tr.remove());
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    // Tariff change → auto update points & rate
    function updatePointsRate() {
      const tariffId = selTariff.value;
      const tariff = tariffs.find(t => String(t.id) === tariffId);
      const comboId = selCombo.value;
      const combo = comboTariffs.find(t => String(t.id) === comboId);

      const basePoints = tariff ? (tariff.points || 0) : 0;
      const comboPoints = combo ? (combo.points || 1) : 0;
      const baseRate = tariff ? parseFloat(tariff.rate_per_shift || 0) : 0;
      const comboRate = combo ? parseFloat(combo.rate_per_shift || 0) : 0;

      const totalPoints = basePoints + (combo ? comboPoints : 0);
      const totalRate = baseRate + comboRate;

      tdPoints.textContent = totalPoints || '—';
      tdRate.textContent = totalRate ? money(totalRate) + ' ₽' : '—';

      if (combo && combo.requires_approval) {
        tdCombo.style.background = 'rgba(245,158,11,0.1)';
        tdCombo.title = 'Требует согласования';
      } else {
        tdCombo.style.background = '';
        tdCombo.title = '';
      }
    }

    selTariff.addEventListener('change', updatePointsRate);
    selCombo.addEventListener('change', updatePointsRate);

    // Initial calc
    if (assignment?.tariff_id) {
      const t = tariffs.find(t => t.id === assignment.tariff_id);
      if (t) {
        const comboT = assignment.combination_tariff_id ? comboTariffs.find(c => c.id === assignment.combination_tariff_id) : null;
        const rate = parseFloat(t.rate_per_shift || 0) + (comboT ? parseFloat(comboT.rate_per_shift || 0) : 0);
        tdRate.textContent = rate ? money(rate) + ' ₽' : '—';
      }
    }

    tbody.appendChild(tr);
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB 2: ЛОГИСТИКА
  // ═══════════════════════════════════════════════════════════════════
  async function renderLogisticsTab(container, work, user) {
    container.innerHTML = '<div class="help">Загрузка логистики…</div>';

    const [logData, assignData] = await Promise.all([
      apiField(`/logistics?work_id=${work.id}`),
      fetch(`/api/data/employee_assignments?work_id=${work.id}&limit=500`, { headers: hdr() }).then(r => r.json()),
    ]);

    const items = logData.items || logData.logistics || (Array.isArray(logData) ? logData : []);
    const assignments = (assignData.rows || assignData.items || []).filter(a => a.is_active !== false);

    // Load employee names
    const empIds = [...new Set(assignments.map(a => a.employee_id))];
    let empsMap = {};
    if (empIds.length) {
      try {
        const empsData = await fetch('/api/data/employees?limit=2000', { headers: hdr() }).then(r => r.json());
        (empsData.rows || empsData.items || []).forEach(e => { empsMap[e.id] = e; });
      } catch (_) {}
    }

    container.innerHTML = '';

    // Info
    const info = document.createElement('div');
    info.className = 'help';
    info.style.marginBottom = '12px';
    info.textContent = 'Матрица логистики: строки = сотрудники, колонки = тип. Нажмите «+» для добавления.';
    container.appendChild(info);

    // Matrix table
    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-x:auto;margin-bottom:16px';

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';

    const thStyle = 'padding:8px 10px;text-align:center;border-bottom:1px solid var(--brd, rgba(255,255,255,0.08));color:var(--t2, #8b949e);font-weight:500;font-size:12px;white-space:nowrap';

    const thead = document.createElement('thead');
    let headerHtml = `<tr style="background:var(--bg2, #151922)"><th style="${thStyle};text-align:left">Сотрудник</th>`;
    LOG_TYPES.forEach(lt => { headerHtml += `<th style="${thStyle}">${lt.label}</th>`; });
    headerHtml += '</tr>';
    thead.innerHTML = headerHtml;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    // Build lookup: employee_id -> { type -> item }
    const matrix = {};
    items.forEach(item => {
      if (!matrix[item.employee_id]) matrix[item.employee_id] = {};
      matrix[item.employee_id][item.item_type] = item;
    });

    for (const a of assignments) {
      const emp = empsMap[a.employee_id];
      if (!emp) continue;
      const tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom:1px solid var(--brd, rgba(255,255,255,0.06))';

      // Employee name
      const tdName = document.createElement('td');
      tdName.style.cssText = 'padding:8px 10px;font-weight:500;white-space:nowrap';
      tdName.textContent = emp.fio || '—';
      tr.appendChild(tdName);

      // For each logistics type
      LOG_TYPES.forEach(lt => {
        const td = document.createElement('td');
        td.style.cssText = 'padding:6px 8px;text-align:center';

        const item = matrix[emp.id]?.[lt.value];
        if (item) {
          // Show status
          const statusColor = STATUS_COLORS[item.status] || '#6b7280';
          const badge = document.createElement('span');
          badge.style.cssText = `display:inline-block;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:500;background:${statusColor}22;color:${statusColor}`;
          badge.textContent = item.status === 'confirmed' ? '✅' : item.status === 'sent' ? '📨' : item.status === 'booked' ? '📋' : '⏳';
          badge.title = `${item.title || lt.short} — ${item.status}`;
          td.appendChild(badge);

          // Send button if not sent
          if (!item.sent_to_employee) {
            const sendBtn = document.createElement('button');
            sendBtn.textContent = '📨';
            sendBtn.title = 'Отправить сотруднику';
            sendBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;margin-left:4px';
            sendBtn.addEventListener('click', async () => {
              sendBtn.disabled = true;
              try {
                await apiField(`/logistics/${item.id}/send`, { method: 'POST', body: '{}' });
                toast('Логистика', 'SMS отправлено!', 'ok');
                renderLogisticsTab(container, work, user);
              } catch (e) {
                toast('Ошибка', String(e), 'err');
              }
            });
            td.appendChild(sendBtn);
          }
        } else {
          // Add button
          const addBtn = document.createElement('button');
          addBtn.textContent = '+';
          addBtn.title = `Добавить ${lt.short}`;
          addBtn.style.cssText = 'width:32px;height:32px;border-radius:8px;border:1px dashed var(--brd, rgba(255,255,255,0.15));background:transparent;color:var(--t2, #8b949e);cursor:pointer;font-size:16px;transition:all .15s';
          addBtn.addEventListener('mouseenter', () => { addBtn.style.borderColor = 'var(--gold, #D4A843)'; addBtn.style.color = 'var(--gold, #D4A843)'; });
          addBtn.addEventListener('mouseleave', () => { addBtn.style.borderColor = ''; addBtn.style.color = ''; });
          addBtn.addEventListener('click', () => {
            openLogisticsForm(container, work, user, emp, lt);
          });
          td.appendChild(addBtn);
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    container.appendChild(tableWrap);

    if (assignments.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'help';
      empty.style.cssText = 'text-align:center;padding:40px;color:var(--t2)';
      empty.textContent = 'Сначала добавьте бригаду на вкладке «Бригада»';
      container.appendChild(empty);
    }
  }

  // ── Logistics form (add item) ──
  function openLogisticsForm(parentContainer, work, user, emp, logType) {
    const formHtml = `
      <div class="formrow">
        <div><label>Тип</label><input disabled value="${esc(logType.short)}" /></div>
        <div><label>Сотрудник</label><input disabled value="${esc(emp.fio)}" /></div>
      </div>
      <div class="formrow">
        <div style="grid-column:1/-1"><label>Название</label><input id="logTitle" placeholder="S7-2541 Москва → Кемерово" /></div>
      </div>
      <div class="formrow">
        <div><label>Дата с</label><input id="logDateFrom" type="date" /></div>
        <div><label>Дата по</label><input id="logDateTo" type="date" /></div>
      </div>
      <div class="formrow">
        <div style="grid-column:1/-1"><label>Описание</label><input id="logDesc" placeholder="детали рейса, бронирования и т.д." /></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:12px">
        <button class="btn" id="logSaveBtn">💾 Сохранить</button>
        <button class="btn ghost" id="logCancelBtn">Отмена</button>
      </div>
    `;

    AsgardUI.showModal('✈️ Добавить: ' + esc(logType.short) + ' — ' + esc(emp.fio), formHtml);

    setTimeout(() => {
      const saveBtn = document.getElementById('logSaveBtn');
      const cancelBtn = document.getElementById('logCancelBtn');

      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          const title = document.getElementById('logTitle')?.value;
          if (!title) { toast('Логистика', 'Укажите название', 'err'); return; }

          saveBtn.disabled = true;
          saveBtn.textContent = 'Сохранение…';

          try {
            await apiField('/logistics', {
              method: 'POST',
              body: JSON.stringify({
                work_id: work.id,
                employee_id: emp.id,
                item_type: logType.value,
                title,
                description: document.getElementById('logDesc')?.value || '',
                date_from: document.getElementById('logDateFrom')?.value || null,
                date_to: document.getElementById('logDateTo')?.value || null,
              }),
            });
            toast('Логистика', 'Запись добавлена', 'ok');
            AsgardUI.hideModal();
            // Refresh logistics tab after short delay
            setTimeout(() => renderLogisticsTab(parentContainer, work, user), 200);
          } catch (e) {
            toast('Ошибка', String(e), 'err');
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Сохранить';
          }
        });
      }

      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => AsgardUI.hideModal());
      }
    }, 50);
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB 3: ДАШБОРД
  // ═══════════════════════════════════════════════════════════════════
  async function renderDashboardTab(container, work) {
    container.innerHTML = '<div class="help">Загрузка дашборда…</div>';

    let data;
    try {
      data = await api(`/projects/${work.id}/dashboard`);
    } catch (e) {
      container.innerHTML = '<div class="help" style="color:#ef4444">Не удалось загрузить дашборд. Убедитесь, что Field активирован.</div>';
      return;
    }

    container.innerHTML = '';

    // ── KPI cards ──
    const kpi = document.createElement('div');
    kpi.className = 'kpi';
    kpi.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:20px';

    const cards = [
      { title: 'Сейчас на объекте', value: (data.online_now || []).length, sub: `из ${data.total_crew || 0}`, color: '#10b981' },
      { title: 'Сегодня отмечено', value: data.today_count || 0, sub: 'чекинов', color: '#3b82f6' },
      { title: 'Часов сегодня', value: (data.today_hours || 0).toFixed(1), sub: 'всего', color: '#8b5cf6' },
      { title: 'Заработок сегодня', value: money(Math.round(data.today_earned || 0)) + ' ₽', sub: 'по бригаде', color: '#D4A843' },
    ];

    cards.forEach(c => {
      const card = document.createElement('div');
      card.className = 'k';
      card.style.cssText = `padding:16px;border-radius:10px;background:var(--bg2, #151922);border:1px solid var(--brd, rgba(255,255,255,0.08))`;
      card.innerHTML = `
        <div style="font-size:12px;color:var(--t2, #8b949e);margin-bottom:6px">${esc(c.title)}</div>
        <div style="font-size:24px;font-weight:700;color:${c.color}">${esc(String(c.value))}</div>
        <div style="font-size:11px;color:var(--t2);margin-top:4px">${esc(c.sub)}</div>
      `;
      kpi.appendChild(card);
    });

    container.appendChild(kpi);

    // ── Progress bar ──
    if (data.progress) {
      const pct = data.progress.pct || 0;
      const progWrap = document.createElement('div');
      progWrap.style.cssText = 'margin-bottom:20px;padding:16px;border-radius:10px;background:var(--bg2);border:1px solid var(--brd)';
      progWrap.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:13px;font-weight:600">Прогресс</span>
          <span style="font-size:13px;color:var(--gold, #D4A843);font-weight:600">${pct}%</span>
        </div>
        <div style="width:100%;height:8px;background:var(--bg1, #0D1117);border-radius:4px;overflow:hidden">
          <div style="width:${Math.min(pct, 100)}%;height:100%;background:linear-gradient(90deg,#D4A843,#B8922E);border-radius:4px;transition:width .5s"></div>
        </div>
        <div style="font-size:12px;color:var(--t2);margin-top:6px">${data.progress.done || 0} / ${data.progress.total || '?'} ${esc(data.progress.unit || '')}</div>
      `;
      container.appendChild(progWrap);
    }

    // ── Online now list ──
    if ((data.online_now || []).length > 0) {
      const onlineWrap = document.createElement('div');
      onlineWrap.style.cssText = 'margin-bottom:16px';
      onlineWrap.innerHTML = `<div style="font-size:13px;font-weight:600;margin-bottom:8px">🟢 Сейчас на объекте (${data.online_now.length})</div>`;

      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
      data.online_now.forEach(p => {
        const chip = document.createElement('span');
        chip.style.cssText = 'padding:5px 12px;border-radius:8px;font-size:12px;background:rgba(16,185,129,0.1);color:#10b981;font-weight:500';
        const time = p.checkin_at ? new Date(p.checkin_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
        chip.textContent = `${p.fio || '?'} · ${time}`;
        list.appendChild(chip);
      });
      onlineWrap.appendChild(list);
      container.appendChild(onlineWrap);
    }

    // ── Week summary ──
    if ((data.week_summary || []).length > 0) {
      const weekWrap = document.createElement('div');
      weekWrap.style.cssText = 'padding:16px;border-radius:10px;background:var(--bg2);border:1px solid var(--brd)';
      weekWrap.innerHTML = '<div style="font-size:13px;font-weight:600;margin-bottom:12px">📊 За неделю</div>';

      const weekTable = document.createElement('table');
      weekTable.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
      weekTable.innerHTML = `
        <thead><tr style="color:var(--t2)">
          <th style="text-align:left;padding:4px 8px">Дата</th>
          <th style="text-align:center;padding:4px 8px">Чел.</th>
          <th style="text-align:center;padding:4px 8px">Часов</th>
          <th style="text-align:right;padding:4px 8px">Заработок</th>
        </tr></thead>
      `;
      const weekBody = document.createElement('tbody');
      data.week_summary.forEach(d => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--brd, rgba(255,255,255,0.04))';
        tr.innerHTML = `
          <td style="padding:6px 8px">${formatDate ? formatDate(d.date) : d.date}</td>
          <td style="padding:6px 8px;text-align:center">${d.workers}</td>
          <td style="padding:6px 8px;text-align:center">${parseFloat(d.hours).toFixed(1)}</td>
          <td style="padding:6px 8px;text-align:right;color:var(--gold, #D4A843)">${money(Math.round(parseFloat(d.earned)))} ₽</td>
        `;
        weekBody.appendChild(tr);
      });
      weekTable.appendChild(weekBody);
      weekWrap.appendChild(weekTable);
      container.appendChild(weekWrap);
    }

    // Refresh button
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn ghost';
    refreshBtn.textContent = '🔄 Обновить';
    refreshBtn.style.cssText = 'margin-top:12px';
    refreshBtn.addEventListener('click', () => renderDashboardTab(container, work));
    container.appendChild(refreshBtn);
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB 4: ТАБЕЛЬ (TIMESHEET)
  // ═══════════════════════════════════════════════════════════════════
  async function renderTimesheetTab(container, work) {
    container.innerHTML = '<div class="help">Загрузка табеля…</div>';

    // Default: last 30 days
    const today = new Date();
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 30);
    const dfFrom = monthAgo.toISOString().slice(0, 10);
    const dfTo = today.toISOString().slice(0, 10);

    container.innerHTML = '';

    // Date filters
    const filters = document.createElement('div');
    filters.style.cssText = 'display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap';
    filters.innerHTML = `
      <label style="font-size:13px;color:var(--t2)">С:</label>
      <input id="tsFrom" type="date" value="${dfFrom}" style="padding:6px 10px;border-radius:6px;background:var(--bg1);color:var(--t1);border:1px solid var(--brd);font-size:13px" />
      <label style="font-size:13px;color:var(--t2)">По:</label>
      <input id="tsTo" type="date" value="${dfTo}" style="padding:6px 10px;border-radius:6px;background:var(--bg1);color:var(--t1);border:1px solid var(--brd);font-size:13px" />
      <button class="btn ghost" id="tsLoad" style="font-size:13px">Загрузить</button>
      <button class="btn" id="tsExport" style="font-size:13px;margin-left:auto;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff">📥 Выгрузить Excel</button>
    `;
    container.appendChild(filters);

    const tableWrap = document.createElement('div');
    tableWrap.id = 'tsTableWrap';
    tableWrap.style.cssText = 'overflow-x:auto';
    container.appendChild(tableWrap);

    async function loadTimesheet() {
      const from = document.getElementById('tsFrom')?.value || dfFrom;
      const to = document.getElementById('tsTo')?.value || dfTo;
      tableWrap.innerHTML = '<div class="help">Загрузка…</div>';

      try {
        const data = await api(`/projects/${work.id}/timesheet?from=${from}&to=${to}`);
        renderTimesheetTable(tableWrap, data, from, to);
      } catch (e) {
        tableWrap.innerHTML = '<div class="help" style="color:#ef4444">Ошибка загрузки табеля</div>';
      }
    }

    document.getElementById('tsLoad')?.addEventListener('click', loadTimesheet);

    document.getElementById('tsExport')?.addEventListener('click', async () => {
      const from = document.getElementById('tsFrom')?.value || dfFrom;
      const to = document.getElementById('tsTo')?.value || dfTo;
      const btn = document.getElementById('tsExport');
      btn.disabled = true;
      btn.textContent = 'Генерация…';
      try {
        const resp = await apiRaw(`/projects/${work.id}/timesheet?from=${from}&to=${to}&format=xlsx`);
        if (!resp.ok) throw new Error('Ошибка генерации');
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `timesheet_work${work.id}_${from}_${to}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        toast('Табель', 'Excel скачан', 'ok');
      } catch (e) {
        toast('Ошибка', String(e), 'err');
      }
      btn.disabled = false;
      btn.textContent = '📥 Выгрузить Excel';
    });

    // Initial load
    loadTimesheet();
  }

  function renderTimesheetTable(wrap, data, from, to) {
    const timesheet = data.timesheet || [];
    const perDiem = data.per_diem_rate || 0;

    if (!timesheet.length) {
      wrap.innerHTML = '<div class="help" style="text-align:center;padding:40px;color:var(--t2)">Нет данных за выбранный период</div>';
      return;
    }

    // Collect all unique dates
    const allDates = new Set();
    timesheet.forEach(emp => (emp.days || []).forEach(d => allDates.add(d.date)));
    const dates = [...allDates].sort();

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';

    // Header
    const thStyle = 'padding:6px 8px;border-bottom:1px solid var(--brd);color:var(--t2);font-weight:500;font-size:11px;white-space:nowrap;position:sticky;top:0;background:var(--bg2, #151922)';
    let headerHtml = `<tr><th style="${thStyle};text-align:left;min-width:150px">ФИО</th>`;
    dates.forEach(d => {
      const day = new Date(d + 'T00:00:00');
      const label = String(day.getDate()).padStart(2, '0') + '.' + String(day.getMonth() + 1).padStart(2, '0');
      headerHtml += `<th style="${thStyle};text-align:center">${label}</th>`;
    });
    headerHtml += `<th style="${thStyle};text-align:center">Дней</th>`;
    headerHtml += `<th style="${thStyle};text-align:right">Часов</th>`;
    headerHtml += `<th style="${thStyle};text-align:right">Зараб.</th>`;
    headerHtml += `<th style="${thStyle};text-align:right">Суточные</th>`;
    headerHtml += `<th style="${thStyle};text-align:right;color:var(--gold)">Итого</th>`;
    headerHtml += '</tr>';

    const thead = document.createElement('thead');
    thead.innerHTML = headerHtml;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    let grandHours = 0, grandEarned = 0, grandPerDiem = 0, grandTotal = 0;

    timesheet.forEach(emp => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--brd, rgba(255,255,255,0.04))';

      // Name
      const tdName = document.createElement('td');
      tdName.style.cssText = 'padding:6px 8px;font-weight:500;white-space:nowrap';
      tdName.textContent = emp.fio || '—';
      tr.appendChild(tdName);

      // Day cells
      const dayMap = {};
      (emp.days || []).forEach(d => { dayMap[d.date] = d; });

      dates.forEach(d => {
        const td = document.createElement('td');
        td.style.cssText = 'padding:4px 6px;text-align:center';
        const day = dayMap[d];
        if (day) {
          const h = parseFloat(day.hours_paid || day.hours_worked || 0);
          td.textContent = h.toFixed(1);
          td.style.color = h >= 10 ? '#D4A843' : h >= 8 ? '#10b981' : '#3b82f6';
          td.title = `${d}: ${h.toFixed(1)}ч, ${money(Math.round(day.amount || 0))}₽`;
        } else {
          td.textContent = '—';
          td.style.color = 'var(--t2, #4b5563)';
        }
        tr.appendChild(td);
      });

      // Summary cells
      const daysCount = emp.days_count || 0;
      const hours = emp.total_paid_hours || emp.total_hours || 0;
      const earned = emp.total_earned || 0;
      const pd = emp.per_diem_total || 0;
      const total = emp.grand_total || 0;

      grandHours += hours;
      grandEarned += earned;
      grandPerDiem += pd;
      grandTotal += total;

      [
        { v: daysCount, align: 'center' },
        { v: hours.toFixed(1), align: 'right' },
        { v: money(Math.round(earned)) + ' ₽', align: 'right' },
        { v: money(Math.round(pd)) + ' ₽', align: 'right' },
        { v: money(Math.round(total)) + ' ₽', align: 'right', gold: true },
      ].forEach(c => {
        const td = document.createElement('td');
        td.style.cssText = `padding:6px 8px;text-align:${c.align};font-weight:${c.gold ? '700' : '500'}`;
        if (c.gold) td.style.color = 'var(--gold, #D4A843)';
        td.textContent = c.v;
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    // Totals row
    const totalTr = document.createElement('tr');
    totalTr.style.cssText = 'border-top:2px solid var(--brd);font-weight:700;background:var(--bg2, #151922)';
    const tdTotalLabel = document.createElement('td');
    tdTotalLabel.colSpan = dates.length + 1;
    tdTotalLabel.style.cssText = 'padding:8px 10px;text-align:right';
    tdTotalLabel.textContent = 'ИТОГО:';
    totalTr.appendChild(tdTotalLabel);

    [
      { v: grandHours.toFixed(1) },
      { v: money(Math.round(grandEarned)) + ' ₽' },
      { v: money(Math.round(grandPerDiem)) + ' ₽' },
      { v: money(Math.round(grandTotal)) + ' ₽', gold: true },
    ].forEach(c => {
      const td = document.createElement('td');
      td.style.cssText = `padding:8px 8px;text-align:right;${c.gold ? 'color:var(--gold, #D4A843)' : ''}`;
      td.textContent = c.v;
      totalTr.appendChild(td);
    });
    tbody.appendChild(totalTr);

    table.appendChild(tbody);
    wrap.innerHTML = '';
    wrap.appendChild(table);

    // Summary text
    const summary = document.createElement('div');
    summary.className = 'help';
    summary.style.cssText = 'margin-top:8px;font-size:12px';
    summary.textContent = `${timesheet.length} сотрудников · суточные ${money(perDiem)} ₽/день`;
    wrap.appendChild(summary);
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB 5: ПОДОТЧЁТ (FUNDS)
  // ═══════════════════════════════════════════════════════════════════
  async function apiFunds(path, opts) {
    const r = await fetch('/api/field/funds' + path, { headers: hdr(), ...opts });
    return r.json();
  }

  const FUND_STATUS_LABELS = {
    issued: '🟡 Выдан', confirmed: '🟢 Подтверждён', reporting: '🔵 Отчётность', closed: '⚫ Закрыт',
  };

  async function renderFundsTab(container, work, user) {
    container.innerHTML = '<div class="help">Загрузка подотчётов…</div>';

    let data;
    try { data = await apiFunds('/?work_id=' + work.id); } catch (_) {}

    container.innerHTML = '';

    // Issue funds button
    const topBar = document.createElement('div');
    topBar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px';
    topBar.innerHTML = `<span style="font-weight:600;font-size:14px">Подотчёты мастеров</span>`;
    const addBtn = document.createElement('button');
    addBtn.className = 'btn gold';
    addBtn.textContent = '+ Выдать средства';
    addBtn.style.cssText = 'font-size:12px;padding:6px 14px';
    addBtn.addEventListener('click', () => openIssueFundsModal(work, container, user));
    topBar.appendChild(addBtn);
    container.appendChild(topBar);

    if (!data || !data.funds || data.funds.length === 0) {
      container.innerHTML += '<div class="help" style="padding:32px;text-align:center">Нет подотчётов для этого проекта</div>';
      return;
    }

    // Table
    const table = document.createElement('table');
    table.className = 'fk-table fk-table-small';
    table.style.cssText = 'width:100%;font-size:12px';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Мастер</th><th>Цель</th><th style="text-align:right">Выдано</th><th style="text-align:right">Потрачено</th><th style="text-align:right">Возврат</th><th style="text-align:right">Остаток</th><th>Статус</th><th></th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const f of data.funds) {
      const remainder = (parseFloat(f.amount) - parseFloat(f.spent) - parseFloat(f.returned)).toFixed(2);
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.innerHTML = `
        <td>${esc(f.master_name || '—')}</td>
        <td>${esc(f.purpose || '—')}</td>
        <td style="text-align:right">${money(f.amount)} ₽</td>
        <td style="text-align:right;color:#ef4444">${money(f.spent)} ₽</td>
        <td style="text-align:right;color:#22c55e">${money(f.returned)} ₽</td>
        <td style="text-align:right;color:var(--gold,#D4A843);font-weight:600">${money(remainder)} ₽</td>
        <td><span style="font-size:11px">${FUND_STATUS_LABELS[f.status] || f.status}</span></td>
        <td>${f.status !== 'closed' ? '<button class="btn ghost close-fund" data-id="' + f.id + '" style="font-size:11px;padding:4px 8px">Закрыть</button>' : ''}</td>
      `;
      tr.addEventListener('click', (e) => {
        if (e.target.classList.contains('close-fund')) return;
        openFundDetailModal(f.id, work);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);

    // Close fund handlers
    container.querySelectorAll('.close-fund').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Закрыть подотчёт? Это нельзя отменить.')) return;
        try {
          await fetch('/api/field/funds/' + btn.dataset.id + '/close', { method: 'PUT', headers: hdr() });
          toast('Подотчёт закрыт');
          renderFundsTab(container, work, user);
        } catch (err) { toast('Ошибка: ' + err.message); }
      });
    });

    // Summary
    let totalIssued = 0, totalSpent = 0, totalReturned = 0;
    for (const f of data.funds) {
      totalIssued += parseFloat(f.amount);
      totalSpent += parseFloat(f.spent);
      totalReturned += parseFloat(f.returned);
    }
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'help';
    summaryDiv.style.cssText = 'margin-top:8px;font-size:12px';
    summaryDiv.textContent = `Итого: выдано ${money(totalIssued)}₽ · потрачено ${money(totalSpent)}₽ · возврат ${money(totalReturned)}₽ · остаток ${money(totalIssued - totalSpent - totalReturned)}₽`;
    container.appendChild(summaryDiv);
  }

  function openIssueFundsModal(work, parentContainer, user) {
    AsgardUI.showModal({
      title: '💰 Выдать средства',
      html: `
        <div style="display:flex;flex-direction:column;gap:12px;max-width:480px">
          <label>Мастер (сотрудник)
            <select id="fundsMaster" class="inp" style="width:100%"><option value="">Загрузка…</option></select>
          </label>
          <label>Сумма, ₽
            <input id="fundsAmount" type="number" step="0.01" class="inp" style="width:100%" placeholder="50000">
          </label>
          <label>Назначение
            <input id="fundsPurpose" type="text" class="inp" style="width:100%" placeholder="Расходные материалы на объект">
          </label>
          <label>Дедлайн подтверждения
            <input id="fundsDeadline" type="datetime-local" class="inp" style="width:100%">
          </label>
          <button id="fundsSubmit" class="btn gold" style="margin-top:8px">Выдать</button>
        </div>
      `,
      onMount: async () => {
        // Load crew for dropdown
        try {
          const crewData = await apiField('/logistics/?work_id=' + work.id);
          const select = document.getElementById('fundsMaster');
          select.innerHTML = '<option value="">— Выберите мастера —</option>';
          const seen = new Set();
          if (crewData && crewData.logistics) {
            for (const item of crewData.logistics) {
              if (!seen.has(item.employee_id)) {
                seen.add(item.employee_id);
                select.innerHTML += `<option value="${item.employee_id}">${esc(item.fio)}</option>`;
              }
            }
          }
          // Also try crew roster
          try {
            const crewResp = await api('/projects/' + work.id + '/dashboard');
            if (crewResp && crewResp.crew) {
              for (const c of crewResp.crew) {
                if (!seen.has(c.employee_id)) {
                  seen.add(c.employee_id);
                  select.innerHTML += `<option value="${c.employee_id}">${esc(c.fio || c.employee_name)}</option>`;
                }
              }
            }
          } catch (_) {}
        } catch (_) {}

        document.getElementById('fundsSubmit').addEventListener('click', async () => {
          const masterId = document.getElementById('fundsMaster').value;
          const amount = parseFloat(document.getElementById('fundsAmount').value);
          const purpose = document.getElementById('fundsPurpose').value.trim();
          const deadline = document.getElementById('fundsDeadline').value || null;

          if (!masterId) { toast('Выберите мастера'); return; }
          if (!amount || amount <= 0) { toast('Укажите сумму'); return; }
          if (!purpose) { toast('Укажите назначение'); return; }

          try {
            const result = await apiFunds('/', {
              method: 'POST',
              body: JSON.stringify({
                work_id: work.id,
                master_employee_id: parseInt(masterId),
                amount, purpose,
                confirm_deadline: deadline,
              }),
            });
            if (result.error) { toast('Ошибка: ' + result.error); return; }
            toast('Средства выданы!');
            document.querySelector('.modal-overlay')?.remove();
            renderFundsTab(parentContainer, work, user);
          } catch (err) { toast('Ошибка: ' + err.message); }
        });
      }
    });
  }

  async function openFundDetailModal(fundId, work) {
    let data;
    try { data = await apiFunds('/' + fundId); } catch (_) {}
    if (!data || !data.fund) { toast('Не удалось загрузить'); return; }

    const f = data.fund;
    const remainder = (parseFloat(f.amount) - parseFloat(f.spent) - parseFloat(f.returned)).toFixed(2);

    let expensesHtml = '';
    if (data.expenses && data.expenses.length > 0) {
      expensesHtml = '<table class="fk-table fk-table-small" style="width:100%;font-size:11px;margin-top:12px"><thead><tr><th>Дата</th><th>Описание</th><th>Категория</th><th style="text-align:right">Сумма</th><th>Источник</th><th>Чек</th></tr></thead><tbody>';
      for (const e of data.expenses) {
        const receiptLink = e.receipt_filename ? `<a href="/uploads/receipts/${esc(e.receipt_filename)}" target="_blank">📎</a>` : '—';
        expensesHtml += `<tr><td>${formatDate(e.expense_date)}</td><td>${esc(e.description)}</td><td>${esc(e.category || '—')}</td><td style="text-align:right">${money(e.amount)}₽</td><td>${e.source === 'own' ? '💳 Свои' : '💰 Аванс'}</td><td>${receiptLink}</td></tr>`;
      }
      expensesHtml += '</tbody></table>';
    }

    let returnsHtml = '';
    if (data.returns && data.returns.length > 0) {
      returnsHtml = '<div style="margin-top:12px;font-weight:600;font-size:13px">Возвраты:</div><table class="fk-table fk-table-small" style="width:100%;font-size:11px"><thead><tr><th>Дата</th><th style="text-align:right">Сумма</th><th>Примечание</th></tr></thead><tbody>';
      for (const r of data.returns) {
        returnsHtml += `<tr><td>${formatDate(r.created_at)}</td><td style="text-align:right">${money(r.amount)}₽</td><td>${esc(r.note || '—')}</td></tr>`;
      }
      returnsHtml += '</tbody></table>';
    }

    AsgardUI.showModal({
      title: '💰 ' + esc(f.purpose),
      html: `
        <div style="max-width:700px">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
            <div style="background:var(--bg-2,#1a1a2e);padding:12px;border-radius:10px;text-align:center">
              <div style="font-size:11px;color:var(--text-sec,#aaa);text-transform:uppercase">Выдано</div>
              <div style="font-size:18px;font-weight:700;margin-top:4px">${money(f.amount)}₽</div>
            </div>
            <div style="background:var(--bg-2,#1a1a2e);padding:12px;border-radius:10px;text-align:center">
              <div style="font-size:11px;color:var(--text-sec,#aaa);text-transform:uppercase">Потрачено</div>
              <div style="font-size:18px;font-weight:700;color:#ef4444;margin-top:4px">${money(f.spent)}₽</div>
            </div>
            <div style="background:var(--bg-2,#1a1a2e);padding:12px;border-radius:10px;text-align:center">
              <div style="font-size:11px;color:var(--text-sec,#aaa);text-transform:uppercase">Возврат</div>
              <div style="font-size:18px;font-weight:700;color:#22c55e;margin-top:4px">${money(f.returned)}₽</div>
            </div>
            <div style="background:var(--bg-2,#1a1a2e);padding:12px;border-radius:10px;text-align:center">
              <div style="font-size:11px;color:var(--text-sec,#aaa);text-transform:uppercase">Остаток</div>
              <div style="font-size:18px;font-weight:700;color:var(--gold,#D4A843);margin-top:4px">${money(remainder)}₽</div>
            </div>
          </div>
          <div style="font-size:12px;color:var(--text-sec,#aaa);margin-bottom:4px">Мастер: <strong>${esc(f.master_name || '—')}</strong> · Статус: ${FUND_STATUS_LABELS[f.status] || f.status}</div>
          ${data.expenses.length ? '<div style="font-weight:600;font-size:13px;margin-top:12px">Расходы:</div>' : ''}
          ${expensesHtml}
          ${returnsHtml}
        </div>
      `,
      wide: true,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB 6: СБОРЫ (PACKING)
  // ═══════════════════════════════════════════════════════════════════
  async function apiPacking(path, opts) {
    const r = await fetch('/api/field/packing' + path, { headers: hdr(), ...opts });
    return r.json();
  }

  const PACK_STATUS_LABELS = {
    draft: '⚪ Черновик', sent: '🟡 Назначен', in_progress: '🔵 В сборке', completed: '🟢 Собран', shipped: '🟣 Отправлен',
  };

  async function renderPackingTab(container, work, user) {
    container.innerHTML = '<div class="help">Загрузка листов сборки…</div>';

    let data;
    try { data = await apiPacking('/?work_id=' + work.id); } catch (_) {}

    container.innerHTML = '';

    // Create button
    const topBar = document.createElement('div');
    topBar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px';
    topBar.innerHTML = `<span style="font-weight:600;font-size:14px">Листы сборки</span>`;
    const addBtn = document.createElement('button');
    addBtn.className = 'btn gold';
    addBtn.textContent = '+ Новый лист';
    addBtn.style.cssText = 'font-size:12px;padding:6px 14px';
    addBtn.addEventListener('click', () => openCreatePackingModal(work, container, user));
    topBar.appendChild(addBtn);
    container.appendChild(topBar);

    if (!data || !data.lists || data.lists.length === 0) {
      container.innerHTML += '<div class="help" style="padding:32px;text-align:center">Нет листов сборки для этого проекта</div>';
      return;
    }

    // Table
    const table = document.createElement('table');
    table.className = 'fk-table fk-table-small';
    table.style.cssText = 'width:100%;font-size:12px';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Название</th><th>Назначен</th><th>Прогресс</th><th>Срок</th><th>Статус</th><th></th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const l of data.lists) {
      const pct = l.items_total > 0 ? Math.round((l.items_packed / l.items_total) * 100) : 0;
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.innerHTML = `
        <td><strong>${esc(l.title)}</strong>${l.description ? '<br><span style="font-size:10px;color:var(--text-sec)">' + esc(l.description.substring(0, 60)) + '</span>' : ''}</td>
        <td>${esc(l.assigned_to_name || '—')}</td>
        <td>
          <div style="display:flex;align-items:center;gap:6px">
            <div style="flex:1;height:6px;background:var(--bg-3,#333);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#D4A843,#E5C06E);border-radius:3px"></div></div>
            <span style="font-size:11px;white-space:nowrap">${l.items_packed}/${l.items_total}</span>
          </div>
        </td>
        <td>${l.due_date ? formatDate(l.due_date) : '—'}</td>
        <td><span style="font-size:11px">${PACK_STATUS_LABELS[l.status] || l.status}</span></td>
        <td>${!l.assigned_to ? '<button class="btn ghost assign-pack" data-id="' + l.id + '" style="font-size:11px;padding:4px 8px">Назначить</button>' : ''}</td>
      `;
      tr.addEventListener('click', (e) => {
        if (e.target.classList.contains('assign-pack')) return;
        openPackingDetailModal(l.id, work, container, user);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);

    // Assign handlers
    container.querySelectorAll('.assign-pack').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openAssignPackingModal(parseInt(btn.dataset.id), work, container, user);
      });
    });
  }

  function openCreatePackingModal(work, parentContainer, user) {
    AsgardUI.showModal({
      title: '📦 Новый лист сборки',
      html: `
        <div style="display:flex;flex-direction:column;gap:12px;max-width:480px">
          <label>Название<input id="packTitle" type="text" class="inp" style="width:100%" placeholder="Основное оборудование"></label>
          <label>Описание<textarea id="packDesc" class="inp" style="width:100%;min-height:60px" placeholder="Что нужно собрать"></textarea></label>
          <label>Срок<input id="packDue" type="date" class="inp" style="width:100%"></label>
          <div id="packItemsBlock">
            <div style="font-weight:600;font-size:13px;margin-bottom:8px">Позиции</div>
            <div id="packItemsList"></div>
            <button id="packAddItem" class="btn ghost" style="font-size:12px;margin-top:4px">+ Добавить позицию</button>
          </div>
          <button id="packSubmit" class="btn gold" style="margin-top:8px">Создать</button>
        </div>
      `,
      onMount: () => {
        const list = document.getElementById('packItemsList');
        let itemCount = 0;

        function addItemRow() {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center';
          row.innerHTML = `
            <input type="text" class="inp pack-item-name" placeholder="Название" style="flex:2;font-size:12px">
            <input type="number" class="inp pack-item-qty" placeholder="Кол-во" value="1" min="1" style="width:60px;font-size:12px">
            <input type="text" class="inp pack-item-cat" placeholder="Категория" style="flex:1;font-size:12px">
            <button class="btn ghost" style="font-size:11px;padding:4px 6px;color:#ef4444" onclick="this.parentElement.remove()">✕</button>
          `;
          list.appendChild(row);
          itemCount++;
        }

        addItemRow();
        document.getElementById('packAddItem').addEventListener('click', addItemRow);

        document.getElementById('packSubmit').addEventListener('click', async () => {
          const title = document.getElementById('packTitle').value.trim();
          if (!title) { toast('Укажите название'); return; }

          const items = [];
          list.querySelectorAll('div').forEach(row => {
            const name = row.querySelector('.pack-item-name')?.value.trim();
            const qty = parseInt(row.querySelector('.pack-item-qty')?.value) || 1;
            const cat = row.querySelector('.pack-item-cat')?.value.trim() || null;
            if (name) items.push({ item_name: name, quantity_required: qty, item_category: cat });
          });

          try {
            const result = await apiPacking('/', {
              method: 'POST',
              body: JSON.stringify({
                work_id: work.id,
                title,
                description: document.getElementById('packDesc').value.trim() || null,
                due_date: document.getElementById('packDue').value || null,
                items,
              }),
            });
            if (result.error) { toast('Ошибка: ' + result.error); return; }
            toast('Лист сборки создан!');
            document.querySelector('.modal-overlay')?.remove();
            renderPackingTab(parentContainer, work, user);
          } catch (err) { toast('Ошибка: ' + err.message); }
        });
      }
    });
  }

  async function openPackingDetailModal(listId, work, parentContainer, user) {
    let data;
    try { data = await apiPacking('/' + listId); } catch (_) {}
    if (!data || !data.list) { toast('Не удалось загрузить'); return; }

    const l = data.list;
    const items = data.items || [];
    const pct = l.items_total > 0 ? Math.round((l.items_packed / l.items_total) * 100) : 0;

    let itemsHtml = '';
    if (items.length > 0) {
      itemsHtml = '<table class="fk-table fk-table-small" style="width:100%;font-size:11px;margin-top:12px"><thead><tr><th>#</th><th>Позиция</th><th>Категория</th><th>Требуется</th><th>Собрано</th><th>Статус</th><th>Фото</th></tr></thead><tbody>';
      items.forEach((it, i) => {
        const itStatus = { pending: '⬜', packed: '✅', shortage: '⚠️', replaced: '🔄' };
        const photoLink = it.photo_filename ? `<a href="/uploads/packing/${esc(it.photo_filename)}" target="_blank">📷</a>` : '—';
        itemsHtml += `<tr><td>${i + 1}</td><td>${esc(it.item_name)}</td><td>${esc(it.item_category || '—')}</td><td>${it.quantity_required} ${esc(it.unit)}</td><td>${it.quantity_packed}</td><td>${itStatus[it.status] || it.status}${it.shortage_note ? ' <span style="color:#ef4444;font-size:10px">' + esc(it.shortage_note) + '</span>' : ''}</td><td>${photoLink}</td></tr>`;
      });
      itemsHtml += '</tbody></table>';
    }

    AsgardUI.showModal({
      title: '📦 ' + esc(l.title),
      html: `
        <div style="max-width:700px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
            <div style="flex:1;height:8px;background:var(--bg-3,#333);border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#D4A843,#E5C06E);border-radius:4px"></div></div>
            <span style="font-size:13px;font-weight:600">${pct}%</span>
            <span style="font-size:12px;color:var(--text-sec,#aaa)">${PACK_STATUS_LABELS[l.status] || l.status}</span>
          </div>
          <div style="font-size:12px;color:var(--text-sec,#aaa);margin-bottom:4px">
            Назначен: <strong>${esc(l.assigned_to_name || 'не назначен')}</strong>
            ${l.due_date ? ' · Срок: ' + formatDate(l.due_date) : ''}
            ${l.tracking_number ? ' · Трек: ' + esc(l.tracking_number) : ''}
          </div>
          ${l.description ? '<div style="font-size:12px;margin-bottom:8px;color:var(--text-sec,#aaa)">' + esc(l.description) + '</div>' : ''}
          ${itemsHtml}
        </div>
      `,
      wide: true,
    });
  }

  async function openAssignPackingModal(listId, work, parentContainer, user) {
    AsgardUI.showModal({
      title: '📦 Назначить сборщика',
      html: `
        <div style="display:flex;flex-direction:column;gap:12px;max-width:400px">
          <label>Сотрудник<select id="packAssignee" class="inp" style="width:100%"><option value="">Загрузка…</option></select></label>
          <label><input type="checkbox" id="packSendSms" checked> Отправить SMS-уведомление</label>
          <button id="packAssignSubmit" class="btn gold">Назначить</button>
        </div>
      `,
      onMount: async () => {
        try {
          const crewResp = await api('/projects/' + work.id + '/dashboard');
          const select = document.getElementById('packAssignee');
          select.innerHTML = '<option value="">— Выберите —</option>';
          if (crewResp && crewResp.crew) {
            for (const c of crewResp.crew) {
              select.innerHTML += `<option value="${c.employee_id}">${esc(c.fio || c.employee_name)}</option>`;
            }
          }
        } catch (_) {}

        document.getElementById('packAssignSubmit').addEventListener('click', async () => {
          const empId = document.getElementById('packAssignee').value;
          if (!empId) { toast('Выберите сотрудника'); return; }

          try {
            const result = await apiPacking('/' + listId + '/assign', {
              method: 'POST',
              body: JSON.stringify({
                employee_id: parseInt(empId),
                send_sms: document.getElementById('packSendSms').checked,
              }),
            });
            if (result.error) { toast('Ошибка: ' + result.error); return; }
            toast('Сборщик назначен!' + (result.sms_sent ? ' SMS отправлен' : ''));
            document.querySelector('.modal-overlay')?.remove();
            renderPackingTab(parentContainer, work, user);
          } catch (err) { toast('Ошибка: ' + err.message); }
        });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB 7: МАРШРУТЫ (STAGES) — Session 12
  // ═══════════════════════════════════════════════════════════════════
  const STAGE_COLORS = {
    medical: '#9333EA', travel: '#3B82F6', waiting: '#F59E0B',
    warehouse: '#F97316', day_off: '#9CA3AF', object: '#22C55E',
  };
  const STAGE_LABELS_DT = {
    medical: 'Медосмотр', travel: 'Дорога', waiting: 'Ожидание',
    warehouse: 'Склад', day_off: 'Выходной', object: 'Объект',
  };
  const STAGE_ICONS_DT = {
    medical: '🟣', travel: '🔵', waiting: '🟡',
    warehouse: '🟠', day_off: '⚪', object: '🟢',
  };

  async function renderStagesTab(container, work, user) {
    container.innerHTML = '<div class="help">Загрузка маршрутов…</div>';

    // Date range: last 30 days to +15 days
    const now = new Date();
    const from = new Date(now); from.setDate(from.getDate() - 30);
    const to = new Date(now); to.setDate(to.getDate() + 15);
    const df = from.toISOString().slice(0, 10);
    const dt = to.toISOString().slice(0, 10);

    const [calData, listData] = await Promise.all([
      apiField(`/stages/project/${work.id}/calendar?date_from=${df}&date_to=${dt}`),
      apiField(`/stages/project/${work.id}`),
    ]);

    container.innerHTML = '';

    // ── Legend ──
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;font-size:12px';
    for (const [key, color] of Object.entries(STAGE_COLORS)) {
      const item = document.createElement('span');
      item.innerHTML = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:4px;vertical-align:middle"></span>${esc(STAGE_LABELS_DT[key])}`;
      legend.appendChild(item);
    }
    container.appendChild(legend);

    // ── Calendar grid ──
    if (calData && calData.employees && calData.employees.length > 0) {
      const calWrap = document.createElement('div');
      calWrap.style.cssText = 'overflow-x:auto;margin-bottom:20px;border:1px solid var(--brd, rgba(255,255,255,0.08));border-radius:8px';

      const table = document.createElement('table');
      table.style.cssText = 'border-collapse:collapse;font-size:11px;min-width:100%';

      // Header: dates
      const dates = [];
      const cur = new Date(df);
      const end = new Date(dt);
      while (cur <= end) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setDate(cur.getDate() + 1);
      }

      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      headerRow.innerHTML = '<th style="padding:4px 8px;text-align:left;white-space:nowrap;position:sticky;left:0;background:var(--bg2,#151922);z-index:1">Сотрудник</th>';
      for (const d of dates) {
        const dd = new Date(d);
        const isToday = d === now.toISOString().slice(0, 10);
        headerRow.innerHTML += `<th style="padding:2px 1px;text-align:center;min-width:22px;font-weight:${isToday ? '700' : '400'};${isToday ? 'color:var(--gold,#D4A843)' : ''}">${dd.getDate()}</th>`;
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      for (const emp of calData.employees) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="padding:4px 8px;white-space:nowrap;position:sticky;left:0;background:var(--bg2,#151922);z-index:1;border-top:1px solid var(--brd,rgba(255,255,255,0.06))">${esc(emp.fio)}</td>`;
        for (const d of dates) {
          const cell = emp.days[d];
          const bg = cell ? STAGE_COLORS[cell.type] || '#666' : 'transparent';
          const title = cell ? `${STAGE_LABELS_DT[cell.type] || cell.type} (${cell.status})` : '';
          tr.innerHTML += `<td style="padding:2px 1px;text-align:center;border-top:1px solid var(--brd,rgba(255,255,255,0.06))" title="${esc(title)}"><span style="display:inline-block;width:16px;height:16px;border-radius:4px;background:${bg}${cell ? '' : ';opacity:0.15'}"></span></td>`;
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      calWrap.appendChild(table);
      container.appendChild(calWrap);
    }

    // ── Employee list with stages ──
    const employees = (listData && listData.employees) || [];
    if (employees.length === 0) {
      container.innerHTML += '<div class="help">Нет этапов на этом проекте</div>';
      return;
    }

    for (const emp of employees) {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--bg2,#151922);border:1px solid var(--brd,rgba(255,255,255,0.08));border-radius:8px;padding:12px;margin-bottom:12px';

      const header = document.createElement('div');
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px';
      header.innerHTML = `<strong>${esc(emp.fio)}</strong><span style="color:var(--gold,#D4A843);font-size:12px">${emp.total_days} дн. · ${money(emp.total_earned)}₽</span>`;
      card.appendChild(header);

      for (const s of emp.stages) {
        const sRow = document.createElement('div');
        sRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px';
        const col = STAGE_COLORS[s.stage_type] || '#666';
        const df2 = formatDate(s.date_from);
        const dt2 = s.date_to ? ' – ' + formatDate(s.date_to) : '';
        const statusBadge = s.status === 'approved' ? '✅' : s.status === 'rejected' ? '❌' : s.status === 'active' ? '🔵' : s.status === 'completed' ? '✅' : '⬜';
        sRow.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col}"></span>` +
          `<span>${esc(STAGE_LABELS_DT[s.stage_type] || s.stage_type)}</span>` +
          `<span style="color:var(--text2,#999)">${df2}${dt2} · ${s.days_count || 1}д.</span>` +
          `<span style="margin-left:auto;font-weight:600">${money(s.amount_earned)}₽ ${statusBadge}</span>`;

        // Action buttons for non-approved
        if (!['approved', 'adjusted', 'rejected'].includes(s.status)) {
          const btnApprove = document.createElement('button');
          btnApprove.className = 'btn ghost';
          btnApprove.textContent = '✅';
          btnApprove.title = 'Подтвердить';
          btnApprove.style.cssText = 'padding:2px 6px;font-size:12px;margin-left:4px';
          btnApprove.addEventListener('click', async () => {
            await apiField(`/stages/${s.id}/approve`, { method: 'PUT', body: JSON.stringify({}) });
            toast('Этап подтверждён');
            renderStagesTab(container, work, user);
          });
          sRow.appendChild(btnApprove);

          const btnReject = document.createElement('button');
          btnReject.className = 'btn ghost';
          btnReject.textContent = '❌';
          btnReject.title = 'Отклонить';
          btnReject.style.cssText = 'padding:2px 6px;font-size:12px';
          btnReject.addEventListener('click', async () => {
            const reason = prompt('Причина отклонения:');
            if (!reason) return;
            await apiField(`/stages/${s.id}/reject`, { method: 'PUT', body: JSON.stringify({ adjustment_note: reason }) });
            toast('Этап отклонён');
            renderStagesTab(container, work, user);
          });
          sRow.appendChild(btnReject);
        }

        card.appendChild(sRow);
      }

      // Add stage button
      const addBtn = document.createElement('button');
      addBtn.className = 'btn ghost';
      addBtn.textContent = '+ Добавить этап';
      addBtn.style.cssText = 'margin-top:8px;font-size:12px;color:var(--gold,#D4A843)';
      addBtn.addEventListener('click', () => showAddStageModal(container, work, user, emp.employee_id, emp.fio));
      card.appendChild(addBtn);

      container.appendChild(card);
    }

    // Bulk action button
    const bulkBtn = document.createElement('button');
    bulkBtn.className = 'btn gold';
    bulkBtn.textContent = '📋 Массовое действие';
    bulkBtn.style.cssText = 'margin-top:8px;width:100%';
    bulkBtn.addEventListener('click', () => showBulkStageModal(container, work, user, employees));
    container.appendChild(bulkBtn);
  }

  function showAddStageModal(parentContainer, work, user, empId, empFio) {
    const types = ['medical', 'travel', 'waiting', 'warehouse', 'day_off'];
    const today = new Date().toISOString().slice(0, 10);
    let selectedType = 'medical';

    const typeSelect = types.map(t =>
      `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:4px 0">
        <input type="radio" name="stType" value="${t}" ${t === selectedType ? 'checked' : ''}>
        ${STAGE_ICONS_DT[t]} ${esc(STAGE_LABELS_DT[t])}
      </label>`
    ).join('');

    AsgardUI.showModal({
      title: 'Добавить этап — ' + esc(empFio),
      html: `<div style="display:flex;flex-direction:column;gap:12px">
        <div>${typeSelect}</div>
        <label>Дата начала<br><input type="date" id="stDateFrom" value="${today}" class="input"></label>
        <label>Дата конца (опц.)<br><input type="date" id="stDateTo" class="input"></label>
        <label>Заметка<br><input type="text" id="stNote" class="input" placeholder="Необязательно"></label>
        <button class="btn gold" id="stSubmit">Создать</button>
      </div>`,
      onMount: () => {
        document.querySelectorAll('input[name="stType"]').forEach(r => r.addEventListener('change', e => { selectedType = e.target.value; }));
        document.getElementById('stSubmit').addEventListener('click', async () => {
          const dateFrom = document.getElementById('stDateFrom').value;
          const dateTo = document.getElementById('stDateTo').value || undefined;
          const note = document.getElementById('stNote').value || undefined;
          const result = await apiField('/stages/', {
            method: 'POST',
            body: JSON.stringify({ employee_id: empId, work_id: work.id, stage_type: selectedType, date_from: dateFrom, date_to: dateTo, note }),
          });
          if (result.error) { toast('Ошибка: ' + result.error); return; }
          toast('Этап создан');
          document.querySelector('.modal-overlay')?.remove();
          renderStagesTab(parentContainer, work, user);
        });
      }
    });
  }

  function showBulkStageModal(parentContainer, work, user, employees) {
    const types = ['day_off', 'waiting', 'travel', 'medical', 'warehouse'];
    const today = new Date().toISOString().slice(0, 10);

    const empCheckboxes = employees.map(e =>
      `<label style="display:flex;align-items:center;gap:6px;padding:2px 0"><input type="checkbox" value="${e.employee_id}" class="bulkEmpCb"> ${esc(e.fio)}</label>`
    ).join('');

    const typeOptions = types.map(t =>
      `<option value="${t}">${STAGE_LABELS_DT[t]}</option>`
    ).join('');

    AsgardUI.showModal({
      title: 'Массовое создание этапов',
      html: `<div style="display:flex;flex-direction:column;gap:12px">
        <div><label><input type="checkbox" id="bulkSelectAll"> Выбрать всех</label></div>
        <div style="max-height:200px;overflow-y:auto">${empCheckboxes}</div>
        <label>Тип этапа<br><select id="bulkType" class="input">${typeOptions}</select></label>
        <label>Дата<br><input type="date" id="bulkDate" value="${today}" class="input"></label>
        <button class="btn gold" id="bulkSubmit">Создать для выбранных</button>
      </div>`,
      onMount: () => {
        document.getElementById('bulkSelectAll').addEventListener('change', (e) => {
          document.querySelectorAll('.bulkEmpCb').forEach(cb => { cb.checked = e.target.checked; });
        });
        document.getElementById('bulkSubmit').addEventListener('click', async () => {
          const ids = [...document.querySelectorAll('.bulkEmpCb:checked')].map(cb => parseInt(cb.value));
          if (ids.length === 0) { toast('Выберите сотрудников'); return; }
          const result = await apiField('/stages/bulk', {
            method: 'POST',
            body: JSON.stringify({
              employee_ids: ids,
              work_id: work.id,
              stage_type: document.getElementById('bulkType').value,
              date_from: document.getElementById('bulkDate').value,
            }),
          });
          if (result.error) { toast('Ошибка: ' + result.error); return; }
          toast(`Создано ${result.created_count} этапов`);
          document.querySelector('.modal-overlay')?.remove();
          renderStagesTab(parentContainer, work, user);
        });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════
  return { openFieldModal };
})();
