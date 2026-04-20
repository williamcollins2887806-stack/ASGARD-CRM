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

  // Extract rows from generic data API response: { tableName: [...] } → [...]
  function dataRows(resp) {
    if (!resp || typeof resp !== 'object') return [];
    if (Array.isArray(resp)) return resp;
    // data API returns { tableName: rows, total, limit, offset }
    for (const key of Object.keys(resp)) {
      if (Array.isArray(resp[key])) return resp[key];
    }
    return [];
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
  const SHIFTS = [
    { value: 'day', label: '☀ День' },
    { value: 'night', label: '🌙 Ночь' },
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

  /* ── CRSelect row counter for crew selects ── */
  let _ftRowId = 0;
  const _ftTariffIds = [];  // track tariff CRSelect IDs for category-change re-population

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
      settingsData = dataRows(d2)[0] || null;
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
      { id: 'payments', label: '💳 Выплаты', render: () => renderPaymentsTab(content, work, user) },
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
    // Clean up previous CRSelect instances for crew rows
    _ftTariffIds.forEach(id => { try { CRSelect.destroy(id); } catch (_) {} });
    _ftTariffIds.length = 0;
    container.innerHTML = '<div class="help">Загрузка бригады…</div>';

    // Load tariffs and employees (с проверкой занятости по датам этой работы)
    const [tariffsData, empsData, assignData] = await Promise.all([
      api('/tariffs?category=all'),
      fetch(`/api/staff/employees/available?work_id=${work.id}`, { headers: hdr() }).then(r => r.json()).catch(() =>
        // fallback на старый endpoint если новый не доступен
        fetch('/api/data/employees?limit=2000', { headers: hdr() }).then(r => r.json())
      ),
      // Используем where-clause (data API игнорирует прямые поля как work_id=X)
      fetch(`/api/data/employee_assignments?where=${encodeURIComponent(JSON.stringify({work_id: work.id}))}&limit=500`, { headers: hdr() }).then(r => r.json()),
    ]);

    const allTariffs = tariffsData.tariffs || [];
    const specials = tariffsData.specials || [];
    // Endpoint /available возвращает employees с полями is_busy, busy_with[]
    const allEmployees = dataRows(empsData).sort((a, b) => (a.fio || '').localeCompare(b.fio || ''));
    // Защитный фильтр по work_id на клиенте (на случай если API проигнорирует where)
    const assignments = dataRows(assignData).filter(a => a.is_active !== false && Number(a.work_id) === Number(work.id));
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

    const catWrap = document.createElement('span');
    catWrap.id = 'fieldCategory_w';
    catWrap.style.cssText = 'display:inline-block;min-width:160px';
    settingsBar.appendChild(catWrap);
    catWrap.appendChild(CRSelect.create({
      id: 'fieldCategory',
      options: CATEGORIES.map(c => ({ value: c.value, label: c.label })),
      value: category || CATEGORIES[0]?.value || '',
      onChange: () => _onCategoryChange()
    }));

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
              site_category: CRSelect.getValue('fieldCategory'),
              per_diem: parseFloat(pdInput.value) || 0,
              schedule_type: 'shift',
              shift_hours: 11,
            })
          });
          toast('Field', 'Полевой модуль активирован! ⚔️', 'ok');
          isActive = true;
          settingsData = { site_category: CRSelect.getValue('fieldCategory'), per_diem: parseFloat(pdInput.value) || 0, is_active: true };
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
    const currentCat = CRSelect.getValue('fieldCategory');
    const filteredTariffs = allTariffs.filter(t => t.category === currentCat);
    const comboTariffs = specials.concat(allTariffs.filter(t => t.is_combinable));

    for (const a of assignments) {
      const emp = allEmployees.find(e => e.id === a.employee_id);
      if (!emp) continue;
      addCrewRow(tbody, emp, a, filteredTariffs, comboTariffs, allEmployees);
    }

    // Category change → re-filter tariffs (CRSelect onChange)
    function _onCategoryChange() {
      const newCat = CRSelect.getValue('fieldCategory');
      const newFiltered = allTariffs.filter(t => t.category === newCat);
      const newOpts = [{ value: '', label: '— выберите —' }].concat(
        newFiltered.map(t => ({ value: String(t.id), label: `${t.position_name} (${t.points}б · ${money(t.rate_per_shift)}₽)` }))
      );
      // Update all tariff CRSelect instances
      _ftTariffIds.forEach(crId => {
        try {
          const curVal = CRSelect.getValue(crId);
          CRSelect.setOptions(crId, newOpts);
          if (curVal) CRSelect.setValue(crId, curVal);
        } catch (_) { /* row may have been removed */ }
      });
      // Re-populate filteredTariffs reference for addCrewRow
      filteredTariffs.length = 0;
      filteredTariffs.push(...newFiltered);
    }

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
        const pickerWrap = row.querySelector('[data-field="employee"]');
        const pId = pickerWrap?.dataset.pickerId;
        const empIds = pId ? CREmployeePicker.getSelected(pId) : [];
        const empId = empIds[0];
        const rid = row.dataset.crewRid;
        const role = rid != null ? CRSelect.getValue('ft-role-' + rid) : null;
        const shiftType = rid != null ? CRSelect.getValue('ft-shift-' + rid) : null;
        const tariffId = rid != null ? CRSelect.getValue('ft-tariff-' + rid) : null;
        const comboId = rid != null ? CRSelect.getValue('ft-combo-' + rid) : null;
        if (empId) {
          employees.push({
            employee_id: empId,
            field_role: role || 'worker',
            shift_type: shiftType || 'day',
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
            site_category: CRSelect.getValue('fieldCategory'),
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
    const rid = _ftRowId++;
    const tr = document.createElement('tr');
    tr.dataset.crewRow = '1';
    tr.dataset.crewRid = rid;
    tr.style.cssText = 'border-bottom:1px solid var(--brd, rgba(255,255,255,0.06))';

    const cellStyle = 'padding:6px 8px;vertical-align:middle';

    // Employee picker (CREmployeePicker, single-select)
    const tdEmp = document.createElement('td');
    tdEmp.style.cssText = cellStyle + ';min-width:200px';
    const pickerId = 'crew-emp-' + (employee ? employee.id : Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    CREmployeePicker.destroy(pickerId);
    const pickerEl = CREmployeePicker.create({
      id: pickerId,
      employees: allEmployees.map(e => {
        const baseName = e.fio || e.full_name || `${e.last_name || ''} ${e.first_name || ''}`.trim() || '';
        // Если рабочий занят на другой работе — добавляем индикатор
        let suffix = '';
        if (e.is_busy && e.busy_with && e.busy_with.length) {
          const w = e.busy_with[0];
          const endStr = w.end_date ? new Date(w.end_date).toLocaleDateString('ru-RU') : '';
          suffix = ` 🔴 занят (${(w.work_title || '').slice(0, 30)} до ${endStr})`;
        } else if (e.busy_with !== undefined) {
          // Свободен — endpoint /available вернул данные
          suffix = ' ✅';
        }
        return {
          id: e.id,
          name: baseName + suffix,
          position: e.position || e.role_display || e.role || '',
          role: e.role || '',
        };
      }),
      selected: employee ? [employee.id] : [],
      maxSelect: 1,
      placeholder: '— сотрудник —',
      showChips: true,
      title: 'Выбор сотрудника',
      onChange: (ids) => {
        // Предупреждение если выбрали занятого рабочего
        if (!ids || !ids.length) return;
        const empId = ids[0];
        const emp = allEmployees.find(x => x.id === empId);
        if (emp && emp.is_busy && emp.busy_with && emp.busy_with.length) {
          const w = emp.busy_with[0];
          const endStr = w.end_date ? new Date(w.end_date).toLocaleDateString('ru-RU') : '';
          const startStr = w.start_date ? new Date(w.start_date).toLocaleDateString('ru-RU') : '';
          const ok = confirm(
            '⚠️ ВНИМАНИЕ — конфликт занятости\n\n' +
            (emp.fio || 'Сотрудник') + ' уже назначен на работу:\n' +
            '«' + (w.work_title || '?') + '»\n' +
            'с ' + startStr + ' по ' + endStr + '\n' +
            '(статус: ' + (w.status || '—') + ')\n\n' +
            'Назначить всё равно?'
          );
          if (!ok) {
            // Откатываем выбор
            CREmployeePicker.setSelected(pickerId, employee ? [employee.id] : []);
          }
        }
      },
    });
    pickerEl.dataset.field = 'employee';
    pickerEl.dataset.pickerId = pickerId;
    tdEmp.appendChild(pickerEl);
    tr.appendChild(tdEmp);

    // Role select (CRSelect)
    const tdRole = document.createElement('td');
    tdRole.style.cssText = cellStyle;
    const roleId = 'ft-role-' + rid;
    CRSelect.destroy(roleId);
    const selRoleEl = CRSelect.create({
      id: roleId,
      options: ROLES.map(r => ({ value: r.value, label: r.label })),
      value: assignment?.field_role || 'worker',
      searchable: false,
      clearable: false,
    });
    tdRole.appendChild(selRoleEl);
    tr.appendChild(tdRole);

    // Shift type select (День/Ночь)
    const tdShift = document.createElement('td');
    tdShift.style.cssText = cellStyle;
    const shiftId = 'ft-shift-' + rid;
    CRSelect.destroy(shiftId);
    const selShiftEl = CRSelect.create({
      id: shiftId,
      options: SHIFTS.map(s => ({ value: s.value, label: s.label })),
      value: assignment?.shift_type || 'day',
      searchable: false,
      clearable: false,
    });
    tdShift.appendChild(selShiftEl);
    tr.appendChild(tdShift);

    // Tariff select (CRSelect)
    const tdTariff = document.createElement('td');
    tdTariff.style.cssText = cellStyle + ';min-width:200px';
    const tariffId = 'ft-tariff-' + rid;
    CRSelect.destroy(tariffId);
    const tariffOpts = [{ value: '', label: '— выберите —' }].concat(
      tariffs.map(t => ({ value: String(t.id), label: `${t.position_name} (${t.points}б · ${money(t.rate_per_shift)}₽)` }))
    );
    const selTariffEl = CRSelect.create({
      id: tariffId,
      options: tariffOpts,
      value: assignment?.tariff_id ? String(assignment.tariff_id) : '',
      placeholder: '— выберите —',
      clearable: false,
      onChange: () => updatePointsRate(),
    });
    tdTariff.appendChild(selTariffEl);
    tr.appendChild(tdTariff);
    _ftTariffIds.push(tariffId);

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

    // Combination select (CRSelect)
    const tdCombo = document.createElement('td');
    tdCombo.style.cssText = cellStyle + ';text-align:center';
    const comboId = 'ft-combo-' + rid;
    CRSelect.destroy(comboId);
    const comboOpts = [{ value: '', label: 'Нет' }].concat(
      comboTariffs.filter(t => t.is_combinable).map(t => ({ value: String(t.id), label: `${t.position_name} (+${t.points || 1}б)` }))
    );
    const selComboEl = CRSelect.create({
      id: comboId,
      options: comboOpts,
      value: assignment?.combination_tariff_id ? String(assignment.combination_tariff_id) : '',
      placeholder: 'Нет',
      clearable: false,
      onChange: () => updatePointsRate(),
    });
    tdCombo.appendChild(selComboEl);
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
    delBtn.addEventListener('click', () => {
      CREmployeePicker.destroy(pickerId);
      CRSelect.destroy('ft-role-' + rid);
      CRSelect.destroy('ft-tariff-' + rid);
      CRSelect.destroy('ft-combo-' + rid);
      const idx = _ftTariffIds.indexOf('ft-tariff-' + rid);
      if (idx !== -1) _ftTariffIds.splice(idx, 1);
      tr.remove();
    });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    // Tariff/combo change → auto update points & rate (CRSelect onChange)
    function updatePointsRate() {
      const tVal = CRSelect.getValue('ft-tariff-' + rid);
      const tariff = tariffs.find(t => String(t.id) === tVal);
      const cVal = CRSelect.getValue('ft-combo-' + rid);
      const combo = comboTariffs.find(t => String(t.id) === cVal);

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
      // Используем where-clause (data API игнорирует прямые поля как work_id=X)
      fetch(`/api/data/employee_assignments?where=${encodeURIComponent(JSON.stringify({work_id: work.id}))}&limit=500`, { headers: hdr() }).then(r => r.json()),
    ]);

    const items = logData.items || logData.logistics || (Array.isArray(logData) ? logData : []);
    // Защитный фильтр по work_id на клиенте (на случай если API проигнорирует where)
    const assignments = dataRows(assignData).filter(a => a.is_active !== false && Number(a.work_id) === Number(work.id));

    // Load employee names
    const empIds = [...new Set(assignments.map(a => a.employee_id))];
    let empsMap = {};
    if (empIds.length) {
      try {
        const empsData = await fetch('/api/data/employees?limit=2000', { headers: hdr() }).then(r => r.json());
        dataRows(empsData).forEach(e => { empsMap[e.id] = e; });
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

    // Load point_value from project tariff (NOT hardcoded 500)
    let pointValue = 500; // fallback
    try {
      const dash = await api('/projects/' + work.id + '/dashboard');
      if (dash?.tariff?.point_value) pointValue = parseFloat(dash.tariff.point_value);
      else if (dash?.crew?.[0]?.point_value) pointValue = parseFloat(dash.crew[0].point_value);
    } catch (_) {}

    // Default: start_plan - 7 дней → end_plan + 7 дней (или last 30 days fallback)
    const today = new Date();
    const workStart = work.start_in_work_date || work.start_plan || work.start_fact;
    const workEnd = work.end_plan || work.end_fact;
    let dfFromDate, dfToDate;
    if (workStart) {
      dfFromDate = new Date(String(workStart).slice(0,10) + 'T12:00:00Z');
      dfFromDate.setDate(dfFromDate.getDate() - 7);
    } else {
      dfFromDate = new Date(today); dfFromDate.setDate(dfFromDate.getDate() - 30);
    }
    if (workEnd) {
      dfToDate = new Date(String(workEnd).slice(0,10) + 'T12:00:00Z');
      dfToDate.setDate(dfToDate.getDate() + 7);
    } else {
      dfToDate = new Date(today);
    }
    const dfFrom = dfFromDate.toISOString().slice(0, 10);
    const dfTo = dfToDate.toISOString().slice(0, 10);

    container.innerHTML = '';

    // Date filters
    const filters = document.createElement('div');
    filters.style.cssText = 'display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap';
    filters.innerHTML = `
      <button class="btn ghost" id="tsDayLeft" style="font-size:13px;padding:6px 10px" title="Добавить день слева">← День</button>
      <label style="font-size:13px;color:var(--t2)">С:</label>
      <input id="tsFrom" type="date" value="${dfFrom}" style="padding:6px 10px;border-radius:6px;background:var(--bg1);color:var(--t1);border:1px solid var(--brd);font-size:13px" />
      <label style="font-size:13px;color:var(--t2)">По:</label>
      <input id="tsTo" type="date" value="${dfTo}" style="padding:6px 10px;border-radius:6px;background:var(--bg1);color:var(--t1);border:1px solid var(--brd);font-size:13px" />
      <button class="btn ghost" id="tsDayRight" style="font-size:13px;padding:6px 10px" title="Добавить день справа">День →</button>
      <button class="btn ghost" id="tsLoad" style="font-size:13px">Загрузить</button>
      <button class="btn" id="tsEdit" style="font-size:13px;background:linear-gradient(135deg,#D4A843,#b8922e);color:#fff">Редактировать</button>
      <button class="btn" id="tsExport" style="font-size:13px;margin-left:auto;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff">📥 Выгрузить Excel</button>
    `;
    container.appendChild(filters);

    let editMode = false;

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
        renderTimesheetTable(tableWrap, data, from, to, editMode, work, pointValue);
      } catch (e) {
        tableWrap.innerHTML = '<div class="help" style="color:#ef4444">Ошибка загрузки табеля</div>';
      }
    }

    // Кнопки «← День» / «День →»
    document.getElementById('tsDayLeft')?.addEventListener('click', () => {
      const inp = document.getElementById('tsFrom');
      if (!inp) return;
      const d = new Date(inp.value + 'T12:00:00Z');
      d.setDate(d.getDate() - 1);
      inp.value = d.toISOString().slice(0, 10);
      loadTimesheet();
    });
    document.getElementById('tsDayRight')?.addEventListener('click', () => {
      const inp = document.getElementById('tsTo');
      if (!inp) return;
      const d = new Date(inp.value + 'T12:00:00Z');
      d.setDate(d.getDate() + 1);
      inp.value = d.toISOString().slice(0, 10);
      loadTimesheet();
    });

    document.getElementById('tsEdit')?.addEventListener('click', () => {
      editMode = !editMode;
      const btn = document.getElementById('tsEdit');
      if (btn) {
        btn.textContent = editMode ? 'Просмотр' : 'Редактировать';
        btn.style.background = editMode ? 'linear-gradient(135deg,#ef4444,#dc2626)' : 'linear-gradient(135deg,#D4A843,#b8922e)';
      }
      loadTimesheet();
    });

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

  function renderTimesheetTable(wrap, data, from, to, editMode, work, pv) {
    const timesheet = data.timesheet || [];
    const perDiem = data.per_diem_rate || 0;
    pv = pv || 500; // point_value из тарифа, fallback 500

    if (!timesheet.length && !editMode) {
      wrap.innerHTML = '<div class="help" style="text-align:center;padding:40px;color:var(--t2)">Нет данных за выбранный период</div>';
      return;
    }

    // Генерируем ВСЕ дни от from до to (не только с checkin'ами)
    const dates = [];
    if (from && to) {
      const ymdF = String(from).slice(0,10).split('-');
      const ymdT = String(to).slice(0,10).split('-');
      const dCur = new Date(Number(ymdF[0]), Number(ymdF[1])-1, Number(ymdF[2]));
      const dEnd = new Date(Number(ymdT[0]), Number(ymdT[1])-1, Number(ymdT[2]));
      while (dCur <= dEnd) {
        const iso = dCur.getFullYear() + '-' + String(dCur.getMonth()+1).padStart(2,'0') + '-' + String(dCur.getDate()).padStart(2,'0');
        dates.push(iso);
        dCur.setDate(dCur.getDate() + 1);
      }
    }
    // Fallback: если from/to не указаны, берём даты из checkin'ов
    if (!dates.length) {
      const allDates = new Set();
      timesheet.forEach(emp => (emp.days || []).forEach(d => allDates.add(String(d.date).slice(0,10))));
      dates.push(...[...allDates].sort());
    }

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';

    // Header
    const thStyle = 'padding:6px 8px;border-bottom:1px solid var(--brd);color:var(--t2);font-weight:500;font-size:11px;white-space:nowrap;position:sticky;top:0;background:var(--bg2, #151922)';
    let headerHtml = `<tr><th style="${thStyle};text-align:left;min-width:150px">ФИО</th>`;
    dates.forEach(d => {
      // d может быть 'YYYY-MM-DD' или 'YYYY-MM-DDT12:00:00.000Z' (после TZ-фикса)
      // Извлекаем ровно YYYY-MM-DD и парсим как локальную дату
      const ymd = String(d).slice(0, 10).split('-');
      const day = new Date(Number(ymd[0]), Number(ymd[1]) - 1, Number(ymd[2]));
      const label = String(day.getDate()).padStart(2, '0') + '.' + String(day.getMonth() + 1).padStart(2, '0');
      headerHtml += `<th style="${thStyle};text-align:center">${label}</th>`;
    });
    headerHtml += `<th style="${thStyle};text-align:center">Дней</th>`;
    headerHtml += `<th style="${thStyle};text-align:right">Баллов</th>`;
    headerHtml += `<th style="${thStyle};text-align:right">Зараб.</th>`;
    headerHtml += `<th style="${thStyle};text-align:right">Суточные</th>`;
    headerHtml += `<th style="${thStyle};text-align:right;color:var(--gold)">Итого</th>`;
    if (editMode) headerHtml += `<th style="${thStyle};width:40px"></th>`;
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

      // Day cells — нормализуем ключи к YYYY-MM-DD (checkin.date может быть ISO timestamp)
      const dayMap = {};
      (emp.days || []).forEach(d => { dayMap[String(d.date).slice(0,10)] = d; });

      dates.forEach(d => {
        const td = document.createElement('td');
        td.style.cssText = 'padding:4px 6px;text-align:center';
        const day = dayMap[d];

        if (editMode) {
          // Editable mode — show points + shift icon
          td.style.cursor = 'pointer';
          td.style.border = '1px dashed var(--brd, rgba(255,255,255,0.15))';
          td.style.borderRadius = '4px';
          if (day) {
            const pts = Math.round(parseFloat(day.day_rate || 0) / pv) || 0;
            const si = _shiftIcon(day.shift);
            td.innerHTML = si.icon + pts;
            td.style.color = pts >= 18 ? '#D4A843' : pts >= 12 ? '#10b981' : '#3b82f6';
            if (si.bg) td.style.background = si.bg;
            td.title = `${si.label} ${pts} бал. = ${money(pts * pv)} ₽. Клик для редактирования`;
            td.addEventListener('click', () => editCheckinCell(td, day, emp, d, work, pv));
          } else {
            td.textContent = '+';
            td.style.color = 'var(--t2, #4b5563)';
            td.style.opacity = '0.5';
            td.title = 'Добавить смену';
            td.addEventListener('click', () => addCheckinCell(td, emp, d, work, pv));
          }
        } else {
          // View mode — show points + shift icon
          if (day) {
            const pts = Math.round(parseFloat(day.day_rate || 0) / pv) || 0;
            const si = _shiftIcon(day.shift);
            td.innerHTML = si.icon + pts;
            td.style.color = pts >= 18 ? '#D4A843' : pts >= 12 ? '#10b981' : pts >= 6 ? '#3b82f6' : 'var(--t2)';
            if (si.bg) td.style.background = si.bg;
            td.title = `${d}: ${si.label} ${pts} бал. = ${money(pts * pv)} ₽`;
          } else {
            td.textContent = '—';
            td.style.color = 'var(--t2, #4b5563)';
          }
        }
        tr.appendChild(td);
      });

      // Summary cells
      const daysCount = emp.days_count || 0;
      const earned = emp.total_earned || 0;
      const totalPoints = Math.round(earned / pv) || 0;
      const pd = emp.per_diem_total || 0;
      const total = emp.grand_total || 0;

      grandHours += totalPoints;
      grandEarned += earned;
      grandPerDiem += pd;
      grandTotal += total;

      [
        { v: daysCount, align: 'center' },
        { v: totalPoints, align: 'right' },
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

      if (editMode) {
        const tdDel = document.createElement('td');
        tdDel.style.cssText = 'padding:6px 4px;text-align:center';
        tr.appendChild(tdDel);
      }

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
      { v: grandHours },
      { v: money(Math.round(grandEarned)) + ' ₽' },
      { v: money(Math.round(grandPerDiem)) + ' ₽' },
      { v: money(Math.round(grandTotal)) + ' ₽', gold: true },
    ].forEach(c => {
      const td = document.createElement('td');
      td.style.cssText = `padding:8px 8px;text-align:right;${c.gold ? 'color:var(--gold, #D4A843)' : ''}`;
      td.textContent = c.v;
      totalTr.appendChild(td);
    });
    if (editMode) totalTr.appendChild(document.createElement('td'));
    tbody.appendChild(totalTr);

    table.appendChild(tbody);
    wrap.innerHTML = '';
    wrap.appendChild(table);

    // Edit mode legend
    if (editMode) {
      const legend = document.createElement('div');
      legend.className = 'help';
      legend.style.cssText = 'margin-top:8px;font-size:11px;color:var(--t2);display:flex;gap:16px;flex-wrap:wrap';
      legend.innerHTML = `<span>6 = дорога (3000₽)</span><span>10 = склад (5000₽)</span><span>12 = обычная (6000₽)</span><span>18 = переработка (9000₽)</span><span style="color:var(--gold)">Баллы × 500₽ = ставка</span>`;
      wrap.appendChild(legend);
    }

    // Summary text
    const summary = document.createElement('div');
    summary.className = 'help';
    summary.style.cssText = 'margin-top:8px;font-size:12px';
    summary.textContent = `${timesheet.length} сотрудников · суточные ${money(perDiem)} ₽/день`;
    wrap.appendChild(summary);
  }

  // ── Inline edit checkin cell ──
  // ── Shift type helpers ──
  const SHIFT_TYPES = [
    { value: 'day',     icon: '☀',  label: 'День',       bg: '', hours: 11, defaultPts: 13 },
    { value: 'night',   icon: '🌙', label: 'Ночь',       bg: 'rgba(59,130,246,0.12)', hours: 11, defaultPts: 13 },
    { value: 'half',    icon: '½',  label: 'Полдня',     bg: 'rgba(107,114,128,0.1)', hours: 6, defaultPts: 6 },
    { value: 'road',    icon: '🚗', label: 'Дорога',     bg: 'rgba(96,165,250,0.1)', hours: 0, defaultPts: 6 },
    { value: 'standby', icon: '⏳', label: 'Ожидание',   bg: 'rgba(245,158,11,0.1)', hours: 0, defaultPts: 6 },
  ];
  function _shiftIcon(shift) {
    return SHIFT_TYPES.find(s => s.value === shift) || SHIFT_TYPES[0];
  }

  // ── Inline shift+points editor (replaces cell content) ──
  function _shiftEditor(td, currentShift, currentPts, pv, onSave, onCancel) {
    td.innerHTML = '';
    td.style.padding = '2px';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;align-items:center;min-width:62px';

    // Shift type buttons row
    const btnsRow = document.createElement('div');
    btnsRow.style.cssText = 'display:flex;gap:1px;flex-wrap:wrap;justify-content:center';
    let selectedShift = currentShift || 'day';

    SHIFT_TYPES.forEach(st => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = st.icon;
      btn.title = st.label;
      btn.style.cssText = 'width:22px;height:22px;border:1px solid var(--brd);border-radius:4px;font-size:11px;cursor:pointer;padding:0;line-height:1;background:' + (st.value === selectedShift ? 'var(--gold,#D4A843)' : 'var(--bg1)');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedShift = st.value;
        // Highlight selected
        btnsRow.querySelectorAll('button').forEach(b => { b.style.background = 'var(--bg1)'; });
        btn.style.background = 'var(--gold,#D4A843)';
        // Auto-fill default points for this shift type
        if (!input.dataset.userEdited) input.value = st.defaultPts;
      });
      btnsRow.appendChild(btn);
    });
    wrap.appendChild(btnsRow);

    // Points input
    const input = document.createElement('input');
    input.type = 'number';
    input.value = currentPts;
    input.min = 0;
    input.max = 30;
    input.style.cssText = 'width:44px;padding:2px;font-size:12px;text-align:center;border:1px solid var(--gold);border-radius:4px;background:var(--bg1);color:var(--t1);outline:none';
    input.addEventListener('input', () => { input.dataset.userEdited = '1'; });
    wrap.appendChild(input);
    td.appendChild(wrap);
    input.focus();
    input.select();

    function doSave() {
      const pts = parseInt(input.value) || 0;
      const st = _shiftIcon(selectedShift);
      onSave(pts, selectedShift, st);
    }
    input.addEventListener('blur', () => setTimeout(doSave, 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doSave(); }
      if (e.key === 'Escape') onCancel();
    });
  }

  function editCheckinCell(td, day, emp, date, work, pv) {
    pv = pv || 500;
    const origPts = Math.round(parseFloat(day.day_rate || 0) / pv) || 0;
    const origShift = day.shift || 'day';

    function restore() {
      const si = _shiftIcon(origShift);
      td.innerHTML = si.icon + origPts;
      td.style.color = origPts >= 18 ? '#D4A843' : origPts >= 12 ? '#10b981' : '#3b82f6';
      td.style.background = si.bg || '';
    }

    _shiftEditor(td, origShift, origPts, pv,
      async (newPts, newShift, si) => {
        if (newPts === origPts && newShift === origShift) { restore(); return; }
        const newRate = newPts * pv;
        const shiftDef = SHIFT_TYPES.find(s => s.value === newShift) || SHIFT_TYPES[0];
        try {
          await api(`/projects/${work.id}/checkin/${day.id}`, {
            method: 'PUT',
            body: JSON.stringify({ day_rate: newRate, amount_earned: newRate, shift: newShift, hours_worked: shiftDef.hours, hours_paid: shiftDef.hours }),
          });
          td.innerHTML = si.icon + newPts;
          td.style.color = newPts >= 18 ? '#D4A843' : newPts >= 12 ? '#10b981' : '#3b82f6';
          td.style.background = si.bg || '';
          td.style.transition = 'outline 0.5s';
          td.style.outline = '2px solid rgba(16,185,129,0.5)';
          setTimeout(() => { td.style.outline = ''; }, 800);
        } catch (e) {
          toast('Ошибка', 'Не удалось сохранить', 'err');
          restore();
        }
      },
      restore
    );
  }

  // ── Add new checkin cell ──
  function addCheckinCell(td, emp, date, work, pv) {
    pv = pv || 500;

    function restore() {
      td.textContent = '+';
      td.style.color = 'var(--t2)';
      td.style.opacity = '0.5';
      td.style.background = '';
    }

    _shiftEditor(td, 'day', 13, pv,
      async (pts, shift, si) => {
        if (pts === 0) { restore(); return; }
        const rate = pts * pv;
        const shiftDef = SHIFT_TYPES.find(s => s.value === shift) || SHIFT_TYPES[0];
        try {
          await api(`/projects/${work.id}/checkin`, {
            method: 'POST',
            body: JSON.stringify({
              employee_id: emp.employee_id,
              date: date,
              shift: shift,
              hours_worked: shiftDef.hours,
              hours_paid: shiftDef.hours,
              day_rate: rate,
              amount_earned: rate,
            }),
          });
          td.innerHTML = si.icon + pts;
          td.style.color = pts >= 18 ? '#D4A843' : pts >= 12 ? '#10b981' : '#3b82f6';
          td.style.background = si.bg || '';
          td.style.opacity = '1';
          td.style.transition = 'outline 0.5s';
          td.style.outline = '2px solid rgba(16,185,129,0.5)';
          setTimeout(() => { td.style.outline = ''; }, 800);
          toast('Табель', `${si.label} ${date} добавлена`, 'ok');
        } catch (e) {
          toast('Ошибка', 'Не удалось создать запись', 'err');
          restore();
        }
      },
      restore
    );
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
            <div id="fundsMasterWrap" style="width:100%"></div>
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
        // Load crew for dropdown (CRSelect)
        const _fundsOpts = [];
        try {
          const crewData = await apiField('/logistics/?work_id=' + work.id);
          const seen = new Set();
          if (crewData && crewData.logistics) {
            for (const item of crewData.logistics) {
              if (!seen.has(item.employee_id)) {
                seen.add(item.employee_id);
                _fundsOpts.push({ value: String(item.employee_id), label: item.fio || 'ID ' + item.employee_id });
              }
            }
          }
          try {
            const crewResp = await api('/projects/' + work.id + '/dashboard');
            if (crewResp && crewResp.crew) {
              for (const c of crewResp.crew) {
                if (!seen.has(c.employee_id)) {
                  seen.add(c.employee_id);
                  _fundsOpts.push({ value: String(c.employee_id), label: c.fio || c.employee_name || 'ID ' + c.employee_id });
                }
              }
            }
          } catch (_) {}
        } catch (_) {}
        const wrapFunds = document.getElementById('fundsMasterWrap');
        if (wrapFunds && window.CRSelect) {
          wrapFunds.appendChild(CRSelect.create({
            id: 'fundsMaster', options: _fundsOpts, placeholder: '— Выберите мастера —', fullWidth: true
          }));
        }

        document.getElementById('fundsSubmit').addEventListener('click', async () => {
          const masterId = window.CRSelect ? CRSelect.getValue('fundsMaster') : '';
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
            AsgardUI.hideModal();
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
            AsgardUI.hideModal();
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
          <label>Сотрудник<div id="packAssigneeWrap" style="width:100%"></div></label>
          <label><input type="checkbox" id="packSendSms" checked> Отправить SMS-уведомление</label>
          <button id="packAssignSubmit" class="btn gold">Назначить</button>
        </div>
      `,
      onMount: async () => {
        const _packOpts = [];
        try {
          const crewResp = await api('/projects/' + work.id + '/dashboard');
          if (crewResp && crewResp.crew) {
            for (const c of crewResp.crew) {
              _packOpts.push({ value: String(c.employee_id), label: c.fio || c.employee_name || 'ID ' + c.employee_id });
            }
          }
        } catch (_) {}
        const wrapPack = document.getElementById('packAssigneeWrap');
        if (wrapPack && window.CRSelect) {
          wrapPack.appendChild(CRSelect.create({
            id: 'packAssignee', options: _packOpts, placeholder: '— Выберите —', fullWidth: true
          }));
        }

        document.getElementById('packAssignSubmit').addEventListener('click', async () => {
          const empId = window.CRSelect ? CRSelect.getValue('packAssignee') : '';
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
            AsgardUI.hideModal();
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
          AsgardUI.hideModal();
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

    const bulkTypeOpts = types.map(t => ({ value: t, label: STAGE_LABELS_DT[t] }));

    AsgardUI.showModal({
      title: 'Массовое создание этапов',
      html: `<div style="display:flex;flex-direction:column;gap:12px">
        <div><label><input type="checkbox" id="bulkSelectAll"> Выбрать всех</label></div>
        <div style="max-height:200px;overflow-y:auto">${empCheckboxes}</div>
        <label>Тип этапа<br><div id="cr-bulkType-wrap"></div></label>
        <label>Дата<br><input type="date" id="bulkDate" value="${today}" class="input"></label>
        <button class="btn gold" id="bulkSubmit">Создать для выбранных</button>
      </div>`,
      onMount: () => {
        // Mount CRSelect for bulkType
        const bulkWrap = document.getElementById('cr-bulkType-wrap');
        if (bulkWrap) {
          CRSelect.destroy('bulkType');
          const btEl = CRSelect.create({
            id: 'bulkType',
            options: bulkTypeOpts,
            value: types[0] || '',
            searchable: false,
            clearable: false,
          });
          bulkWrap.appendChild(btEl);
        }

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
              stage_type: CRSelect.getValue('bulkType'),
              date_from: document.getElementById('bulkDate').value,
            }),
          });
          if (result.error) { toast('Ошибка: ' + result.error); return; }
          toast(`Создано ${result.created_count} этапов`);
          CRSelect.destroy('bulkType');
          AsgardUI.hideModal();
          renderStagesTab(parentContainer, work, user);
        });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB 8: ВЫПЛАТЫ (PAYMENTS)
  // ═══════════════════════════════════════════════════════════════════

  async function apiPayments(path, opts) {
    const r = await fetch('/api/worker-payments' + path, { headers: hdr(), ...opts });
    return r.json();
  }

  const PAY_TYPE_LABELS = {
    per_diem: '🌙 Суточные', salary: '💰 ЗП', advance: '💸 Аванс',
    bonus: '🎁 Премия', penalty: '⚠️ Удержание'
  };

  const PAY_STATUS_LABELS = {
    pending: '🟡 Ожидает', paid: '🟢 Выплачено', confirmed: '✅ Подтверждено', cancelled: '⚫ Отменено'
  };

  async function renderPaymentsTab(container, work, user) {
    container.innerHTML = '<div class="help">Загрузка выплат…</div>';

    let summary;
    try { summary = await apiPayments('/project/' + work.id + '/summary'); } catch (_) {}

    let allPayments;
    try { allPayments = await apiPayments('/?work_id=' + work.id); } catch (_) {}

    container.innerHTML = '';

    // ─── KPI cards (SSoT) ───────────────────────────────────────
    const t = summary?.totals || {};
    const pdBal = t.per_diem_balance || 0;
    const pdBalColor = pdBal > 0 ? '#10b981' : pdBal < 0 ? '#ef4444' : '#6b7280';
    const pdBalLabel = pdBal > 0 ? '(должны)' : pdBal < 0 ? '(переплата)' : '';
    const kpiItems = [
      { label: 'ФОТ начислено', value: t.fot_accrued || 0, color: '#3b82f6' },
      { label: 'Суточные начисл.', value: t.per_diem_accrued || 0, color: '#f59e0b' },
      { label: 'Суточные выплач.', value: t.per_diem_paid || 0, color: '#10b981' },
      { label: 'Остаток суточных', value: Math.abs(pdBal), color: pdBalColor, suffix: pdBalLabel },
      { label: 'Авансы выплачено', value: t.advance_paid || 0, color: '#8b5cf6' },
      { label: 'К выплате ИТОГО', value: t.net_to_pay || 0, color: 'var(--gold, #D4A843)' },
    ];
    const kpiRow = document.createElement('div');
    kpiRow.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px';
    for (const k of kpiItems) {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--bg-2,#1a1a2e);padding:12px;border-radius:10px;text-align:center';
      card.innerHTML = `<div style="font-size:11px;opacity:.6">${k.label}</div>
        <div style="font-size:18px;font-weight:700;color:${k.color};margin-top:4px">${money(k.value)} ₽${k.suffix ? ' <span style="font-size:11px;opacity:.7">' + k.suffix + '</span>' : ''}</div>`;
      kpiRow.appendChild(card);
    }
    container.appendChild(kpiRow);

    // ─── Action buttons ──────────────────────────────────────────
    const actBar = document.createElement('div');
    actBar.style.cssText = 'display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap';
    const actions = [
      { label: '+ Суточные', handler: () => openBulkPerDiemModal(work, container, user) },
      { label: '+ Аванс', handler: () => openSinglePaymentModal(work, container, user, 'advance') },
      { label: '+ Премия', handler: () => openSinglePaymentModal(work, container, user, 'bonus') },
      { label: '+ Удержание', handler: () => openSinglePaymentModal(work, container, user, 'penalty') },
      { label: '📋 Ведомость ЗП', handler: () => openGenerateSalaryModal(work, container, user) },
    ];
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = 'btn ghost';
      btn.textContent = a.label;
      btn.style.cssText = 'font-size:12px;padding:6px 12px';
      btn.addEventListener('click', a.handler);
      actBar.appendChild(btn);
    }
    container.appendChild(actBar);

    // ─── Employees summary table ─────────────────────────────────
    const emps = summary?.workers || [];
    if (emps.length > 0) {
      const tbl = document.createElement('table');
      tbl.className = 'fk-table fk-table-small';
      tbl.style.cssText = 'width:100%;font-size:12px;margin-bottom:12px';
      tbl.innerHTML = `<thead><tr>
        <th>ФИО</th><th style="text-align:right">Дней</th><th style="text-align:right">ФОТ</th>
        <th style="text-align:right">Суточн. начисл.</th><th style="text-align:right">Суточн. выплач.</th>
        <th style="text-align:right">Остаток</th><th style="text-align:right">Авансы</th>
        <th style="text-align:right">Премии</th><th style="text-align:right">Удерж.</th>
        <th style="text-align:right;color:var(--gold)">К выплате</th>
      </tr></thead>`;
      const tbody = document.createElement('tbody');
      for (const e of emps) {
        if (e.error === 'per_diem_not_set') {
          const tr = document.createElement('tr');
          tr.style.background = 'rgba(245,158,11,0.08)';
          tr.innerHTML = `<td>${esc(e.employee_name)}</td><td colspan="9" style="color:#f59e0b;font-size:11px">⚠️ суточные не установлены</td>`;
          tbody.appendChild(tr);
          continue;
        }
        const bal = e.per_diem_balance || 0;
        const balColor = bal > 0 ? '#10b981' : bal < 0 ? '#ef4444' : '';
        const balSign = bal > 0 ? '+' : bal < 0 ? '' : '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${esc(e.employee_name)}</td>
          <td style="text-align:right">${e.days_worked || 0}</td>
          <td style="text-align:right">${money(e.fot_accrued)} ₽</td>
          <td style="text-align:right">${money(e.per_diem_accrued)} ₽</td>
          <td style="text-align:right">${money(e.per_diem_paid)} ₽</td>
          <td style="text-align:right;color:${balColor}">${balSign}${money(bal)} ₽</td>
          <td style="text-align:right">${money(e.advance_paid)} ₽</td>
          <td style="text-align:right">${money(e.bonus_paid)} ₽</td>
          <td style="text-align:right">${money(e.penalty)} ₽</td>
          <td style="text-align:right;font-weight:600;color:var(--gold)">${money(e.net_to_pay)} ₽</td>
        `;
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      container.appendChild(tbl);
    }

    // ─── All payments list ───────────────────────────────────────
    const payments = allPayments?.payments || [];
    if (payments.length > 0) {
      const hd = document.createElement('div');
      hd.style.cssText = 'font-weight:600;font-size:13px;margin:12px 0 8px';
      hd.textContent = 'Все операции (' + payments.length + ')';
      container.appendChild(hd);

      const tbl2 = document.createElement('table');
      tbl2.className = 'fk-table fk-table-small';
      tbl2.style.cssText = 'width:100%;font-size:11px';
      tbl2.innerHTML = `<thead><tr>
        <th>Дата</th><th>Тип</th><th>Сотрудник</th><th style="text-align:right">Сумма</th>
        <th>Комментарий</th><th>Статус</th><th></th>
      </tr></thead>`;
      const tbody2 = document.createElement('tbody');
      for (const p of payments) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${formatDate(p.created_at)}</td>
          <td>${PAY_TYPE_LABELS[p.type] || p.type}</td>
          <td>${esc(p.employee_name || '—')}</td>
          <td style="text-align:right;font-weight:600">${money(p.amount)} ₽</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.comment || '—')}</td>
          <td>${PAY_STATUS_LABELS[p.status] || p.status}</td>
          <td>${p.status === 'pending' ? '<button class="btn ghost cancel-pay" data-id="' + p.id + '" style="font-size:10px;padding:3px 6px;color:#ef4444">✕</button>' : ''}</td>
        `;
        tbody2.appendChild(tr);
      }
      tbl2.appendChild(tbody2);
      container.appendChild(tbl2);

      // Cancel handlers
      container.querySelectorAll('.cancel-pay').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Отменить эту выплату?')) return;
          try {
            await fetch('/api/worker-payments/' + btn.dataset.id, { method: 'DELETE', headers: hdr() });
            toast('Выплата отменена');
            renderPaymentsTab(container, work, user);
          } catch (err) { toast('Ошибка: ' + err.message); }
        });
      });
    } else if (emps.length === 0) {
      container.innerHTML += '<div class="help" style="padding:32px;text-align:center">Нет выплат для этого проекта</div>';
    }
  }

  // ─── Inline form: массовые суточные (рендерится внутри вкладки, не в отдельной модалке) ──
  async function openBulkPerDiemModal(work, parentContainer, user) {
    // Load crew
    let crewOptions = [];
    try {
      const dash = await api('/projects/' + work.id + '/dashboard');
      if (dash?.crew) crewOptions = dash.crew.map(c => ({ id: c.employee_id, fio: c.fio || c.employee_name || 'ID ' + c.employee_id }));
    } catch (_) {}

    const today = new Date().toISOString().slice(0, 10);

    let checkboxesHtml = crewOptions.map(c =>
      `<label style="display:flex;align-items:center;gap:6px;padding:4px 0">
        <input type="checkbox" class="pd-emp-cb" value="${c.id}" checked> ${esc(c.fio)}
      </label>`
    ).join('');

    // Remove previous inline form if exists
    parentContainer.querySelector('.pd-inline-form')?.remove();

    // Insert form directly into payments tab container (no nested modal)
    const formDiv = document.createElement('div');
    formDiv.className = 'pd-inline-form';
    formDiv.style.cssText = 'background:var(--bg2,#151922);border:1px solid var(--gold,#D4A843);border-radius:10px;padding:16px;margin:12px 0;';
    formDiv.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-weight:600;font-size:14px;color:var(--gold,#D4A843)">🌙 Начислить суточные</div>
        <button class="pd-close" style="background:none;border:none;color:var(--t2);cursor:pointer;font-size:18px">✕</button>
      </div>
      <div style="font-size:13px;margin-bottom:8px">Сотрудники:</div>
      <div style="max-height:160px;overflow-y:auto;border:1px solid var(--brd,rgba(255,255,255,0.1));border-radius:8px;padding:8px;margin-bottom:10px">
        ${checkboxesHtml || '<span class="help">Нет сотрудников в бригаде</span>'}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">
        <label style="font-size:12px">С<input id="pdFrom" type="date" class="inp" value="${today}" style="width:100%"></label>
        <label style="font-size:12px">По<input id="pdTo" type="date" class="inp" value="${today}" style="width:100%"></label>
        <label style="font-size:12px">₽/день<input id="pdRate" type="number" class="inp" value="1000" style="width:100%"></label>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="pdComment" type="text" class="inp" style="flex:1" placeholder="Комментарий...">
        <button id="pdSubmit" class="btn" style="background:linear-gradient(135deg,#D4A843,#b8922e);color:#000;font-weight:600;white-space:nowrap">Начислить</button>
      </div>
    `;

    // Insert before the "Нет выплат" or table
    const firstChild = parentContainer.querySelector('.fk-table, .help');
    if (firstChild) parentContainer.insertBefore(formDiv, firstChild);
    else parentContainer.appendChild(formDiv);

    // Close button
    formDiv.querySelector('.pd-close').addEventListener('click', () => formDiv.remove());

    // Submit
    formDiv.querySelector('#pdSubmit').addEventListener('click', async () => {
      const empIds = Array.from(formDiv.querySelectorAll('.pd-emp-cb:checked')).map(cb => parseInt(cb.value));
      const from = formDiv.querySelector('#pdFrom').value;
      const to = formDiv.querySelector('#pdTo').value;
      const rate = parseFloat(formDiv.querySelector('#pdRate').value);
      const comment = formDiv.querySelector('#pdComment').value.trim();

      if (empIds.length === 0) { toast('Выберите сотрудников'); return; }
      if (!from || !to) { toast('Укажите период'); return; }
      if (!rate || rate <= 0) { toast('Укажите ставку'); return; }

      try {
        const result = await apiPayments('/bulk-per-diem', {
          method: 'POST',
          body: JSON.stringify({
            work_id: work.id, employee_ids: empIds,
            period_from: from, period_to: to,
            rate_per_day: rate, comment: comment || null
          })
        });
        if (result.error) { toast('Ошибка', result.error, 'err'); return; }
        toast('Суточные', `Начислено: ${result.count} чел.`, 'ok');
        formDiv.remove();
        renderPaymentsTab(parentContainer, work, user);
      } catch (err) { toast('Ошибка', err.message, 'err'); }
    });
  }

  // ─── Inline form: одиночная выплата (аванс/премия/удержание) ─────────
  async function openSinglePaymentModal(work, parentContainer, user, type) {
    const typeLabel = { advance: 'Аванс', bonus: 'Премия', penalty: 'Удержание' }[type] || type;
    const typeIcon = { advance: '💸', bonus: '🎁', penalty: '⚠️' }[type] || '💳';

    parentContainer.querySelector('.sp-inline-form')?.remove();

    let crewOpts = [];
    try {
      const dash = await api('/projects/' + work.id + '/dashboard');
      if (dash?.crew) crewOpts = dash.crew.map(c => ({ value: String(c.employee_id), label: c.fio || c.employee_name || 'ID ' + c.employee_id }));
    } catch (_) {}

    const formDiv = document.createElement('div');
    formDiv.className = 'sp-inline-form';
    formDiv.style.cssText = 'background:var(--bg2,#151922);border:1px solid var(--brd);border-radius:10px;padding:16px;margin:12px 0;';
    formDiv.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-weight:600;font-size:14px">${typeIcon} ${esc(typeLabel)}</div>
        <button class="sp-close" style="background:none;border:none;color:var(--t2);cursor:pointer;font-size:18px">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <label style="font-size:12px">Сотрудник<div id="spEmpWrap" style="width:100%"></div></label>
        <label style="font-size:12px">Сумма, ₽<input id="spAmount" type="number" step="0.01" class="inp" style="width:100%" placeholder="10000"></label>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="spComment" type="text" class="inp" style="flex:1" placeholder="Комментарий...">
        <button id="spSubmit" class="btn" style="background:linear-gradient(135deg,#D4A843,#b8922e);color:#000;font-weight:600;white-space:nowrap">Создать</button>
      </div>
    `;

    const firstChild = parentContainer.querySelector('.fk-table, .help');
    if (firstChild) parentContainer.insertBefore(formDiv, firstChild);
    else parentContainer.appendChild(formDiv);

    // Employee selector
    const wrap = formDiv.querySelector('#spEmpWrap');
    if (wrap && window.CRSelect) {
      wrap.appendChild(CRSelect.create({ id: 'spEmp', options: crewOpts, placeholder: '— Выберите —', fullWidth: true }));
    }

    formDiv.querySelector('.sp-close').addEventListener('click', () => { try { CRSelect.destroy('spEmp'); } catch(_){} formDiv.remove(); });

    formDiv.querySelector('#spSubmit').addEventListener('click', async () => {
      const empId = window.CRSelect ? CRSelect.getValue('spEmp') : '';
      const amount = parseFloat(formDiv.querySelector('#spAmount').value);
      const comment = formDiv.querySelector('#spComment').value.trim();
      if (!empId) { toast('Выберите сотрудника'); return; }
      if (!amount || amount <= 0) { toast('Укажите сумму'); return; }
      try {
        const result = await apiPayments('/', { method: 'POST', body: JSON.stringify({ employee_id: parseInt(empId), work_id: work.id, type, amount, comment: comment || null }) });
        if (result.error) { toast('Ошибка', result.error, 'err'); return; }
        toast(typeLabel, 'Создано!', 'ok');
        try { CRSelect.destroy('spEmp'); } catch(_){}
        formDiv.remove();
        renderPaymentsTab(parentContainer, work, user);
      } catch (err) { toast('Ошибка', err.message, 'err'); }
    });
  }

  // ─── Inline form: генерация ведомости ЗП ─────────────────────────────
  function openGenerateSalaryModal(work, parentContainer, user) {
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();

    parentContainer.querySelector('.sal-inline-form')?.remove();

    const formDiv = document.createElement('div');
    formDiv.className = 'sal-inline-form';
    formDiv.style.cssText = 'background:var(--bg2,#151922);border:1px solid var(--brd);border-radius:10px;padding:16px;margin:12px 0;';
    formDiv.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-weight:600;font-size:14px">📋 Сгенерировать ведомость ЗП</div>
        <button class="sal-close" style="background:none;border:none;color:var(--t2);cursor:pointer;font-size:18px">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">
        <label style="font-size:12px">Месяц<input id="salMonth" type="number" min="1" max="12" class="inp" value="${curMonth}" style="width:100%"></label>
        <label style="font-size:12px">Год<input id="salYear" type="number" min="2024" max="2099" class="inp" value="${curYear}" style="width:100%"></label>
        <label style="font-size:12px">₽/балл<input id="salPointVal" type="number" class="inp" value="500" style="width:100%"></label>
      </div>
      <button id="salSubmit" class="btn" style="background:linear-gradient(135deg,#D4A843,#b8922e);color:#000;font-weight:600">Сгенерировать</button>
    `;

    const firstChild = parentContainer.querySelector('.fk-table, .help');
    if (firstChild) parentContainer.insertBefore(formDiv, firstChild);
    else parentContainer.appendChild(formDiv);

    formDiv.querySelector('.sal-close').addEventListener('click', () => formDiv.remove());

    formDiv.querySelector('#salSubmit').addEventListener('click', async () => {
      const month = parseInt(formDiv.querySelector('#salMonth').value);
      const year = parseInt(formDiv.querySelector('#salYear').value);
      const pv = parseFloat(formDiv.querySelector('#salPointVal').value);
      if (!month || month < 1 || month > 12) { toast('Некорректный месяц'); return; }
      if (!year) { toast('Некорректный год'); return; }
      try {
        const result = await apiPayments(`/generate-salary/${year}/${month}`, { method: 'POST', body: JSON.stringify({ point_value: pv, work_id: work.id }) });
        if (result.error) { toast('Ошибка', result.error, 'err'); return; }
        toast('Ведомость', `${result.count} чел. по ${pv}₽/балл`, 'ok');
        formDiv.remove();
        renderPaymentsTab(parentContainer, work, user);
      } catch (err) { toast('Ошибка', err.message, 'err'); }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════
  return { openFieldModal };
})();
