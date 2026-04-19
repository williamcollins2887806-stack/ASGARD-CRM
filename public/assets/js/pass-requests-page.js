// ASGARD CRM — Заявки на пропуск
window.AsgardPassRequestsPage = (function() {
  let allItems = [], currentPage = 1, pageSize = window.AsgardPagination ? AsgardPagination.getPageSize() : 20;
  const { $, esc, toast, showModal, hideModal } = AsgardUI;

  const STATUS_MAP = {
    draft: { label: 'Черновик', color: 'var(--t2)' },
    submitted: { label: 'Подана', color: 'var(--info)' },
    approved: { label: 'Одобрена', color: 'var(--ok-t)' },
    rejected: { label: 'Отклонена', color: 'var(--err-t)' },
    issued: { label: 'Выдан', color: 'var(--purple)' },
    expired: { label: 'Просрочен', color: 'var(--amber)' }
  };

  async function render({ layout, title }) {
    await layout('<div id="pass-page"><div class="loading">Загрузка...</div></div>', { title });
    await loadList();
  }

  async function loadList() {
    const el = $('#pass-page');
    if (!el) return;
    try {
      const token = localStorage.getItem('asgard_token');
      const resp = await fetch('/api/pass-requests', { headers: { Authorization: 'Bearer ' + token } });
      const data = await resp.json();
      const items = data.items;
      allItems = items;
      const pagedItems = window.AsgardPagination ? AsgardPagination.paginate(items, currentPage, pageSize) : items || [];

      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="margin:0">Заявки на пропуск (${items.length})</h3>
          <button class="btn primary" id="btnNewPass">+ Новая заявка</button>
        </div>
        <div class="tbl-wrap">
          <table class="data-table">
            <thead><tr>
              <th>№</th><th>Объект</th><th>Период</th><th>Сотрудники</th><th>Статус</th><th>Дата</th><th></th>
            </tr></thead>
            <tbody>${pagedItems.map(i => {
              const st = STATUS_MAP[i.status] || STATUS_MAP.draft;
              const emps = Array.isArray(i.employees_json) ? i.employees_json : [];
              return `<tr>
                <td>${i.id}</td>
                <td>${esc(i.object_name || '—')}</td>
                <td>${i.pass_date_from ? AsgardUI.formatDate(i.pass_date_from) : '?'} — ${i.pass_date_to ? AsgardUI.formatDate(i.pass_date_to) : '?'}</td>
                <td>${emps.length} чел.</td>
                <td><span style="color:${st.color};font-weight:600">${st.label}</span></td>
                <td>${i.created_at ? new Date(i.created_at).toLocaleDateString('ru-RU') : ''}</td>
                <td>
                  <button class="btn ghost mini" data-action="pdf" data-id="${i.id}" title="PDF">📄</button>
                  <button class="btn ghost mini" data-action="edit" data-id="${i.id}" title="Открыть">✏️</button>
                </td>
              </tr>`;
      // Пагинация
      if (window.AsgardPagination) {
        let pgEl = document.getElementById("passreq_pagination");
        if (!pgEl) { pgEl = document.createElement("div"); pgEl.id = "passreq_pagination"; el.appendChild(pgEl); }
        pgEl.innerHTML = AsgardPagination.renderControls(items.length, currentPage, pageSize);
        AsgardPagination.attachHandlers("passreq_pagination",
          (p) => { currentPage = p; loadList(); },
          (s) => { pageSize = s; currentPage = 1; loadList(); }
        );
      }
            }).join('')}</tbody>
          </table>
        </div>`;

      $('#btnNewPass')?.addEventListener('click', () => openForm());
      el.querySelectorAll('[data-action="pdf"]').forEach(b => {
        b.addEventListener('click', () => {
          const token = localStorage.getItem('asgard_token');
          window.open(`/api/pass-requests/${b.dataset.id}/pdf?token=${token}`, '_blank');
        });
      });
      el.querySelectorAll('[data-action="edit"]').forEach(b => {
        b.addEventListener('click', () => openForm(b.dataset.id));
      });
    } catch (e) {
      el.innerHTML = `<div class="err">Ошибка: ${esc(e.message)}</div>`;
    }
  }

  async function openForm(id) {
    let item = {};
    if (id) {
      const token = localStorage.getItem('asgard_token');
      const resp = await fetch(`/api/pass-requests/${id}`, { headers: { Authorization: 'Bearer ' + token } });
      const data = await resp.json();
      item = data.item || {};
    }

    const emps = Array.isArray(item.employees_json) ? item.employees_json : [];
    const vehs = Array.isArray(item.vehicles_json) ? item.vehicles_json : [];

    const html = `
      <div class="formrow">
        <div><label>Объект</label><input id="prObj" value="${esc(item.object_name || '')}" placeholder="Название объекта" /></div>
      </div>
      <div class="formrow">
        <div><label>Дата с</label><input id="prFrom" type="date" value="${(item.pass_date_from || '').slice(0,10)}" /></div>
        <div><label>Дата по</label><input id="prTo" type="date" value="${(item.pass_date_to || '').slice(0,10)}" /></div>
      </div>
      <div class="formrow">
        <div><label>Контактное лицо</label><input id="prContact" value="${esc(item.contact_person || '')}" /></div>
        <div><label>Телефон</label><input id="prPhone" value="${esc(item.contact_phone || '')}" /></div>
      </div>
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Сотрудники</label>
        <div id="prEmpsSelected" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px"></div>
        <input id="prEmpsSearch" type="text" placeholder="Поиск по ФИО, роли, разряду..." style="width:100%;margin-bottom:6px" />
        <div id="prEmpsList" style="max-height:300px;overflow-y:auto;border:1px solid var(--border,#333);border-radius:8px;padding:4px;position:relative">
          <div style="text-align:center;padding:20px;opacity:0.5">Загрузка сотрудников...</div>
        </div>
        <div style="position:sticky;bottom:0;background:var(--bg2,#1e1e2e);padding:8px 0 0 0;z-index:2">
          <button type="button" class="btn primary" id="btnAddSelectedEmps" style="width:100%">Добавить выбранных</button>
        </div>
      </div></div>
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Транспорт (марка + номер, по одному)</label>
        <textarea id="prVehs" rows="2" placeholder="Газель А123БВ77">${vehs.map(v => `${v.brand || v.type || ''} ${v.plate || v.number || ''}`).join('\n')}</textarea>
      </div></div>
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Примечания</label><textarea id="prNotes" rows="2">${esc(item.notes || '')}</textarea>
      </div></div>
      <hr class="hr"/>
      <div style="display:flex;gap:10px">
        <button class="btn primary" id="btnSavePass" style="flex:1">${id ? '💾 Сохранить' : '➕ Создать'}</button>
        ${id && ['draft','submitted'].includes(item.status) ? '<button class="btn" id="btnSubmitPass">📨 Подать</button>' : ''}
      </div>`;

    showModal({ title: id ? `Заявка #${id}` : 'Новая заявка на пропуск', html, icon: '🪪', subtitle: 'Заявка на пропуск' });

    $('#btnSavePass')?.addEventListener('click', async () => {
      const employees = (window.__passReqSelectedEmps || []).map(e => ({ fio: e.fio, employee_id: e.id }));
      const vehicles = ($('#prVehs')?.value || '').split('\n').filter(s => s.trim()).map(line => {
        const parts = line.trim().split(/\s+/);
        return { brand: parts.slice(0, -1).join(' ') || 'ТС', plate: parts[parts.length - 1] || '' };
      });
      const body = {
        object_name: $('#prObj')?.value,
        pass_date_from: $('#prFrom')?.value,
        pass_date_to: $('#prTo')?.value,
        contact_person: $('#prContact')?.value,
        contact_phone: $('#prPhone')?.value,
        employees_json: employees,
        vehicles_json: vehicles,
        notes: $('#prNotes')?.value
      };
      const token = localStorage.getItem('asgard_token');
      const url = id ? `/api/pass-requests/${id}` : '/api/pass-requests';
      const method = id ? 'PUT' : 'POST';
      const resp = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
      if (resp.ok) { toast('Готово', id ? 'Заявка обновлена' : 'Заявка создана'); hideModal(); loadList(); }
      else { const err = await resp.json(); toast('Ошибка', err.error || 'Ошибка', 'err'); }
    });

    $('#btnSubmitPass')?.addEventListener('click', async () => {
      const token = localStorage.getItem('asgard_token');
      const resp = await fetch(`/api/pass-requests/${id}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ status: 'submitted' }) });
      if (resp.ok) { toast('Готово', 'Заявка подана на согласование'); hideModal(); loadList(); }
      else { const err = await resp.json(); toast('Ошибка', err.error || 'Ошибка', 'err'); }
    });

    // === Employee Picker Logic ===
    window.__passReqSelectedEmps = emps.map(e => ({ id: e.employee_id || null, fio: e.fio || e.name || '' }));
    let allEmployeesList = [];

    function renderSelectedChips() {
      const container = $('#prEmpsSelected');
      if (!container) return;
      const selected = window.__passReqSelectedEmps;
      if (selected.length === 0) {
        container.innerHTML = '<span style="opacity:0.4;font-size:12px">Нет выбранных сотрудников</span>';
        return;
      }
      container.innerHTML = selected.map((e, idx) =>
        '<span style="display:inline-flex;align-items:center;gap:4px;background:var(--blue-glow,rgba(59,130,246,0.15));color:var(--blue,#60a5fa);border-radius:12px;padding:3px 10px;font-size:12px;font-weight:500">' +
          esc(e.fio) +
          '<span data-remove-emp="' + idx + '" style="cursor:pointer;margin-left:2px;font-size:14px;line-height:1;opacity:0.7" title="Убрать">&times;</span>' +
        '</span>'
      ).join('');
      container.querySelectorAll('[data-remove-emp]').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = parseInt(btn.dataset.removeEmp);
          window.__passReqSelectedEmps.splice(i, 1);
          renderSelectedChips();
          renderEmployeeList(allEmployeesList, ($('#prEmpsSearch')?.value || '').toLowerCase());
        });
      });
    }

    function renderEmployeeList(employees, searchTerm) {
      const container = $('#prEmpsList');
      if (!container) return;
      const selectedIds = new Set(window.__passReqSelectedEmps.filter(e => e.id).map(e => String(e.id)));
      const selectedNames = new Set(window.__passReqSelectedEmps.filter(e => !e.id).map(e => e.fio.toLowerCase()));
      let filtered = employees;
      if (searchTerm) {
        filtered = employees.filter(e => {
          const haystack = ((e.fio || '') + ' ' + (e.role_tag || '') + ' ' + (e.grade || '')).toLowerCase();
          return haystack.includes(searchTerm);
        });
      }
      if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.5">Не найдено</div>';
        return;
      }
      container.innerHTML = filtered.map(e => {
        const isChecked = selectedIds.has(String(e.id)) || selectedNames.has((e.fio || '').toLowerCase());
        return '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;transition:background .15s" ' +
          'onmouseenter="this.style.background=\'var(--bg3,rgba(255,255,255,0.05))\'" onmouseleave="this.style.background=\'transparent\'">' +
          '<input type="checkbox" class="empCheckbox" data-emp-id="' + e.id + '" data-emp-fio="' + esc(e.fio || '') + '" ' + (isChecked ? 'checked' : '') + ' style="flex-shrink:0" />' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-weight:500;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(e.fio || 'Без имени') + '</div>' +
            '<div style="font-size:11px;opacity:0.6">' + esc(e.role_tag || '—') + (e.grade ? ' · Разряд ' + esc(e.grade) : '') + '</div>' +
          '</div>' +
        '</label>';
      }).join('');
    }

    $('#btnAddSelectedEmps')?.addEventListener('click', () => {
      const checkboxes = document.querySelectorAll('#prEmpsList .empCheckbox');
      const selectedIds = new Set(window.__passReqSelectedEmps.filter(e => e.id).map(e => String(e.id)));
      const selectedNames = new Set(window.__passReqSelectedEmps.filter(e => !e.id).map(e => e.fio.toLowerCase()));
      const newSelected = [...window.__passReqSelectedEmps];
      const checkedNow = new Set();
      let added = 0;
      checkboxes.forEach(cb => {
        const empId = cb.dataset.empId;
        const empFio = cb.dataset.empFio;
        checkedNow.add(empId);
        if (cb.checked && !selectedIds.has(empId) && !selectedNames.has(empFio.toLowerCase())) {
          newSelected.push({ id: parseInt(empId), fio: empFio });
          added++;
        }
      });
      window.__passReqSelectedEmps = newSelected.filter(e => {
        if (!e.id) return true;
        if (!checkedNow.has(String(e.id))) return true;
        const cb = document.querySelector('#prEmpsList .empCheckbox[data-emp-id="' + e.id + '"]');
        return cb ? cb.checked : true;
      });
      renderSelectedChips();
      renderEmployeeList(allEmployeesList, ($('#prEmpsSearch')?.value || '').toLowerCase());
      if (added > 0) toast('Готово', 'Добавлено: ' + added);
    });

    let _empSearchTimer = null;
    $('#prEmpsSearch')?.addEventListener('input', (ev) => {
      clearTimeout(_empSearchTimer);
      _empSearchTimer = setTimeout(() => {
        const term = (ev.target.value || '').toLowerCase();
        renderEmployeeList(allEmployeesList, term);
      }, 200);
    });

    renderSelectedChips();
    (async () => {
      try {
        const token = localStorage.getItem('asgard_token');
        const resp = await fetch('/api/data/employees?limit=10000', { headers: { Authorization: 'Bearer ' + token } });
        const data = await resp.json();
        allEmployeesList = (data.employees || []).filter(e => e.status !== 'fired');
        allEmployeesList.sort((a, b) => (a.fio || '').localeCompare(b.fio || '', 'ru'));
        renderEmployeeList(allEmployeesList, '');
      } catch(err) {
        const container = $('#prEmpsList');
        if (container) container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--err-t,#f87171)">Ошибка загрузки: ' + esc(err.message) + '</div>';
      }
    })();
    // === End Employee Picker Logic ===
  }

  return { render };
})();
