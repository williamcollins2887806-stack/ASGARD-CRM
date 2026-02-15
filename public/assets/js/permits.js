/**
 * АСГАРД CRM — Разрешения и допуски
 * Этап 32
 */
window.AsgardPermitsPage = (function(){
  
  // 20 стандартных типов разрешений
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
    attest: { name: 'Аттестация', color: '#8b5cf6' }
  };

  // CRUD
  async function getAll() {
    try {
      return await AsgardDB.getAll('employee_permits') || [];
    } catch(e) {
      const data = localStorage.getItem('asgard_employee_permits');
      return data ? JSON.parse(data) : [];
    }
  }

  async function save(permit) {
    try {
      await AsgardDB.put('employee_permits', permit);
    } catch(e) {
      const all = await getAll();
      const idx = all.findIndex(p => p.id === permit.id);
      if (idx >= 0) all[idx] = permit;
      else all.push(permit);
      localStorage.setItem('asgard_employee_permits', JSON.stringify(all));
    }
  }

  async function remove(id) {
    try {
      await AsgardDB.delete('employee_permits', id);
    } catch(e) {
      const all = await getAll();
      localStorage.setItem('asgard_employee_permits', JSON.stringify(all.filter(p => p.id !== id)));
    }
  }

  // Вычислить статус разрешения
  function computeStatus(permit) {
    if (!permit.expiry_date) return { status: 'active', label: 'Действует', color: 'var(--green)' };
    
    const today = new Date();
    const expiry = new Date(permit.expiry_date);
    const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
    
    if (daysLeft < 0) return { status: 'expired', label: 'Истёк', color: 'var(--red)' };
    if (daysLeft <= 30) return { status: 'expiring', label: `Истекает через ${daysLeft} дн.`, color: 'var(--amber)' };
    return { status: 'active', label: 'Действует', color: 'var(--green)' };
  }

  // Получить истекающие разрешения (для уведомлений)
  async function getExpiringPermits(daysAhead = 30) {
    const all = await getAll();
    const today = new Date();
    const threshold = new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    
    return all.filter(p => {
      if (!p.expiry_date) return false;
      const expiry = new Date(p.expiry_date);
      return expiry <= threshold && expiry >= today;
    });
  }

  // Рендер страницы разрешений сотрудника
  async function renderEmployeePermits(employeeId, canEdit = false) {
    const all = await getAll();
    const permits = all.filter(p => p.employee_id === employeeId);
    
    let html = `
      <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <span class="help">Всего: ${permits.length}</span>
        ${canEdit ? `<button class="btn mini" id="btnAddPermit">+ Добавить разрешение</button>` : ''}
      </div>
    `;
    
    if (permits.length === 0) {
      html += '<div class="help">Разрешений не добавлено</div>';
    } else {
      html += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Тип</th><th>Номер</th><th>Выдано</th><th>Действует до</th><th>Статус</th><th></th></tr></thead><tbody>';
      
      permits.forEach(p => {
        const type = PERMIT_TYPES.find(t => t.id === p.type_id) || { name: p.type_id };
        const cat = CATEGORIES[type.category] || { color: '#94a3b8' };
        const status = computeStatus(p);
        
        html += `
          <tr data-id="${p.id}">
            <td><span style="border-left:3px solid ${cat.color};padding-left:8px">${esc(type.name)}</span></td>
            <td>${esc(p.doc_number || '—')}</td>
            <td>${p.issue_date ? formatDate(p.issue_date) : '—'}</td>
            <td>${p.expiry_date ? formatDate(p.expiry_date) : 'Бессрочно'}</td>
            <td><span class="badge" style="background:${status.color}20;color:${status.color}">${status.label}</span></td>
            <td>
              ${canEdit ? `
                <div style="display:flex;gap:4px">
                  <button class="btn mini ghost btnEditPermit">✏️</button>
                  <button class="btn mini ghost btnDelPermit">🗑️</button>
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

  // Модалка добавления/редактирования
  async function openPermitModal(employeeId, permit = null, onSave = null) {
    const isEdit = !!permit;
    const employees = await AsgardDB.getAll('employees') || [];
    const emp = employees.find(e => e.id === employeeId);
    
    const html = `
      <div class="modal-overlay" id="permitModal">
        <div class="modal-content" style="max-width:500px">
          <div class="modal-header">
            <h3>${isEdit ? 'Редактирование' : 'Новое разрешение'}</h3>
            <button class="btn ghost btnClose">✕</button>
          </div>
          <div class="modal-body">
            <p style="margin-bottom:16px">Сотрудник: <strong>${esc(emp?.fio || 'ID:' + employeeId)}</strong></p>
            
            <div class="field">
              <label>Тип разрешения *</label>
              <select id="permitType" class="inp">
                <option value="">— Выберите —</option>
                ${Object.entries(CATEGORIES).map(([catId, cat]) => `
                  <optgroup label="${cat.name}">
                    ${PERMIT_TYPES.filter(t => t.category === catId).map(t => `
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
                <input id="permitIssue" type="date" class="inp" value="${permit?.issue_date || ''}"/>
              </div>
              <div>
                <label>Действует до</label>
                <input id="permitExpiry" type="date" class="inp" value="${permit?.expiry_date || ''}"/>
              </div>
            </div>
            
            <div class="field" style="margin-top:12px">
              <label>Ссылка на скан</label>
              <input id="permitFile" class="inp" placeholder="https://..." value="${esc(permit?.file_url || '')}"/>
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
      
      const data = {
        id: permit?.id || undefined,
        employee_id: employeeId,
        type_id: typeId,
        doc_number: document.getElementById('permitNum').value.trim(),
        issuer: document.getElementById('permitIssuer').value.trim(),
        issue_date: document.getElementById('permitIssue').value || null,
        expiry_date: document.getElementById('permitExpiry').value || null,
        file_url: document.getElementById('permitFile').value.trim(),
        created_at: permit?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      await save(data);
      modal.remove();
      AsgardUI.toast('Сохранено', isEdit ? 'Разрешение обновлено' : 'Разрешение добавлено', 'ok');
      if (onSave) onSave();
    };
  }

  // Рендер сводного отчёта
  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = "#/login"; return; }
    
    const user = auth.user;
    const allowedRoles = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HR', 'TO'];
    if (!allowedRoles.includes(user.role)) {
      AsgardUI.toast('Доступ', 'Недостаточно прав', 'err');
      location.hash = '#/home';
      return;
    }

    const permits = await getAll();
    const employees = await AsgardDB.getAll('employees') || [];
    const empMap = new Map(employees.map(e => [e.id, e]));
    
    // Группировка по статусу
    const expired = [];
    const expiring = [];
    const active = [];
    
    permits.forEach(p => {
      const status = computeStatus(p);
      p._status = status;
      p._employee = empMap.get(p.employee_id);
      if (status.status === 'expired') expired.push(p);
      else if (status.status === 'expiring') expiring.push(p);
      else active.push(p);
    });

    const renderTable = (list, showEmployee = true) => {
      if (!list.length) return '<div class="asg-empty"><div class="asg-empty-icon">📭</div><div class="asg-empty-text">Нет данных</div></div>';
      return `
        <table class="tbl">
          <thead><tr>${showEmployee ? '<th>Сотрудник</th>' : ''}<th>Тип</th><th>Действует до</th><th>Статус</th></tr></thead>
          <tbody>
            ${list.map(p => {
              const type = PERMIT_TYPES.find(t => t.id === p.type_id) || { name: p.type_id };
              return `
                <tr>
                  ${showEmployee ? `<td>${esc(p._employee?.fio || '—')}</td>` : ''}
                  <td>${esc(type.name)}</td>
                  <td>${p.expiry_date ? formatDate(p.expiry_date) : '—'}</td>
                  <td><span class="badge" style="background:${p._status.color}20;color:${p._status.color}">${p._status.label}</span></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    };

    const html = `
      <div class="panel">
        <div class="row" style="gap:16px;flex-wrap:wrap;margin-bottom:16px">
          <div class="card" style="flex:1;min-width:150px;text-align:center;padding:16px;border-left:4px solid var(--red)">
            <div style="font-size:24px;font-weight:bold">${expired.length}</div>
            <div class="help">Истекли</div>
          </div>
          <div class="card" style="flex:1;min-width:150px;text-align:center;padding:16px;border-left:4px solid var(--amber)">
            <div style="font-size:24px;font-weight:bold">${expiring.length}</div>
            <div class="help">Истекают (30 дн.)</div>
          </div>
          <div class="card" style="flex:1;min-width:150px;text-align:center;padding:16px;border-left:4px solid var(--green)">
            <div style="font-size:24px;font-weight:bold">${active.length}</div>
            <div class="help">Действуют</div>
          </div>
        </div>

        ${expired.length > 0 ? `
          <details open style="margin-bottom:16px">
            <summary class="kpi" style="cursor:pointer;color:var(--red)"><span class="dot" style="background:var(--red)"></span> Истёкшие (${expired.length})</summary>
            <div class="tbl-wrap" style="margin-top:12px">${renderTable(expired)}</div>
          </details>
        ` : ''}

        ${expiring.length > 0 ? `
          <details open style="margin-bottom:16px">
            <summary class="kpi" style="cursor:pointer;color:var(--amber)"><span class="dot" style="background:var(--amber)"></span> Истекают скоро (${expiring.length})</summary>
            <div class="tbl-wrap" style="margin-top:12px">${renderTable(expiring)}</div>
          </details>
        ` : ''}

        <details>
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:var(--green)"></span> Все действующие (${active.length})</summary>
          <div class="tbl-wrap" style="margin-top:12px">${renderTable(active)}</div>
        </details>
      </div>
    `;

    await layout(html, { title: title || 'Разрешения и допуски' });
  }

  // Проверка уведомлений (вызывается из SLA)
  async function checkAndNotify() {
    const expiring = await getExpiringPermits(30);
    const employees = await AsgardDB.getAll('employees') || [];
    const empMap = new Map(employees.map(e => [e.id, e]));
    
    for (const p of expiring) {
      const emp = empMap.get(p.employee_id);
      const type = PERMIT_TYPES.find(t => t.id === p.type_id) || { name: p.type_id };
      const daysLeft = Math.ceil((new Date(p.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
      
      // Уведомление TO и HR
      const users = await AsgardDB.getAll('users') || [];
      const toNotify = users.filter(u => u.role === 'TO' || u.role === 'HR');
      
      for (const u of toNotify) {
        const key = `permit_notify_${p.id}_${daysLeft <= 14 ? '14' : '30'}`;
        const existing = await AsgardDB.get('notifications', key);
        if (!existing) {
          await AsgardDB.put('notifications', {
            id: key,
            user_id: u.id,
            title: 'Истекает разрешение',
            message: `У сотрудника ${emp?.fio || 'ID:' + p.employee_id} истекает "${type.name}" через ${daysLeft} дн.`,
            type: 'permit_expiry',
            entity_id: p.id,
            is_read: false,
            created_at: new Date().toISOString()
          });
        }
      }
    }
  }

  // Helpers
  function esc(s) { return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function formatDate(d) { return d ? new Date(d).toLocaleDateString('ru-RU') : ''; }

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
