// ASGARD CRM — Заявки на пропуск
window.AsgardPassRequestsPage = (function() {
  const { $, esc, toast, showModal, hideModal } = AsgardUI;

  const STATUS_MAP = {
    draft: { label: 'Черновик', color: '#64748b' },
    submitted: { label: 'Подана', color: '#3b82f6' },
    approved: { label: 'Одобрена', color: '#22c55e' },
    rejected: { label: 'Отклонена', color: '#ef4444' },
    issued: { label: 'Выдан', color: '#8b5cf6' },
    expired: { label: 'Просрочен', color: '#f59e0b' }
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
      const items = data.items || [];

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
            <tbody>${items.map(i => {
              const st = STATUS_MAP[i.status] || STATUS_MAP.draft;
              const emps = Array.isArray(i.employees_json) ? i.employees_json : [];
              return `<tr>
                <td>${i.id}</td>
                <td>${esc(i.object_name || '—')}</td>
                <td>${i.pass_date_from || '?'} — ${i.pass_date_to || '?'}</td>
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
        <div><label>Дата с</label><input id="prFrom" type="date" value="${item.pass_date_from || ''}" /></div>
        <div><label>Дата по</label><input id="prTo" type="date" value="${item.pass_date_to || ''}" /></div>
      </div>
      <div class="formrow">
        <div><label>Контактное лицо</label><input id="prContact" value="${esc(item.contact_person || '')}" /></div>
        <div><label>Телефон</label><input id="prPhone" value="${esc(item.contact_phone || '')}" /></div>
      </div>
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Сотрудники (ФИО, по одному на строку)</label>
        <textarea id="prEmps" rows="4" placeholder="Иванов Иван Иванович&#10;Петров Пётр Петрович">${emps.map(e => e.fio || e.name || '').join('\n')}</textarea>
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

    showModal(id ? `Заявка #${id}` : 'Новая заявка на пропуск', html);

    $('#btnSavePass')?.addEventListener('click', async () => {
      const employees = ($('#prEmps')?.value || '').split('\n').filter(s => s.trim()).map(fio => ({ fio: fio.trim() }));
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
  }

  return { render };
})();
