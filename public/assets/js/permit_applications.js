/**
 * АСГАРД CRM — Заявки на допуск (наряд-допуск)
 * Форма подачи заявок на допуск сотрудников к работам
 */
window.AsgardPermitApplications = (function(){

  const WORK_TYPES = [
    'Работы на высоте',
    'Огневые работы',
    'Газоопасные работы',
    'Работы в ограниченных пространствах',
    'Электромонтажные работы',
    'Погрузочно-разгрузочные работы',
    'Работы с грузоподъёмными механизмами',
    'Земляные работы',
    'Сварочные работы',
    'Работы с химическими веществами',
    'Другое'
  ];

  function esc(s){ return String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmtDate(d){ return d ? new Date(d).toLocaleDateString('ru-RU') : '—'; }

  async function getAll(){
    try { return await AsgardDB.getAll('permit_applications') || []; }
    catch(e){ return JSON.parse(localStorage.getItem('asgard_permit_apps')||'[]'); }
  }

  async function save(app){
    if(!app.id) app.id = 'pa_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
    app.updated_at = new Date().toISOString();
    try { await AsgardDB.put('permit_applications', app); }
    catch(e){
      const all = await getAll();
      const idx = all.findIndex(a => a.id === app.id);
      if(idx >= 0) all[idx] = app; else all.push(app);
      localStorage.setItem('asgard_permit_apps', JSON.stringify(all));
    }
    return app;
  }

  async function remove(id){
    try { await AsgardDB.delete('permit_applications', id); }
    catch(e){
      const all = await getAll();
      localStorage.setItem('asgard_permit_apps', JSON.stringify(all.filter(a => a.id !== id)));
    }
  }

  function statusBadge(status){
    const map = {
      draft:    { label:'Черновик',  color:'var(--text-muted)' },
      pending:  { label:'На рассмотрении', color:'var(--amber)' },
      approved: { label:'Одобрена',  color:'var(--green)' },
      rejected: { label:'Отклонена', color:'var(--red)' },
      active:   { label:'Действует', color:'var(--blue)' },
      closed:   { label:'Закрыта',   color:'var(--text-muted)' }
    };
    const s = map[status] || map.draft;
    return `<span class="badge" style="background:${s.color}20;color:${s.color}">${s.label}</span>`;
  }

  // ─── Модалка создания/редактирования заявки ────────────────────────
  async function openForm(existing, onSave){
    const isEdit = !!existing;
    const users = await AsgardDB.getAll('users') || [];
    const activeUsers = users.filter(u => u.status !== 'blocked');
    const app = existing || {
      work_type: '',
      object_name: '',
      object_address: '',
      date_start: '',
      date_end: '',
      description: '',
      responsible_id: '',
      employees: [],
      status: 'draft',
      created_at: new Date().toISOString()
    };

    const selectedEmps = new Set(app.employees || []);

    const html = `
      <div class="modal-overlay" id="permitAppModal">
        <div class="modal-content" style="max-width:700px;max-height:90vh;overflow-y:auto">
          <div class="modal-header">
            <h3>${isEdit ? 'Редактирование заявки' : 'Новая заявка на допуск'}</h3>
            <button class="btn ghost btnClose">✕</button>
          </div>
          <div class="modal-body" style="display:flex;flex-direction:column;gap:16px">

            <div class="formrow">
              <div class="field" style="flex:1">
                <label>Вид работ *</label>
                <select id="paWorkType" class="inp">
                  <option value="">— Выберите —</option>
                  ${WORK_TYPES.map(t => `<option value="${esc(t)}" ${app.work_type===t?'selected':''}>${esc(t)}</option>`).join('')}
                </select>
              </div>
            </div>

            <div class="formrow">
              <div class="field" style="flex:1">
                <label>Объект</label>
                <input id="paObject" class="inp" value="${esc(app.object_name)}" placeholder="Название объекта"/>
              </div>
              <div class="field" style="flex:1">
                <label>Адрес</label>
                <input id="paAddress" class="inp" value="${esc(app.object_address)}" placeholder="Адрес объекта"/>
              </div>
            </div>

            <div class="formrow">
              <div class="field" style="flex:1">
                <label>Дата начала *</label>
                <input id="paStart" type="date" class="inp" value="${app.date_start||''}"/>
              </div>
              <div class="field" style="flex:1">
                <label>Дата окончания</label>
                <input id="paEnd" type="date" class="inp" value="${app.date_end||''}"/>
              </div>
            </div>

            <div class="field">
              <label>Ответственный</label>
              <select id="paResponsible" class="inp">
                <option value="">— Выберите —</option>
                ${activeUsers.map(u => `<option value="${u.id}" ${String(app.responsible_id)===String(u.id)?'selected':''}>${esc(u.name||u.fio||u.login)}</option>`).join('')}
              </select>
            </div>

            <div class="field">
              <label>Сотрудники (участники) *</label>
              <div style="margin-bottom:8px">
                <input id="paEmpSearch" class="inp" placeholder="Поиск сотрудника..." style="margin-bottom:8px"/>
              </div>
              <div id="paEmpList" style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-md);padding:8px">
                ${activeUsers.map(u => {
                  const checked = selectedEmps.has(u.id) || selectedEmps.has(String(u.id));
                  return `<label class="pa-emp-item" style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer" data-name="${esc((u.name||u.fio||u.login||'').toLowerCase())}">
                    <input type="checkbox" value="${u.id}" ${checked?'checked':''} class="paEmpCheck"/>
                    <span>${esc(u.name||u.fio||u.login)}</span>
                    <span style="color:var(--text-muted);font-size:12px;margin-left:auto">${esc(u.role||'')}</span>
                  </label>`;
                }).join('')}
              </div>
              <div id="paEmpCount" style="font-size:12px;color:var(--text-muted);margin-top:4px">Выбрано: ${selectedEmps.size}</div>
            </div>

            <div class="field">
              <label>Описание / дополнительные условия</label>
              <textarea id="paDesc" class="inp" rows="3" placeholder="Описание работ, особые условия...">${esc(app.description)}</textarea>
            </div>

          </div>
          <div class="modal-footer" style="display:flex;gap:12px;justify-content:flex-end;padding:16px">
            <button class="btn ghost btnClose">Отмена</button>
            <button class="btn primary" id="btnSaveApp">Сохранить</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById('permitAppModal');

    modal.querySelectorAll('.btnClose').forEach(b => b.onclick = () => modal.remove());
    modal.onclick = e => { if(e.target === modal) modal.remove(); };

    // Поиск по списку сотрудников
    const searchInput = document.getElementById('paEmpSearch');
    searchInput.oninput = () => {
      const q = searchInput.value.toLowerCase();
      modal.querySelectorAll('.pa-emp-item').forEach(el => {
        el.style.display = el.dataset.name.includes(q) ? '' : 'none';
      });
    };

    // Счётчик выбранных
    const updateCount = () => {
      const cnt = modal.querySelectorAll('.paEmpCheck:checked').length;
      document.getElementById('paEmpCount').textContent = `Выбрано: ${cnt}`;
    };
    modal.querySelectorAll('.paEmpCheck').forEach(cb => cb.onchange = updateCount);

    // Сохранение
    document.getElementById('btnSaveApp').onclick = async () => {
      const workType = document.getElementById('paWorkType').value;
      const dateStart = document.getElementById('paStart').value;
      const employees = Array.from(modal.querySelectorAll('.paEmpCheck:checked')).map(cb => cb.value);

      if(!workType){ AsgardUI.toast('Ошибка','Выберите вид работ','err'); return; }
      if(!dateStart){ AsgardUI.toast('Ошибка','Укажите дату начала','err'); return; }
      if(!employees.length){ AsgardUI.toast('Ошибка','Добавьте хотя бы одного сотрудника','err'); return; }

      const data = {
        ...app,
        work_type: workType,
        object_name: document.getElementById('paObject').value.trim(),
        object_address: document.getElementById('paAddress').value.trim(),
        date_start: dateStart,
        date_end: document.getElementById('paEnd').value || null,
        responsible_id: document.getElementById('paResponsible').value || null,
        employees: employees,
        description: document.getElementById('paDesc').value.trim(),
      };

      await save(data);
      modal.remove();
      AsgardUI.toast('Сохранено', isEdit ? 'Заявка обновлена' : 'Заявка создана', 'ok');
      if(onSave) onSave();
    };
  }

  // ─── Рендер страницы ───────────────────────────────────────────────
  async function render({ layout, title }){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash = '#/login'; return; }

    const user = auth.user;
    const apps = await getAll();
    const users = await AsgardDB.getAll('users') || [];
    const userMap = new Map(users.map(u => [String(u.id), u]));

    const userName = id => {
      const u = userMap.get(String(id));
      return u ? (u.name || u.fio || u.login) : 'ID:'+id;
    };

    // Сортировка по дате (новые сверху)
    apps.sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));

    const counts = {
      all: apps.length,
      pending: apps.filter(a => a.status === 'pending').length,
      approved: apps.filter(a => a.status === 'approved' || a.status === 'active').length,
    };

    const body = `
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <div class="card" style="padding:12px 20px;text-align:center;min-width:100px">
              <div style="font-size:22px;font-weight:800">${counts.all}</div>
              <div class="help">Всего</div>
            </div>
            <div class="card" style="padding:12px 20px;text-align:center;min-width:100px;border-left:3px solid var(--amber)">
              <div style="font-size:22px;font-weight:800;color:var(--amber)">${counts.pending}</div>
              <div class="help">На рассмотрении</div>
            </div>
            <div class="card" style="padding:12px 20px;text-align:center;min-width:100px;border-left:3px solid var(--green)">
              <div style="font-size:22px;font-weight:800;color:var(--green)">${counts.approved}</div>
              <div class="help">Одобрено</div>
            </div>
          </div>
          <button class="btn primary" id="btnNewApp">+ Новая заявка</button>
        </div>

        ${apps.length === 0 ? '<div class="help" style="text-align:center;padding:40px">Заявок пока нет. Нажмите «Новая заявка» для создания.</div>' : `
          <div class="tbl-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Вид работ</th>
                  <th>Объект</th>
                  <th>Даты</th>
                  <th>Сотрудники</th>
                  <th>Статус</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${apps.map(a => `
                  <tr data-id="${a.id}">
                    <td><strong>${esc(a.work_type)}</strong></td>
                    <td>${esc(a.object_name||'—')}<br><span class="help">${esc(a.object_address||'')}</span></td>
                    <td>${fmtDate(a.date_start)}${a.date_end ? ' — '+fmtDate(a.date_end) : ''}</td>
                    <td>
                      ${(a.employees||[]).slice(0,3).map(id => `<span class="badge">${esc(userName(id))}</span>`).join(' ')}
                      ${(a.employees||[]).length > 3 ? `<span class="help">+${a.employees.length-3}</span>` : ''}
                    </td>
                    <td>${statusBadge(a.status)}</td>
                    <td>
                      <div style="display:flex;gap:4px">
                        <button class="btn mini ghost btnEditApp" data-id="${a.id}" title="Редактировать">✏️</button>
                        <button class="btn mini ghost btnDelApp" data-id="${a.id}" title="Удалить">🗑️</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;

    await layout(body, { title: title || 'Заявки на допуск' });

    // Новая заявка
    const btnNew = document.getElementById('btnNewApp');
    if(btnNew) btnNew.onclick = () => openForm(null, () => render({ layout, title }));

    // Редактирование
    document.querySelectorAll('.btnEditApp').forEach(btn => {
      btn.onclick = async () => {
        const app = apps.find(a => a.id === btn.dataset.id);
        if(app) openForm(app, () => render({ layout, title }));
      };
    });

    // Удаление
    document.querySelectorAll('.btnDelApp').forEach(btn => {
      btn.onclick = async () => {
        if(!confirm('Удалить заявку?')) return;
        await remove(btn.dataset.id);
        AsgardUI.toast('Удалено','Заявка удалена','ok');
        render({ layout, title });
      };
    });
  }

  return { render, openForm, getAll, save, remove };
})();
