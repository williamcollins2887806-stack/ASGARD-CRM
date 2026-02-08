/**
 * АСГАРД CRM — Разрешения и допуски (M6)
 *
 * Обновлённая версия с API, матрицей, проектами и уведомлениями
 */
window.AsgardPermitsPage = (function(){

  // Fallback статические данные (до загрузки с сервера)
  const PERMIT_TYPES = [
    { id: 'height_1', name: 'Допуск к работам на высоте (1 группа)', category: 'safety' },
    { id: 'height_2', name: 'Допуск к работам на высоте (2 группа)', category: 'safety' },
    { id: 'height_3', name: 'Допуск к работам на высоте (3 группа)', category: 'safety' },
    { id: 'electro_2', name: 'Электробезопасность (II группа)', category: 'electric' },
    { id: 'electro_3', name: 'Электробезопасность (III группа)', category: 'electric' },
    { id: 'electro_4', name: 'Электробезопасность (IV группа)', category: 'electric' },
    { id: 'electro_5', name: 'Электробезопасность (V группа)', category: 'electric' },
    { id: 'fire', name: 'Пожарно-технический минимум (ПТМ)', category: 'safety' },
    { id: 'labor', name: 'Охрана труда (общий курс)', category: 'safety' },
    { id: 'confined', name: 'Работа в ограниченных пространствах', category: 'safety' },
    { id: 'pressure', name: 'Работа с сосудами под давлением', category: 'special' },
    { id: 'rigger', name: 'Стропальщик', category: 'special' },
    { id: 'tackle', name: 'Такелажник', category: 'special' },
    { id: 'gascutter', name: 'Газорезчик', category: 'special' },
    { id: 'welder', name: 'Сварщик (НАКС)', category: 'special' },
    { id: 'medical', name: 'Медицинский осмотр (периодический)', category: 'medical' },
    { id: 'psych', name: 'Психиатрическое освидетельствование', category: 'medical' },
    { id: 'attest_a1', name: 'Аттестация промбезопасность А1', category: 'attest' },
    { id: 'attest_b', name: 'Аттестация промбезопасность Б', category: 'attest' },
    { id: 'first_aid', name: 'Первая помощь пострадавшим', category: 'safety' }
  ];

  const CATEGORIES = {
    safety: { name: 'Безопасность', color: '#22c55e' },
    electric: { name: 'Электрика', color: '#f59e0b' },
    special: { name: 'Спецработы', color: '#3b82f6' },
    medical: { name: 'Медицина', color: '#ef4444' },
    attest: { name: 'Аттестация', color: '#8b5cf6' },
    offshore: { name: 'Шельф / Морские', color: '#06b6d4' },
    gas: { name: 'Газоопасные', color: '#f97316' },
    transport: { name: 'Транспорт', color: '#64748b' }
  };

  // Кэш типов с сервера
  let serverTypes = null;
  let currentTab = 'list';
  let selectedPermits = new Set();

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════
  function esc(s) { return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function formatDate(d) { return d ? new Date(d).toLocaleDateString('ru-RU') : ''; }

  function getToken() {
    const auth = window.AsgardAuth?.getAuth?.();
    return auth?.token || '';
  }

  async function api(endpoint, options = {}) {
    const token = getToken();
    const headers = { ...options.headers };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    const resp = await fetch('/api/permits' + endpoint, { ...options, headers });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Ошибка сервера' }));
      throw new Error(err.error || err.message || 'Ошибка');
    }
    return resp.json();
  }

  // Получить типы (с сервера или fallback)
  async function getTypes() {
    if (serverTypes) return serverTypes;
    try {
      const { types } = await api('/types');
      serverTypes = types;
      return types;
    } catch(e) {
      return PERMIT_TYPES;
    }
  }

  function getTypeById(types, id) {
    return types.find(t => t.id === id) || { id, name: id, category: 'safety' };
  }

  function getStatusBadge(status, daysLeft) {
    const map = {
      expired: { label: 'Истёк', color: 'var(--red)' },
      expiring_14: { label: `${daysLeft} дн.`, color: 'var(--red)' },
      expiring_30: { label: `${daysLeft} дн.`, color: 'var(--amber)' },
      active: { label: 'Действует', color: 'var(--green)' }
    };
    const s = map[status] || map.active;
    return `<span class="badge" style="background:${s.color}20;color:${s.color}">${s.label}</span>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // API WRAPPERS (для обратной совместимости)
  // ═══════════════════════════════════════════════════════════════
  async function getAll() {
    try {
      const { permits } = await api('/');
      return permits || [];
    } catch(e) {
      // Fallback to old localStorage method
      const data = localStorage.getItem('asgard_employee_permits');
      return data ? JSON.parse(data) : [];
    }
  }

  async function save(permit) {
    try {
      if (permit.id) {
        await api('/' + permit.id, { method: 'PUT', body: permit });
      } else {
        await api('/', { method: 'POST', body: permit });
      }
    } catch(e) {
      // Fallback to localStorage
      const all = await getAll();
      const idx = all.findIndex(p => p.id === permit.id);
      if (idx >= 0) all[idx] = permit;
      else all.push({ ...permit, id: Date.now() });
      localStorage.setItem('asgard_employee_permits', JSON.stringify(all));
    }
  }

  async function remove(id) {
    try {
      await api('/' + id, { method: 'DELETE' });
    } catch(e) {
      const all = await getAll();
      localStorage.setItem('asgard_employee_permits', JSON.stringify(all.filter(p => p.id !== id)));
    }
  }

  // Вычислить статус разрешения (legacy)
  function computeStatus(permit) {
    if (!permit.expiry_date) return { status: 'active', label: 'Действует', color: 'var(--green)' };
    const today = new Date();
    const expiry = new Date(permit.expiry_date);
    const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) return { status: 'expired', label: 'Истёк', color: 'var(--red)' };
    if (daysLeft <= 30) return { status: 'expiring', label: `Истекает через ${daysLeft} дн.`, color: 'var(--amber)' };
    return { status: 'active', label: 'Действует', color: 'var(--green)' };
  }

  async function getExpiringPermits(daysAhead = 30) {
    try {
      const { permits } = await api('/?status=expiring_30');
      return permits || [];
    } catch(e) {
      const all = await getAll();
      const today = new Date();
      const threshold = new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000);
      return all.filter(p => {
        if (!p.expiry_date) return false;
        const expiry = new Date(p.expiry_date);
        return expiry <= threshold && expiry >= today;
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // РЕНДЕР ДОПУСКОВ СОТРУДНИКА (для employee page)
  // ═══════════════════════════════════════════════════════════════
  async function renderEmployeePermits(employeeId, canEdit = false) {
    const types = await getTypes();
    let permits = [];
    try {
      const resp = await api('/?employee_id=' + employeeId);
      permits = resp.permits || [];
    } catch(e) {
      const all = await getAll();
      permits = all.filter(p => p.employee_id === employeeId);
    }

    let html = `
      <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <span class="help">Всего: ${permits.length}</span>
        ${canEdit ? `<button class="btn mini" id="btnAddPermit" data-employee="${employeeId}">+ Добавить разрешение</button>` : ''}
      </div>
    `;

    if (permits.length === 0) {
      html += '<div class="help">Разрешений не добавлено</div>';
    } else {
      html += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Тип</th><th>Номер</th><th>Выдано</th><th>Действует до</th><th>Статус</th><th></th></tr></thead><tbody>';

      permits.forEach(p => {
        const type = getTypeById(types, p.type_id);
        const cat = CATEGORIES[type.category] || { color: '#94a3b8' };
        const status = p.computed_status || computeStatus(p).status;
        const daysLeft = p.days_left;

        html += `
          <tr data-id="${p.id}">
            <td><span style="border-left:3px solid ${cat.color};padding-left:8px">${esc(type.name)}</span></td>
            <td>${esc(p.doc_number || '—')}</td>
            <td>${p.issue_date ? formatDate(p.issue_date) : '—'}</td>
            <td>${p.expiry_date ? formatDate(p.expiry_date) : 'Бессрочно'}</td>
            <td>${getStatusBadge(status, daysLeft)}</td>
            <td>
              ${canEdit ? `
                <div style="display:flex;gap:4px">
                  <button class="btn mini ghost btnEditPermit" data-id="${p.id}">Изм.</button>
                  <button class="btn mini ghost btnDelPermit" data-id="${p.id}">Уд.</button>
                </div>
              ` : ''}
            </td>
          </tr>
        `;
      });

      html += '</tbody></table></div>';
    }

    return html;
  }

  // ═══════════════════════════════════════════════════════════════
  // МОДАЛКА ДОБАВЛЕНИЯ/РЕДАКТИРОВАНИЯ
  // ═══════════════════════════════════════════════════════════════
  async function openPermitModal(employeeId, permit = null, onSave = null) {
    const isEdit = !!permit;
    const types = await getTypes();

    let empName = 'ID:' + employeeId;
    try {
      const employees = await AsgardDB.getAll('employees');
      const emp = employees?.find(e => e.id === employeeId);
      if (emp) empName = emp.fio;
    } catch(e) {}

    const html = `
      <div class="modal-overlay" id="permitModal">
        <div class="modal-content" style="max-width:560px">
          <div class="modal-header">
            <h3>${isEdit ? 'Редактирование допуска' : 'Новый допуск'}</h3>
            <button class="btn ghost btnClose">&times;</button>
          </div>
          <div class="modal-body">
            <p style="margin-bottom:16px">Сотрудник: <strong>${esc(empName)}</strong></p>

            <div class="field">
              <label>Тип разрешения *</label>
              <select id="permitType" class="inp">
                <option value="">— Выберите —</option>
                ${Object.entries(CATEGORIES).map(([catId, cat]) => `
                  <optgroup label="${cat.name}">
                    ${types.filter(t => t.category === catId).map(t => `
                      <option value="${t.id}" ${permit?.type_id === t.id ? 'selected' : ''}>${t.name}</option>
                    `).join('')}
                  </optgroup>
                `).join('')}
              </select>
            </div>

            <div class="formrow" style="margin-top:12px">
              <div>
                <label>Номер документа</label>
                <input id="permitNum" class="inp" value="${esc(permit?.doc_number || '')}"/>
              </div>
              <div>
                <label>Кем выдано</label>
                <input id="permitIssuer" class="inp" value="${esc(permit?.issuer || '')}"/>
              </div>
            </div>

            <div class="formrow" style="margin-top:12px">
              <div>
                <label>Дата получения</label>
                <input id="permitIssue" type="date" class="inp" value="${permit?.issue_date?.slice(0,10) || ''}"/>
              </div>
              <div>
                <label>Действует до</label>
                <input id="permitExpiry" type="date" class="inp" value="${permit?.expiry_date?.slice(0,10) || ''}"/>
              </div>
            </div>

            <div class="field" style="margin-top:12px">
              <label>Скан документа</label>
              <input id="permitScanFile" type="file" class="inp" accept=".pdf,.jpg,.jpeg,.png"/>
              ${permit?.scan_file ? `<div class="help" style="margin-top:4px">Текущий файл: ${esc(permit.scan_original_name || permit.scan_file)}</div>` : ''}
            </div>

            <div class="field" style="margin-top:12px">
              <label>Примечания</label>
              <textarea id="permitNotes" class="inp" rows="2">${esc(permit?.notes || '')}</textarea>
            </div>
          </div>
          <div class="modal-footer" style="display:flex;gap:12px;justify-content:flex-end;padding:16px">
            <button class="btn ghost btnClose">Отмена</button>
            <button class="btn primary" id="btnSavePermit">Сохранить</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById('permitModal');

    modal.querySelectorAll('.btnClose').forEach(b => b.onclick = () => modal.remove());
    modal.onclick = e => { if (e.target === modal) modal.remove(); };

    document.getElementById('btnSavePermit').onclick = async () => {
      const typeId = document.getElementById('permitType').value;
      if (!typeId) { AsgardUI.toast('Ошибка', 'Выберите тип', 'err'); return; }

      const scanInput = document.getElementById('permitScanFile');
      const scanFile = scanInput.files?.[0];

      try {
        if (isEdit) {
          // Update existing
          await api('/' + permit.id, {
            method: 'PUT',
            body: {
              type_id: typeId,
              doc_number: document.getElementById('permitNum').value.trim(),
              issuer: document.getElementById('permitIssuer').value.trim(),
              issue_date: document.getElementById('permitIssue').value || null,
              expiry_date: document.getElementById('permitExpiry').value || null,
              notes: document.getElementById('permitNotes').value.trim()
            }
          });

          // Upload scan if provided
          if (scanFile) {
            const formData = new FormData();
            formData.append('file', scanFile);
            await api('/' + permit.id + '/scan', { method: 'POST', body: formData });
          }
        } else {
          // Create new
          const formData = new FormData();
          formData.append('employee_id', employeeId);
          formData.append('type_id', typeId);
          formData.append('doc_number', document.getElementById('permitNum').value.trim());
          formData.append('issuer', document.getElementById('permitIssuer').value.trim());
          formData.append('issue_date', document.getElementById('permitIssue').value || '');
          formData.append('expiry_date', document.getElementById('permitExpiry').value || '');
          formData.append('notes', document.getElementById('permitNotes').value.trim());
          if (scanFile) formData.append('file', scanFile);

          await api('/', { method: 'POST', body: formData });
        }

        modal.remove();
        AsgardUI.toast('Сохранено', isEdit ? 'Допуск обновлён' : 'Допуск добавлен', 'ok');
        if (onSave) onSave();
      } catch(e) {
        AsgardUI.toast('Ошибка', e.message, 'err');
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // МОДАЛКА ПРОДЛЕНИЯ
  // ═══════════════════════════════════════════════════════════════
  async function openRenewModal(permit, onSave = null) {
    const types = await getTypes();
    const type = getTypeById(types, permit.type_id);

    // Рассчитать новую дату по validity_months
    let suggestedExpiry = '';
    if (type.validity_months) {
      const d = new Date();
      d.setMonth(d.getMonth() + type.validity_months);
      suggestedExpiry = d.toISOString().slice(0, 10);
    }

    const html = `
      <div class="modal-overlay" id="renewModal">
        <div class="modal-content" style="max-width:450px">
          <div class="modal-header">
            <h3>Продление допуска</h3>
            <button class="btn ghost btnClose">&times;</button>
          </div>
          <div class="modal-body">
            <p><strong>${esc(permit.employee_name || 'Сотрудник')}</strong></p>
            <p class="help">${esc(type.name)}</p>

            <div class="formrow" style="margin-top:16px">
              <div>
                <label>Дата выдачи нового</label>
                <input id="renewIssue" type="date" class="inp" value="${new Date().toISOString().slice(0,10)}"/>
              </div>
              <div>
                <label>Действует до *</label>
                <input id="renewExpiry" type="date" class="inp" value="${suggestedExpiry}"/>
              </div>
            </div>

            <div class="formrow" style="margin-top:12px">
              <div>
                <label>Новый номер</label>
                <input id="renewNum" class="inp" value="${esc(permit.doc_number || '')}"/>
              </div>
              <div>
                <label>Кем выдано</label>
                <input id="renewIssuer" class="inp" value="${esc(permit.issuer || '')}"/>
              </div>
            </div>
          </div>
          <div class="modal-footer" style="display:flex;gap:12px;justify-content:flex-end;padding:16px">
            <button class="btn ghost btnClose">Отмена</button>
            <button class="btn primary" id="btnDoRenew">Продлить</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById('renewModal');

    modal.querySelectorAll('.btnClose').forEach(b => b.onclick = () => modal.remove());
    modal.onclick = e => { if (e.target === modal) modal.remove(); };

    document.getElementById('btnDoRenew').onclick = async () => {
      const expiry = document.getElementById('renewExpiry').value;
      if (!expiry) { AsgardUI.toast('Ошибка', 'Укажите дату окончания', 'err'); return; }

      try {
        await api('/' + permit.id + '/renew', {
          method: 'POST',
          body: {
            issue_date: document.getElementById('renewIssue').value,
            expiry_date: expiry,
            doc_number: document.getElementById('renewNum').value.trim(),
            issuer: document.getElementById('renewIssuer').value.trim()
          }
        });
        modal.remove();
        AsgardUI.toast('Продлено', 'Создан новый допуск', 'ok');
        if (onSave) onSave();
      } catch(e) {
        AsgardUI.toast('Ошибка', e.message, 'err');
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // МАССОВОЕ ПРОДЛЕНИЕ
  // ═══════════════════════════════════════════════════════════════
  async function openBulkRenewModal(permitIds, onSave = null) {
    const html = `
      <div class="modal-overlay" id="bulkRenewModal">
        <div class="modal-content" style="max-width:400px">
          <div class="modal-header">
            <h3>Массовое продление</h3>
            <button class="btn ghost btnClose">&times;</button>
          </div>
          <div class="modal-body">
            <p>Выбрано допусков: <strong>${permitIds.length}</strong></p>

            <div class="field" style="margin-top:16px">
              <label>Дата выдачи</label>
              <input id="bulkIssue" type="date" class="inp" value="${new Date().toISOString().slice(0,10)}"/>
            </div>

            <div class="field" style="margin-top:12px">
              <label>Действует до *</label>
              <input id="bulkExpiry" type="date" class="inp"/>
            </div>
          </div>
          <div class="modal-footer" style="display:flex;gap:12px;justify-content:flex-end;padding:16px">
            <button class="btn ghost btnClose">Отмена</button>
            <button class="btn primary" id="btnDoBulkRenew">Продлить все</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById('bulkRenewModal');

    modal.querySelectorAll('.btnClose').forEach(b => b.onclick = () => modal.remove());
    modal.onclick = e => { if (e.target === modal) modal.remove(); };

    document.getElementById('btnDoBulkRenew').onclick = async () => {
      const expiry = document.getElementById('bulkExpiry').value;
      if (!expiry) { AsgardUI.toast('Ошибка', 'Укажите дату окончания', 'err'); return; }

      try {
        const result = await api('/bulk-renew', {
          method: 'POST',
          body: {
            permit_ids: permitIds,
            issue_date: document.getElementById('bulkIssue').value,
            expiry_date: expiry
          }
        });
        modal.remove();
        AsgardUI.toast('Продлено', `Обновлено ${result.renewed} из ${result.total}`, 'ok');
        if (onSave) onSave();
      } catch(e) {
        AsgardUI.toast('Ошибка', e.message, 'err');
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // РЕНДЕР ВКЛАДКИ СПИСОК
  // ═══════════════════════════════════════════════════════════════
  async function renderListTab(container) {
    const types = await getTypes();
    const canWrite = AsgardAuth.hasPermission?.('permits', 'write');
    const canDelete = AsgardAuth.hasPermission?.('permits', 'delete');

    // Загрузить сотрудников для фильтра
    let employees = [];
    try { employees = await AsgardDB.getAll('employees') || []; } catch(e) {}

    container.innerHTML = `
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;align-items:flex-end">
        <div class="field" style="margin:0">
          <label>Статус</label>
          <select id="filterStatus" class="inp" style="min-width:150px">
            <option value="">Все</option>
            <option value="expired">Истёкшие</option>
            <option value="expiring_14">Истекают (&le;14 дн.)</option>
            <option value="expiring_30">Истекают (&le;30 дн.)</option>
            <option value="active">Действующие</option>
          </select>
        </div>
        <div class="field" style="margin:0">
          <label>Категория</label>
          <select id="filterCategory" class="inp" style="min-width:150px">
            <option value="">Все</option>
            ${Object.entries(CATEGORIES).map(([id, c]) => `<option value="${id}">${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="margin:0">
          <label>Сотрудник</label>
          <select id="filterEmployee" class="inp" style="min-width:200px">
            <option value="">Все</option>
            ${employees.filter(e => e.is_active).map(e => `<option value="${e.id}">${esc(e.fio)}</option>`).join('')}
          </select>
        </div>
        <button class="btn" id="btnApplyFilters">Применить</button>
        ${canWrite ? `<button class="btn primary" id="btnAddNewPermit" style="margin-left:auto">+ Добавить</button>` : ''}
      </div>

      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn mini ghost" id="btnSelectAll">Выбрать все</button>
        <button class="btn mini ghost" id="btnDeselectAll">Снять выбор</button>
        <button class="btn mini" id="btnBulkRenew" disabled>Продлить выбранные</button>
      </div>

      <div id="permitsListContent">
        <div class="text-center"><div class="spinner-border spinner-border-sm"></div> Загрузка...</div>
      </div>
    `;

    const loadList = async () => {
      const status = document.getElementById('filterStatus').value;
      const category = document.getElementById('filterCategory').value;
      const employee_id = document.getElementById('filterEmployee').value;

      let url = '/?';
      if (status) url += `status=${status}&`;
      if (category) url += `category=${category}&`;
      if (employee_id) url += `employee_id=${employee_id}&`;

      try {
        const { permits } = await api(url);
        renderPermitsList(permits, types, canWrite, canDelete);
      } catch(e) {
        document.getElementById('permitsListContent').innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
      }
    };

    const renderPermitsList = (permits, types, canWrite, canDelete) => {
      selectedPermits.clear();
      updateBulkButton();

      if (!permits.length) {
        document.getElementById('permitsListContent').innerHTML = '<div class="help">Нет данных по заданным фильтрам</div>';
        return;
      }

      let html = '<div class="tbl-wrap"><table class="tbl"><thead><tr>';
      html += '<th style="width:30px"><input type="checkbox" id="checkAll"/></th>';
      html += '<th>Сотрудник</th><th>Тип допуска</th><th>Номер</th><th>Выдано</th><th>До</th><th>Статус</th>';
      if (canWrite || canDelete) html += '<th></th>';
      html += '</tr></thead><tbody>';

      permits.forEach(p => {
        const type = getTypeById(types, p.type_id);
        const cat = CATEGORIES[type.category] || { color: '#94a3b8' };

        html += `
          <tr data-id="${p.id}">
            <td><input type="checkbox" class="permitCheck" data-id="${p.id}"/></td>
            <td>${esc(p.employee_name || '—')}</td>
            <td><span style="border-left:3px solid ${cat.color};padding-left:8px">${esc(p.type_name || type.name)}</span></td>
            <td>${esc(p.doc_number || '—')}</td>
            <td>${p.issue_date ? formatDate(p.issue_date) : '—'}</td>
            <td>${p.expiry_date ? formatDate(p.expiry_date) : 'Бессрочно'}</td>
            <td>${getStatusBadge(p.computed_status, p.days_left)}</td>
            ${canWrite || canDelete ? `
              <td>
                <div style="display:flex;gap:4px">
                  ${p.scan_file ? `<a href="/api/files/download/${p.scan_file}" target="_blank" class="btn mini ghost" title="Скан">Скан</a>` : ''}
                  ${canWrite ? `<button class="btn mini ghost btnRenewPermit" data-permit='${JSON.stringify(p).replace(/'/g, "\\'")}'>Продл.</button>` : ''}
                  ${canWrite ? `<button class="btn mini ghost btnEditPermit" data-id="${p.id}" data-employee="${p.employee_id}">Изм.</button>` : ''}
                  ${canDelete ? `<button class="btn mini ghost btnDelPermit" data-id="${p.id}">Уд.</button>` : ''}
                </div>
              </td>
            ` : ''}
          </tr>
        `;
      });

      html += '</tbody></table></div>';
      document.getElementById('permitsListContent').innerHTML = html;

      // Bind events
      document.getElementById('checkAll').onchange = function() {
        document.querySelectorAll('.permitCheck').forEach(c => {
          c.checked = this.checked;
          if (this.checked) selectedPermits.add(parseInt(c.dataset.id));
          else selectedPermits.delete(parseInt(c.dataset.id));
        });
        updateBulkButton();
      };

      document.querySelectorAll('.permitCheck').forEach(c => {
        c.onchange = function() {
          if (this.checked) selectedPermits.add(parseInt(this.dataset.id));
          else selectedPermits.delete(parseInt(this.dataset.id));
          updateBulkButton();
        };
      });

      document.querySelectorAll('.btnRenewPermit').forEach(b => {
        b.onclick = () => openRenewModal(JSON.parse(b.dataset.permit), loadList);
      });

      document.querySelectorAll('.btnEditPermit').forEach(b => {
        b.onclick = async () => {
          const { permit } = await api('/' + b.dataset.id);
          openPermitModal(parseInt(b.dataset.employee), permit, loadList);
        };
      });

      document.querySelectorAll('.btnDelPermit').forEach(b => {
        b.onclick = async () => {
          if (!confirm('Удалить допуск?')) return;
          try {
            await api('/' + b.dataset.id, { method: 'DELETE' });
            AsgardUI.toast('Удалено', '', 'ok');
            loadList();
          } catch(e) {
            AsgardUI.toast('Ошибка', e.message, 'err');
          }
        };
      });
    };

    const updateBulkButton = () => {
      const btn = document.getElementById('btnBulkRenew');
      btn.disabled = selectedPermits.size === 0;
      btn.textContent = selectedPermits.size > 0 ? `Продлить выбранные (${selectedPermits.size})` : 'Продлить выбранные';
    };

    document.getElementById('btnApplyFilters').onclick = loadList;
    document.getElementById('btnSelectAll').onclick = () => {
      document.querySelectorAll('.permitCheck').forEach(c => {
        c.checked = true;
        selectedPermits.add(parseInt(c.dataset.id));
      });
      updateBulkButton();
    };
    document.getElementById('btnDeselectAll').onclick = () => {
      document.querySelectorAll('.permitCheck').forEach(c => c.checked = false);
      selectedPermits.clear();
      updateBulkButton();
    };
    document.getElementById('btnBulkRenew').onclick = () => {
      if (selectedPermits.size === 0) return;
      openBulkRenewModal([...selectedPermits], loadList);
    };

    if (canWrite) {
      document.getElementById('btnAddNewPermit').onclick = async () => {
        // Выбор сотрудника
        let employees = [];
        try { employees = await AsgardDB.getAll('employees') || []; } catch(e) {}
        const active = employees.filter(e => e.is_active);

        const selectHtml = `
          <div class="modal-overlay" id="selectEmployeeModal">
            <div class="modal-content" style="max-width:400px">
              <div class="modal-header">
                <h3>Выберите сотрудника</h3>
                <button class="btn ghost btnClose">&times;</button>
              </div>
              <div class="modal-body">
                <select id="empSelect" class="inp">
                  <option value="">— Выберите —</option>
                  ${active.map(e => `<option value="${e.id}">${esc(e.fio)}</option>`).join('')}
                </select>
              </div>
              <div class="modal-footer">
                <button class="btn ghost btnClose">Отмена</button>
                <button class="btn primary" id="btnConfirmEmp">Далее</button>
              </div>
            </div>
          </div>
        `;
        document.body.insertAdjacentHTML('beforeend', selectHtml);
        const modal = document.getElementById('selectEmployeeModal');
        modal.querySelectorAll('.btnClose').forEach(b => b.onclick = () => modal.remove());
        modal.onclick = e => { if (e.target === modal) modal.remove(); };

        document.getElementById('btnConfirmEmp').onclick = () => {
          const empId = parseInt(document.getElementById('empSelect').value);
          if (!empId) { AsgardUI.toast('Ошибка', 'Выберите сотрудника', 'err'); return; }
          modal.remove();
          openPermitModal(empId, null, loadList);
        };
      };
    }

    loadList();
  }

  // ═══════════════════════════════════════════════════════════════
  // РЕНДЕР ВКЛАДКИ МАТРИЦА
  // ═══════════════════════════════════════════════════════════════
  async function renderMatrixTab(container) {
    // Загрузить проекты для фильтра
    let works = [];
    try { works = await AsgardDB.getAll('works') || []; } catch(e) {}

    container.innerHTML = `
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;align-items:flex-end">
        <div class="field" style="margin:0">
          <label>Категория</label>
          <select id="matrixCategory" class="inp" style="min-width:150px">
            <option value="">Все</option>
            ${Object.entries(CATEGORIES).map(([id, c]) => `<option value="${id}">${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="margin:0">
          <label>Проект (для требований)</label>
          <select id="matrixWork" class="inp" style="min-width:250px">
            <option value="">Все типы</option>
            ${works.filter(w => w.work_status !== 'Завершён').map(w => `<option value="${w.id}">${esc(w.work_title || w.work_name || 'ID:' + w.id)}</option>`).join('')}
          </select>
        </div>
        <button class="btn" id="btnLoadMatrix">Показать</button>
      </div>

      <div id="matrixContent">
        <div class="help">Выберите параметры и нажмите "Показать"</div>
      </div>
    `;

    document.getElementById('btnLoadMatrix').onclick = async () => {
      const category = document.getElementById('matrixCategory').value;
      const work_id = document.getElementById('matrixWork').value;

      let url = '/matrix?';
      if (category) url += `category=${category}&`;
      if (work_id) url += `work_id=${work_id}&`;

      document.getElementById('matrixContent').innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm"></div> Загрузка...</div>';

      try {
        const { employees, types, matrix, required } = await api(url);

        if (!types.length) {
          document.getElementById('matrixContent').innerHTML = '<div class="help">Нет типов допусков по заданным фильтрам</div>';
          return;
        }

        let html = '<div class="tbl-wrap"><table class="tbl" style="font-size:12px"><thead><tr><th style="position:sticky;left:0;background:var(--bg-card);z-index:2">Сотрудник</th>';
        types.forEach(t => {
          const cat = CATEGORIES[t.category] || {};
          const mandatory = required && required[t.id] === true;
          html += `<th style="writing-mode:vertical-rl;text-orientation:mixed;padding:8px 4px;border-left:3px solid ${cat.color || '#94a3b8'}" title="${esc(t.name)}">${mandatory ? '<strong>*</strong>' : ''}${esc(t.name.substring(0, 20))}</th>`;
        });
        html += '</tr></thead><tbody>';

        employees.forEach(emp => {
          html += `<tr><td style="position:sticky;left:0;background:var(--bg-card);z-index:1;white-space:nowrap">${esc(emp.fio)}</td>`;
          types.forEach(t => {
            const key = `${emp.id}_${t.id}`;
            const cell = matrix[key];
            let icon = '—';
            let bg = '';
            let title = 'Нет допуска';
            if (cell) {
              if (cell.status === 'expired') { icon = '<span style="color:var(--red)">&#10060;</span>'; bg = 'rgba(239,68,68,0.1)'; title = 'Истёк'; }
              else if (cell.status === 'expiring_14') { icon = '<span style="color:var(--red)">&#9888;</span>'; bg = 'rgba(239,68,68,0.1)'; title = `${cell.days_left} дн.`; }
              else if (cell.status === 'expiring_30') { icon = '<span style="color:var(--amber)">&#9888;</span>'; bg = 'rgba(245,158,11,0.1)'; title = `${cell.days_left} дн.`; }
              else { icon = '<span style="color:var(--green)">&#10004;</span>'; bg = 'rgba(34,197,94,0.1)'; title = 'Действует'; }
            }
            html += `<td style="text-align:center;background:${bg}" title="${title}">${icon}</td>`;
          });
          html += '</tr>';
        });

        html += '</tbody></table></div>';

        if (required) {
          html += '<div class="help" style="margin-top:12px"><strong>*</strong> — обязательные допуски для проекта</div>';
        }

        document.getElementById('matrixContent').innerHTML = html;
      } catch(e) {
        document.getElementById('matrixContent').innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // РЕНДЕР ВКЛАДКИ ПРОЕКТЫ
  // ═══════════════════════════════════════════════════════════════
  async function renderProjectsTab(container) {
    let works = [];
    try { works = await AsgardDB.getAll('works') || []; } catch(e) {}
    const types = await getTypes();
    const canWrite = AsgardAuth.hasPermission?.('permits', 'write');

    container.innerHTML = `
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;align-items:flex-end">
        <div class="field" style="margin:0;flex:1;min-width:300px">
          <label>Выберите проект</label>
          <select id="projectSelect" class="inp">
            <option value="">— Выберите —</option>
            ${works.filter(w => w.work_status !== 'Завершён').map(w => `<option value="${w.id}">${esc(w.work_title || w.work_name || 'Проект #' + w.id)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div id="projectContent">
        <div class="help">Выберите проект для просмотра требований и проверки команды</div>
      </div>
    `;

    document.getElementById('projectSelect').onchange = async function() {
      const workId = this.value;
      if (!workId) {
        document.getElementById('projectContent').innerHTML = '<div class="help">Выберите проект</div>';
        return;
      }

      document.getElementById('projectContent').innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm"></div> Загрузка...</div>';

      try {
        const [reqResp, compResp] = await Promise.all([
          api(`/work/${workId}/requirements`),
          api(`/work/${workId}/compliance`)
        ]);

        const requirements = reqResp.requirements || [];
        const { compliance, team_ready } = compResp;

        let html = `<div class="card" style="margin-bottom:16px">
          <h4>Требуемые допуски</h4>
          ${canWrite ? `
            <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
              <select id="addReqType" class="inp" style="flex:1;min-width:200px">
                <option value="">— Добавить тип —</option>
                ${Object.entries(CATEGORIES).map(([catId, cat]) => `
                  <optgroup label="${cat.name}">
                    ${types.filter(t => t.category === catId).map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
                  </optgroup>
                `).join('')}
              </select>
              <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="addReqMandatory" checked/> Обязательный</label>
              <button class="btn mini" id="btnAddReq">Добавить</button>
            </div>
          ` : ''}

          ${requirements.length === 0 ? '<div class="help">Требования не заданы</div>' : `
            <table class="tbl">
              <thead><tr><th>Тип допуска</th><th>Обязательный</th>${canWrite ? '<th></th>' : ''}</tr></thead>
              <tbody>
                ${requirements.map(r => `
                  <tr>
                    <td>${esc(r.type_name)}</td>
                    <td>${r.is_mandatory ? '<span style="color:var(--green)">Да</span>' : 'Нет'}</td>
                    ${canWrite ? `<td><button class="btn mini ghost btnDelReq" data-id="${r.id}">Удалить</button></td>` : ''}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>`;

        html += `<div class="card">
          <h4>Готовность команды
            ${team_ready
              ? '<span class="badge" style="background:var(--green)20;color:var(--green)">Готова</span>'
              : '<span class="badge" style="background:var(--red)20;color:var(--red)">Не готова</span>'}
          </h4>
          ${compliance.length === 0 ? '<div class="help">В команде проекта нет назначенных сотрудников</div>' : `
            <table class="tbl">
              <thead><tr><th>Сотрудник</th><th>Допуски</th><th>Статус</th></tr></thead>
              <tbody>
                ${compliance.map(c => `
                  <tr>
                    <td>${esc(c.employee_name)}</td>
                    <td>
                      ${c.checks.map(ch => {
                        const t = types.find(t => t.id === ch.type_id) || { name: ch.type_id };
                        return `<span class="badge" style="background:${ch.has ? 'var(--green)' : 'var(--red)'}20;color:${ch.has ? 'var(--green)' : 'var(--red)'}${ch.mandatory ? ';font-weight:bold' : ''}" title="${esc(t.name)}">${ch.has ? '+' : '-'} ${esc(t.name.substring(0, 15))}</span> `;
                      }).join('')}
                    </td>
                    <td>${c.mandatory_ok
                      ? '<span style="color:var(--green)">OK</span>'
                      : '<span style="color:var(--red)">Не хватает</span>'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>`;

        document.getElementById('projectContent').innerHTML = html;

        // Bind events
        if (canWrite) {
          document.getElementById('btnAddReq')?.addEventListener('click', async () => {
            const typeId = document.getElementById('addReqType').value;
            if (!typeId) { AsgardUI.toast('Ошибка', 'Выберите тип', 'err'); return; }
            const mandatory = document.getElementById('addReqMandatory').checked;
            try {
              await api(`/work/${workId}/requirements`, {
                method: 'POST',
                body: { permit_type_id: typeId, is_mandatory: mandatory }
              });
              AsgardUI.toast('Добавлено', '', 'ok');
              document.getElementById('projectSelect').dispatchEvent(new Event('change'));
            } catch(e) {
              AsgardUI.toast('Ошибка', e.message, 'err');
            }
          });

          document.querySelectorAll('.btnDelReq').forEach(b => {
            b.onclick = async () => {
              if (!confirm('Удалить требование?')) return;
              try {
                await api(`/work/${workId}/requirements/${b.dataset.id}`, { method: 'DELETE' });
                AsgardUI.toast('Удалено', '', 'ok');
                document.getElementById('projectSelect').dispatchEvent(new Event('change'));
              } catch(e) {
                AsgardUI.toast('Ошибка', e.message, 'err');
              }
            };
          });
        }
      } catch(e) {
        document.getElementById('projectContent').innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ГЛАВНЫЙ РЕНДЕР СТРАНИЦЫ
  // ═══════════════════════════════════════════════════════════════
  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = "#/login"; return; }

    // Проверка прав
    if (!AsgardAuth.hasPermission?.('permits', 'read') && auth.user.role !== 'ADMIN') {
      AsgardUI.toast('Доступ', 'Недостаточно прав', 'err');
      location.hash = '#/home';
      return;
    }

    // Автопроверка уведомлений (раз в день)
    const lastCheck = localStorage.getItem('permits_last_check');
    const today = new Date().toISOString().slice(0, 10);
    if (lastCheck !== today) {
      try {
        await api('/check-expiry');
        localStorage.setItem('permits_last_check', today);
      } catch(e) { /* ignore */ }
    }

    // Загрузить статистику
    let stats = { total: 0, active: 0, expired: 0, expiring_14: 0, expiring_30: 0 };
    try {
      stats = await api('/stats');
    } catch(e) {}

    const html = `
      <div class="panel">
        <div class="row" style="gap:16px;flex-wrap:wrap;margin-bottom:16px">
          <div class="card" style="flex:1;min-width:120px;text-align:center;padding:16px;border-left:4px solid var(--blue)">
            <div style="font-size:24px;font-weight:bold">${stats.total || 0}</div>
            <div class="help">Всего</div>
          </div>
          <div class="card" style="flex:1;min-width:120px;text-align:center;padding:16px;border-left:4px solid var(--green)">
            <div style="font-size:24px;font-weight:bold">${stats.active || 0}</div>
            <div class="help">Действующих</div>
          </div>
          <div class="card" style="flex:1;min-width:120px;text-align:center;padding:16px;border-left:4px solid var(--amber)">
            <div style="font-size:24px;font-weight:bold">${stats.expiring_30 || 0}</div>
            <div class="help">Истекают (30 дн.)</div>
          </div>
          <div class="card" style="flex:1;min-width:120px;text-align:center;padding:16px;border-left:4px solid var(--red)">
            <div style="font-size:24px;font-weight:bold">${stats.expiring_14 || 0}</div>
            <div class="help">Истекают (14 дн.)</div>
          </div>
          <div class="card" style="flex:1;min-width:120px;text-align:center;padding:16px;border-left:4px solid var(--red)">
            <div style="font-size:24px;font-weight:bold;color:var(--red)">${stats.expired || 0}</div>
            <div class="help">Истекли</div>
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
          <button class="btn ${currentTab === 'list' ? 'primary' : ''}" data-tab="list">Список</button>
          <button class="btn ${currentTab === 'matrix' ? 'primary' : ''}" data-tab="matrix">Матрица</button>
          <button class="btn ${currentTab === 'projects' ? 'primary' : ''}" data-tab="projects">Проекты</button>
          <button class="btn ghost" id="btnCheckNotify" style="margin-left:auto">Проверить уведомления</button>
          ${(['ADMIN','HR','TO','HEAD_TO','HR_MANAGER'].includes(auth.user.role)) ?
            '<button class="btn ghost" id="btnManageTypes">Управление типами</button>' : ''}
        </div>

        <div id="tabContent"></div>
      </div>
    `;

    await layout(html, { title: title || 'Разрешения и допуски' });

    // Tab switching
    const tabContainer = document.getElementById('tabContent');

    const switchTab = async (tab) => {
      currentTab = tab;
      document.querySelectorAll('[data-tab]').forEach(b => {
        b.classList.toggle('primary', b.dataset.tab === tab);
      });

      if (tab === 'list') await renderListTab(tabContainer);
      else if (tab === 'matrix') await renderMatrixTab(tabContainer);
      else if (tab === 'projects') await renderProjectsTab(tabContainer);
    };

    document.querySelectorAll('[data-tab]').forEach(b => {
      b.onclick = () => switchTab(b.dataset.tab);
    });

    document.getElementById('btnCheckNotify').onclick = async () => {
      try {
        const result = await api('/check-expiry');
        AsgardUI.toast('Проверено', `Отправлено уведомлений: ${result.sent}`, 'ok');
        localStorage.setItem('permits_last_check', today);
      } catch(e) {
        AsgardUI.toast('Ошибка', e.message, 'err');
      }
    };

    const btnManageTypes = document.getElementById('btnManageTypes');
    if (btnManageTypes) btnManageTypes.onclick = () => openManageTypesModal();

    // Initial tab
    switchTab(currentTab);
  }

  // ═══════════════════════════════════════════════════════════════
  // ПРОВЕРКА УВЕДОМЛЕНИЙ (legacy)
  // ═══════════════════════════════════════════════════════════════
  async function checkAndNotify() {
    try {
      await api('/check-expiry');
    } catch(e) {
      console.error('checkAndNotify error:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // УПРАВЛЕНИЕ ТИПАМИ РАЗРЕШЕНИЙ (модалка)
  // ═══════════════════════════════════════════════════════════════
  async function openManageTypesModal() {
    let types = [];
    try {
      const auth = await AsgardAuth.getAuth();
      const resp = await fetch('/api/permit-applications/types', {
        headers: { 'Authorization': 'Bearer ' + (auth?.token || '') }
      });
      if (resp.ok) {
        const data = await resp.json();
        types = data.types || [];
      }
    } catch(e) {
      AsgardUI.toast('Ошибка', 'Не удалось загрузить типы', 'err');
      return;
    }

    function renderTypesList() {
      return types.map(t => `
        <div style="display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid var(--border)">
          <span class="dot" style="background:${(CATEGORIES[t.category]||{}).color||'#888'}"></span>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:500">${esc(t.name)}</div>
            <div class="help" style="font-size:11px">${esc(t.code)} &middot; ${(CATEGORIES[t.category]||{}).name||t.category}</div>
          </div>
          ${t.is_system ? '<span class="badge" style="font-size:10px;opacity:0.5">системный</span>' :
            `<button class="btn mini ghost btnDeleteType" data-id="${t.id}" title="Деактивировать">&#10005;</button>`}
        </div>
      `).join('');
    }

    const catOptions = Object.entries(CATEGORIES).map(([k,v]) =>
      `<option value="${k}">${v.name}</option>`
    ).join('');

    const html = `
      <div class="modal-overlay" id="manageTypesModal">
        <div class="modal-content" style="max-width:700px">
          <div class="modal-header">
            <h3>Управление типами разрешений</h3>
            <button class="btn ghost btnClose">&times;</button>
          </div>
          <div class="modal-body" style="max-height:60vh;overflow-y:auto">
            <div style="display:flex;gap:8px;margin-bottom:16px">
              <input id="newTypeName" class="inp" placeholder="Название нового типа..." style="flex:1"/>
              <select id="newTypeCat" class="inp" style="width:180px">${catOptions}</select>
              <button class="btn primary" id="btnAddType">+ Добавить</button>
            </div>
            <div id="typesList">${renderTypesList()}</div>
          </div>
          <div class="modal-footer" style="padding:16px;text-align:right">
            <button class="btn ghost btnClose">Закрыть</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById('manageTypesModal');
    modal.querySelectorAll('.btnClose').forEach(b => b.onclick = () => modal.remove());
    modal.onclick = e => { if (e.target === modal) modal.remove(); };

    document.getElementById('btnAddType').onclick = async () => {
      const name = document.getElementById('newTypeName').value.trim();
      const category = document.getElementById('newTypeCat').value;
      if (!name || name.length < 3) { AsgardUI.toast('Ошибка','Название мин. 3 символа','err'); return; }
      try {
        const auth = await AsgardAuth.getAuth();
        const resp = await fetch('/api/permit-applications/types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (auth?.token||'') },
          body: JSON.stringify({ name, category })
        });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.error); }
        const data = await resp.json();
        types.push(data.type);
        document.getElementById('typesList').innerHTML = renderTypesList();
        document.getElementById('newTypeName').value = '';
        serverTypes = null; // invalidate cache
        AsgardUI.toast('Готово','Тип добавлен','ok');
      } catch(e) { AsgardUI.toast('Ошибка', e.message, 'err'); }
    };

    document.getElementById('typesList').addEventListener('click', async (e) => {
      const btn = e.target.closest('.btnDeleteType');
      if (!btn) return;
      const id = btn.dataset.id;
      if (!confirm('Деактивировать этот тип?')) return;
      try {
        const auth = await AsgardAuth.getAuth();
        const resp = await fetch('/api/permit-applications/types/' + id, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + (auth?.token||'') }
        });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.error); }
        types = types.filter(t => String(t.id) !== String(id));
        document.getElementById('typesList').innerHTML = renderTypesList();
        serverTypes = null;
        AsgardUI.toast('Готово','Тип деактивирован','ok');
      } catch(e) { AsgardUI.toast('Ошибка', e.message, 'err'); }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // EXPORTS
  // ═══════════════════════════════════════════════════════════════
  return {
    render,
    renderEmployeePermits,
    openPermitModal,
    getAll,
    save,
    remove,
    getExpiringPermits,
    checkAndNotify,
    PERMIT_TYPES,
    CATEGORIES
  };
})();
