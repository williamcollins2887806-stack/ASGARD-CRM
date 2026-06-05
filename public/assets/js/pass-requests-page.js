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
            }).join('')}</tbody>
          </table>
        </div>`;

      // Пагинация (после рендера таблицы)
      if (window.AsgardPagination) {
        let pgEl = document.getElementById("passreq_pagination");
        if (!pgEl) { pgEl = document.createElement("div"); pgEl.id = "passreq_pagination"; el.appendChild(pgEl); }
        pgEl.innerHTML = AsgardPagination.renderControls(items.length, currentPage, pageSize);
        AsgardPagination.attachHandlers("passreq_pagination",
          (p) => { currentPage = p; loadList(); },
          (s) => { pageSize = s; currentPage = 1; loadList(); }
        );
      }

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
        <div id="prEmpsPicker"></div>
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

    const PASS_PICKER_ID = 'pass-emps';

    $('#btnSavePass')?.addEventListener('click', async () => {
      const selIds = (window.CREmployeePicker ? CREmployeePicker.getSelected(PASS_PICKER_ID) : []) || [];
      const empById = new Map((window.__passEmpList || []).map(e => [e.id, e]));
      const employees = selIds.map(id => {
        const e = empById.get(id);
        return { fio: e ? e.name : '', employee_id: id };
      });
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

    // === Employee Picker (единый компонент CREmployeePicker) ===
    (async () => {
      const wrap = $('#prEmpsPicker');
      if (!wrap || !window.CREmployeePicker) return;

      // Текущие выбранные (при редактировании) — сопоставляем по employee_id
      const preselected = emps.map(e => e.employee_id).filter(Boolean);

      // Создаём пикер с авто-загрузкой справочника сотрудников из /api/staff/employees.
      CREmployeePicker.destroy(PASS_PICKER_ID);
      const el = await CREmployeePicker.createAsync({
        id: PASS_PICKER_ID,
        selected: preselected,
        placeholder: 'Выберите сотрудников для пропуска…',
        showChips: true,
        maxChips: 5,
        fullWidth: true,
        title: 'Сотрудники в заявке на пропуск',
      });
      wrap.innerHTML = '';
      wrap.appendChild(el);

      // Сохраняем справочник для сборки fio при сабмите
      // (createAsync уже загрузил employees внутрь инстанса — забираем тот же список)
      try {
        const res = await fetch('/api/staff/employees?limit=1000');
        if (res.ok) {
          const data = await res.json();
          window.__passEmpList = (data.employees || data.rows || []).map(e => ({
            id: e.id,
            name: e.full_name || e.fio || e.name || `${e.last_name || ''} ${e.first_name || ''}`.trim(),
          }));
        }
      } catch (_) { window.__passEmpList = []; }
    })();
    // === End Employee Picker ===
  }

  return { render };
})();
