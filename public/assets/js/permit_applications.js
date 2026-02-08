/**
 * АСГАРД CRM — Заявки на оформление разрешений
 * Требования маршрутной карты: №38, №39, №40
 *
 * Зависимости: AsgardUI, AsgardAuth, AsgardDB
 */
window.AsgardPermitApplications = (function(){
  const { $, $$, esc, toast, formatDate } = AsgardUI;

  const ALLOWED_ROLES = ['ADMIN','HR','TO','HEAD_TO','HR_MANAGER','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'];

  const STATUSES = {
    draft:       { name: 'Черновик',    color: 'var(--text-muted)',  bg: 'rgba(100,116,139,0.15)', icon: '' },
    sent:        { name: 'Отправлена',  color: 'var(--blue)',        bg: 'var(--blue-glow)',        icon: '' },
    in_progress: { name: 'В работе',    color: 'var(--amber)',       bg: 'var(--amber-glow)',       icon: '' },
    completed:   { name: 'Завершена',   color: 'var(--green)',       bg: 'var(--green-glow)',       icon: '' },
    cancelled:   { name: 'Отменена',    color: 'var(--red)',         bg: 'var(--red-glow)',         icon: '' }
  };

  const CATEGORIES = {
    safety:    { name: 'Безопасность',    color: '#22c55e' },
    electric:  { name: 'Электрика',       color: '#f59e0b' },
    special:   { name: 'Спецработы',      color: '#3b82f6' },
    medical:   { name: 'Медицина',        color: '#ef4444' },
    attest:    { name: 'Аттестация',      color: '#8b5cf6' },
    offshore:  { name: 'Шельф / Морские', color: '#06b6d4' },
    gas:       { name: 'Газоопасные',     color: '#f97316' },
    transport: { name: 'Транспорт',       color: '#64748b' }
  };

  const PRESETS = {
    basic:     { name: 'Базовый',      codes: ['height_1','fire','labor','first_aid','medical','psych'] },
    offshore:  { name: 'Шельф / МЛСП', codes: ['height_1','fire','labor','first_aid','medical','psych','bosiet','offshore_med','confined','gas_hazard','ice_class','helicopter'] },
    gas:       { name: 'Газоопасные',   codes: ['gas_hazard','gas_analyzer','h2s_safety','confined'] },
    electric:  { name: 'Электрика',     codes: ['electro_2','electro_3','electro_4'] },
    welding:   { name: 'Сварка',        codes: ['welder','attest_a1','fire','labor','medical','first_aid'] }
  };

  // State for form
  let formState = {
    id: null,
    contractor_name: '',
    contractor_email: '',
    title: '',
    cover_letter: null,
    items: []
  };

  let permitTypes = []; // cached from server
  let allEmployees = []; // cached from server

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════
  async function apiFetch(url, options = {}) {
    const auth = await AsgardAuth.getAuth();
    const headers = {
      'Authorization': 'Bearer ' + (auth?.token || '')
    };
    if (options.body && !options.blob) headers['Content-Type'] = 'application/json';
    const resp = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Ошибка сервера' }));
      throw new Error(err.error || 'Ошибка запроса');
    }
    if (options.blob) return resp.blob();
    return resp.json();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function shortPermitName(name) {
    return name
      .replace('Допуск к работам на ', '')
      .replace('Электробезопасность ', 'Электро ')
      .replace('Аттестация промбезопасность ', 'Пром.безоп. ')
      .replace(' (периодический)', '')
      .replace('Медицинский осмотр', 'Медосмотр');
  }

  function statusBadge(status) {
    const s = STATUSES[status] || STATUSES.draft;
    return `<span class="badge" style="background:${s.bg};color:${s.color};font-size:11px">${s.icon} ${s.name}</span>`;
  }

  async function loadPermitTypes() {
    if (permitTypes.length > 0) return;
    try {
      const data = await apiFetch('/api/permit-applications/types');
      permitTypes = data.types || [];
    } catch(e) {
      console.warn('[PermitApp] Failed to load types:', e.message);
    }
  }

  async function loadEmployees() {
    if (allEmployees.length > 0) return;
    try {
      const emps = await AsgardDB.getAll('employees');
      allEmployees = (emps || []).filter(e => e.status !== 'fired');
    } catch(e) {
      console.warn('[PermitApp] Failed to load employees:', e.message);
    }
  }

  function getPermitStatus(existingPermits, typeCode) {
    const permit = (existingPermits || []).find(p => p.type_id === typeCode || p.type_code === typeCode);
    if (!permit) return { status: 'none' };
    if (!permit.expiry_date) return { status: 'active', date: null, label: 'Бессрочное' };
    const expiry = new Date(permit.expiry_date);
    const today = new Date();
    const daysLeft = Math.ceil((expiry - today) / (1000*60*60*24));
    if (daysLeft < 0) return { status: 'expired', date: permit.expiry_date, label: 'Истёк ' + formatDate(permit.expiry_date) };
    if (daysLeft <= 60) return { status: 'expiring', date: permit.expiry_date, label: 'Истекает ' + formatDate(permit.expiry_date) };
    return { status: 'active', date: permit.expiry_date, label: 'Есть до ' + formatDate(permit.expiry_date) };
  }

  let _debounceTimer = null;
  function debounce(fn, ms) {
    return function() {
      clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => fn.apply(this, arguments), ms);
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER: Главная страница списка заявок
  // ═══════════════════════════════════════════════════════════════
  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = "#/login"; return; }
    const user = auth.user;

    if (!ALLOWED_ROLES.includes(user.role) && user.role !== 'ADMIN') {
      toast("Доступ","Недостаточно прав","err");
      location.hash = "#/home";
      return;
    }

    let currentStatus = '';
    let currentSearch = '';

    async function loadAndRender() {
      const params = new URLSearchParams();
      if (currentStatus) params.set('status', currentStatus);
      if (currentSearch) params.set('search', currentSearch);

      let data;
      try {
        data = await apiFetch('/api/permit-applications?' + params.toString());
      } catch(e) {
        toast('Ошибка', e.message, 'err');
        return;
      }

      const apps = data.applications || [];
      const total = data.total || 0;

      // Count by status
      let countAll = total;
      const counts = { draft: 0, sent: 0, in_progress: 0, completed: 0, cancelled: 0 };
      // We need all-status counts, fetch separately for stats
      try {
        const allData = await apiFetch('/api/permit-applications?limit=1');
        // Actually count per-status
        for (const st of Object.keys(counts)) {
          const stData = await apiFetch('/api/permit-applications?status=' + st + '&limit=1');
          counts[st] = stData.total || 0;
        }
        countAll = Object.values(counts).reduce((a,b) => a+b, 0);
      } catch(e) { /* use what we have */ }

      // Build table rows
      const canCreate = ['ADMIN','HR','TO','HEAD_TO','HR_MANAGER'].includes(user.role);
      let rows = '';
      if (apps.length === 0) {
        rows = `<tr><td colspan="7" style="text-align:center;padding:40px">
          <div style="font-size:36px;margin-bottom:12px">&#128203;</div>
          <div style="font-size:14px;font-weight:600;margin-bottom:8px">Заявок пока нет</div>
          <div class="help" style="margin-bottom:16px">Создайте первую заявку на оформление разрешений</div>
          ${canCreate ? '<button class="btn primary" id="btnNewAppEmpty">+ Новая заявка</button>' : ''}
        </td></tr>`;
      } else {
        rows = apps.map(a => {
          let actions = '';
          if (a.status === 'draft') {
            if (canCreate) actions += `<button class="btn mini ghost btnEdit" data-id="${a.id}" title="Редактировать">&#9998;</button>`;
            actions += `<button class="btn mini ghost btnExcel" data-id="${a.id}" data-num="${esc(a.number||'')}" title="Excel">&#128229;</button>`;
            if (canCreate) actions += `<button class="btn mini ghost btnSend" data-id="${a.id}" title="Отправить">&#9993;</button>`;
            if (canCreate) actions += `<button class="btn mini ghost btnDelete" data-id="${a.id}" data-num="${esc(a.number||'')}" title="Удалить">&#128465;</button>`;
          } else if (a.status === 'sent') {
            actions += `<button class="btn mini ghost btnView" data-id="${a.id}" title="Просмотр">&#128065;</button>`;
            actions += `<button class="btn mini ghost btnExcel" data-id="${a.id}" data-num="${esc(a.number||'')}" title="Excel">&#128229;</button>`;
            if (canCreate) actions += `<button class="btn mini ghost btnStatus" data-id="${a.id}" data-status="in_progress" title="В работу">&#9881;</button>`;
          } else if (a.status === 'in_progress') {
            actions += `<button class="btn mini ghost btnView" data-id="${a.id}" title="Просмотр">&#128065;</button>`;
            actions += `<button class="btn mini ghost btnExcel" data-id="${a.id}" data-num="${esc(a.number||'')}" title="Excel">&#128229;</button>`;
            if (canCreate) actions += `<button class="btn mini ghost btnStatus" data-id="${a.id}" data-status="completed" title="Завершить">&#10004;</button>`;
          } else if (a.status === 'completed') {
            actions += `<button class="btn mini ghost btnView" data-id="${a.id}" title="Просмотр">&#128065;</button>`;
            actions += `<button class="btn mini ghost btnExcel" data-id="${a.id}" data-num="${esc(a.number||'')}" title="Excel">&#128229;</button>`;
          } else {
            actions += `<button class="btn mini ghost btnView" data-id="${a.id}" title="Просмотр">&#128065;</button>`;
          }

          return `<tr>
            <td style="font-weight:600">${esc(a.number || 'черновик')}</td>
            <td>${esc(a.contractor_name || '—')}<br><span class="help" style="font-size:11px">${esc(a.title||'')}</span></td>
            <td style="text-align:center">${a.employee_count || 0}</td>
            <td style="text-align:center">${a.permit_count || 0}</td>
            <td>${statusBadge(a.status)}</td>
            <td>${formatDate(a.sent_at || a.created_at)}</td>
            <td style="text-align:right;white-space:nowrap">${actions}</td>
          </tr>`;
        }).join('');
      }

      const body = `
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <div>
            <div class="help">Управление заявками на оформление разрешений и допусков для подрядчиков</div>
          </div>
          ${canCreate ? '<button class="btn primary" id="btnNewApp">+ Новая заявка</button>' : ''}
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px">
          <div class="card" style="text-align:center;padding:16px;border-left:4px solid var(--text-muted)">
            <div style="font-size:24px;font-weight:bold">${counts.draft}</div>
            <div class="help">Черновики</div>
          </div>
          <div class="card" style="text-align:center;padding:16px;border-left:4px solid var(--blue)">
            <div style="font-size:24px;font-weight:bold">${counts.sent}</div>
            <div class="help">Отправлены</div>
          </div>
          <div class="card" style="text-align:center;padding:16px;border-left:4px solid var(--amber)">
            <div style="font-size:24px;font-weight:bold">${counts.in_progress}</div>
            <div class="help">В работе</div>
          </div>
          <div class="card" style="text-align:center;padding:16px;border-left:4px solid var(--green)">
            <div style="font-size:24px;font-weight:bold">${counts.completed}</div>
            <div class="help">Завершены</div>
          </div>
        </div>

        <div class="tabs" id="statusTabs" style="margin-bottom:16px">
          <button class="tab ${currentStatus===''?'active':''}" data-status="">Все (${countAll})</button>
          <button class="tab ${currentStatus==='draft'?'active':''}" data-status="draft">Черновики (${counts.draft})</button>
          <button class="tab ${currentStatus==='sent'?'active':''}" data-status="sent">Отправлены (${counts.sent})</button>
          <button class="tab ${currentStatus==='in_progress'?'active':''}" data-status="in_progress">В работе (${counts.in_progress})</button>
          <button class="tab ${currentStatus==='completed'?'active':''}" data-status="completed">Завершены (${counts.completed})</button>
        </div>

        <div class="filters" style="margin-bottom:16px">
          <input id="searchInput" class="inp" placeholder="Поиск по номеру, подрядчику..." style="flex:1;min-width:250px" value="${esc(currentSearch)}"/>
        </div>

        <div style="overflow-x:auto">
          <table class="asg" id="appTable">
            <thead><tr>
              <th style="width:120px">&#8470; заявки</th>
              <th>Подрядчик</th>
              <th style="width:70px;text-align:center">Сотр.</th>
              <th style="width:70px;text-align:center">Разр.</th>
              <th style="width:120px">Статус</th>
              <th style="width:120px">Дата</th>
              <th style="width:170px;text-align:right">Действия</th>
            </tr></thead>
            <tbody id="appTableBody">${rows}</tbody>
          </table>
        </div>

        <div class="help" style="margin-top:12px">Показано ${apps.length} из ${total}</div>
      </div>
      `;

      await layout(body, { title: title || 'Заявки на оформление разрешений' });

      // Event handlers
      const btnNew = $('#btnNewApp') || $('#btnNewAppEmpty');
      if (btnNew) btnNew.onclick = () => { location.hash = '#/permit-application-form'; };

      const searchInput = $('#searchInput');
      if (searchInput) {
        searchInput.oninput = debounce(() => {
          currentSearch = searchInput.value.trim();
          loadAndRender();
        }, 400);
      }

      document.querySelectorAll('#statusTabs .tab').forEach(tab => {
        tab.onclick = () => {
          currentStatus = tab.dataset.status;
          loadAndRender();
        };
      });

      // Table action handlers
      document.querySelectorAll('.btnEdit').forEach(b => {
        b.onclick = () => { location.hash = '#/permit-application-form?id=' + b.dataset.id; };
      });

      document.querySelectorAll('.btnView').forEach(b => {
        b.onclick = () => openViewModal(b.dataset.id);
      });

      document.querySelectorAll('.btnExcel').forEach(b => {
        b.onclick = async () => {
          try {
            const blob = await apiFetch('/api/permit-applications/' + b.dataset.id + '/excel', { blob: true });
            downloadBlob(blob, (b.dataset.num || 'draft') + '_реестр.xlsx');
          } catch(e) { toast('Ошибка', e.message, 'err'); }
        };
      });

      document.querySelectorAll('.btnSend').forEach(b => {
        b.onclick = async () => {
          try {
            const data = await apiFetch('/api/permit-applications/' + b.dataset.id);
            openSendConfirmModal(data.application, async () => { await loadAndRender(); });
          } catch(e) { toast('Ошибка', e.message, 'err'); }
        };
      });

      document.querySelectorAll('.btnDelete').forEach(b => {
        b.onclick = async () => {
          if (!confirm('Удалить заявку ' + (b.dataset.num || '') + '?')) return;
          try {
            await apiFetch('/api/permit-applications/' + b.dataset.id, { method: 'DELETE' });
            toast('Готово', 'Заявка удалена', 'ok');
            await loadAndRender();
          } catch(e) { toast('Ошибка', e.message, 'err'); }
        };
      });

      document.querySelectorAll('.btnStatus').forEach(b => {
        b.onclick = async () => {
          const newStatus = b.dataset.status;
          const labels = { in_progress: 'В работу', completed: 'Завершить' };
          if (!confirm((labels[newStatus] || newStatus) + '?')) return;
          try {
            await apiFetch('/api/permit-applications/' + b.dataset.id + '/status', {
              method: 'POST', body: { status: newStatus }
            });
            toast('Готово', 'Статус обновлён', 'ok');
            await loadAndRender();
          } catch(e) { toast('Ошибка', e.message, 'err'); }
        };
      });
    }

    loadAndRender();
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER: Форма создания/редактирования
  // ═══════════════════════════════════════════════════════════════
  async function renderForm({ layout, title, query }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = "#/login"; return; }
    const user = auth.user;

    if (!ALLOWED_ROLES.includes(user.role) && user.role !== 'ADMIN') {
      toast("Доступ","Недостаточно прав","err");
      location.hash = "#/home";
      return;
    }

    await loadPermitTypes();
    await loadEmployees();

    const isEdit = !!(query && query.id);
    let app = null;

    // Reset form state
    formState = { id: null, contractor_name: '', contractor_email: '', title: '', cover_letter: null, items: [] };

    if (isEdit) {
      try {
        const data = await apiFetch('/api/permit-applications/' + query.id);
        app = data.application;
        if (app.status !== 'draft') {
          toast('Ошибка', 'Редактировать можно только черновик', 'err');
          location.hash = '#/permit-applications';
          return;
        }
        formState.id = app.id;
        formState.contractor_name = app.contractor_name || '';
        formState.contractor_email = app.contractor_email || '';
        formState.title = app.title || '';
        formState.cover_letter = app.cover_letter;
        formState.items = (data.items || []).map(item => ({
          employee_id: item.employee_id,
          employee: {
            id: item.employee_id,
            fio: item.employee_fio || '',
            role_tag: item.employee_role_tag || '',
            phone: item.employee_phone || ''
          },
          permit_type_ids: item.permit_type_ids || [],
          existing_permits: item.existing_permits || [],
          notes: item.notes || ''
        }));
      } catch(e) {
        toast('Ошибка', e.message, 'err');
        location.hash = '#/permit-applications';
        return;
      }
    }

    // Load cover letter template if not set
    let coverTemplate = '';
    try {
      const sRes = await AsgardDB.getAll('settings');
      const tpl = (sRes || []).find(s => s.key === 'permit_cover_letter_template');
      if (tpl) {
        const parsed = JSON.parse(tpl.value_json);
        coverTemplate = parsed.body || '';
      }
    } catch(e) { /* ignore */ }

    function renderEmployeesTable() {
      if (formState.items.length === 0) {
        return '<div class="help" style="text-align:center;padding:40px">Нажмите &laquo;+ Добавить сотрудников&raquo; чтобы начать</div>';
      }

      const rows = formState.items.map(item => {
        const emp = item.employee || {};
        const badges = (item.permit_type_ids || []).map(tid => {
          const pt = permitTypes.find(t => t.id === tid);
          if (!pt) return '';
          const cat = CATEGORIES[pt.category] || { color: '#888' };
          return `<span class="badge" style="background:${cat.color}20;color:${cat.color};font-size:11px;padding:3px 8px">${shortPermitName(pt.name)}</span>`;
        }).join('');

        return `<tr>
          <td><button class="btn mini ghost btnRemoveEmp" data-emp-id="${emp.id}" title="Убрать">&#10005;</button></td>
          <td style="font-weight:600">${esc(emp.fio || 'Сотрудник #' + item.employee_id)}</td>
          <td><span class="badge">${esc(emp.role_tag || '')}</span></td>
          <td>
            <div style="display:flex;flex-wrap:wrap;gap:4px">
              ${badges || '<span class="help">нет разрешений</span>'}
              <button class="btn mini ghost btnEditPermits" data-emp-id="${emp.id}" style="padding:2px 8px;font-size:11px">+ ещё</button>
            </div>
          </td>
          <td><input class="inp empNotes" data-emp-id="${emp.id}" value="${esc(item.notes||'')}" placeholder="..." style="padding:6px 8px;font-size:12px"/></td>
        </tr>`;
      }).join('');

      return `<table class="asg"><thead><tr>
        <th style="width:40px"></th>
        <th>ФИО</th>
        <th style="width:130px">Должность</th>
        <th>Разрешения</th>
        <th style="width:150px">Примечания</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
    }

    function updateSummary() {
      const empCount = formState.items.length;
      const permCount = formState.items.reduce((s, i) => s + (i.permit_type_ids || []).length, 0);
      const el = $('#formSummary');
      if (el) el.textContent = 'Сотрудников: ' + empCount + ', разрешений: ' + permCount;
    }

    function refreshTable() {
      const wrap = $('#employeesTableWrap');
      if (wrap) wrap.innerHTML = renderEmployeesTable();
      updateSummary();
      attachTableHandlers();
    }

    function attachTableHandlers() {
      document.querySelectorAll('.btnRemoveEmp').forEach(b => {
        b.onclick = () => {
          formState.items = formState.items.filter(i => String(i.employee_id) !== b.dataset.empId);
          refreshTable();
        };
      });

      document.querySelectorAll('.btnEditPermits').forEach(b => {
        b.onclick = () => {
          const empId = parseInt(b.dataset.empId);
          const item = formState.items.find(i => i.employee_id === empId);
          if (!item) return;
          openPermitSelectModal(empId, item.permit_type_ids, item.existing_permits || [], (newIds) => {
            item.permit_type_ids = newIds;
            refreshTable();
          });
        };
      });

      document.querySelectorAll('.empNotes').forEach(inp => {
        inp.onchange = () => {
          const empId = parseInt(inp.dataset.empId);
          const item = formState.items.find(i => i.employee_id === empId);
          if (item) item.notes = inp.value;
        };
      });
    }

    const body = `
    <div class="panel">
      <div style="margin-bottom:20px">
        <a href="#/permit-applications" class="btn ghost" style="padding:8px 14px">&larr; Назад к списку</a>
        <span style="margin-left:12px;font-size:18px;font-weight:700">
          ${isEdit ? 'Редактирование: ' + esc(app?.number || '') : 'Новая заявка на оформление'}
        </span>
      </div>

      <div class="card" style="margin-bottom:20px;padding:20px">
        <h3 style="margin-bottom:12px">Подрядчик</h3>
        <div class="formrow" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div>
            <label>Компания-подрядчик *</label>
            <input id="fContractorName" class="inp" placeholder="ООО Центр Безопасности" list="contractorList" autocomplete="off" value="${esc(formState.contractor_name)}"/>
            <datalist id="contractorList"></datalist>
          </div>
          <div>
            <label>Email подрядчика *</label>
            <input id="fContractorEmail" class="inp" type="email" placeholder="permits@company.ru" value="${esc(formState.contractor_email)}"/>
          </div>
        </div>
        <div style="margin-top:12px">
          <label>Комментарий</label>
          <input id="fTitle" class="inp" placeholder="Описание заявки (необязательно)" value="${esc(formState.title)}"/>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3>Сотрудники и разрешения</h3>
          <button class="btn" id="btnAddEmployees">+ Добавить сотрудников</button>
        </div>
        <div id="employeesTableWrap">${renderEmployeesTable()}</div>
      </div>

      <details class="card" style="margin-bottom:20px;padding:0">
        <summary style="cursor:pointer;padding:16px;font-weight:600">
          Сопроводительное письмо (нажмите для редактирования)
        </summary>
        <div style="padding:0 20px 20px">
          <textarea id="fCoverLetter" class="inp" rows="10" style="font-family:var(--font-mono);font-size:13px">${esc(formState.cover_letter || coverTemplate)}</textarea>
          <button class="btn ghost mini" id="btnResetLetter" style="margin-top:8px">Сбросить к шаблону</button>
        </div>
      </details>

      <div style="position:sticky;bottom:0;background:var(--bg-card);border-top:1px solid var(--border);padding:16px;display:flex;align-items:center;justify-content:space-between;border-radius:0 0 var(--radius-lg) var(--radius-lg);z-index:10">
        <div id="formSummary" style="font-size:14px;color:var(--text-secondary)">
          Сотрудников: ${formState.items.length}, разрешений: ${formState.items.reduce((s,i)=>s+(i.permit_type_ids||[]).length,0)}
        </div>
        <div style="display:flex;gap:12px">
          <button class="btn ghost" id="btnSaveDraft">Сохранить черновик</button>
          <button class="btn" id="btnDownloadExcel">Скачать Excel</button>
          <button class="btn primary" id="btnSendEmail">Отправить подрядчику</button>
        </div>
      </div>
    </div>
    `;

    await layout(body, { title: title || 'Заявка на оформление' });
    attachTableHandlers();

    // Contractor autocomplete
    const nameInput = $('#fContractorName');
    const emailInput = $('#fContractorEmail');
    if (nameInput) {
      nameInput.oninput = debounce(async () => {
        const val = nameInput.value.trim();
        if (val.length < 2) return;
        try {
          const data = await apiFetch('/api/permit-applications/contractors?search=' + encodeURIComponent(val));
          const dl = $('#contractorList');
          if (dl) {
            dl.innerHTML = (data.contractors || []).map(c =>
              `<option value="${esc(c.name)}" data-email="${esc(c.email||'')}">`
            ).join('');
          }
        } catch(e) { /* ignore */ }
      }, 300);

      nameInput.addEventListener('change', () => {
        const dl = $('#contractorList');
        if (!dl) return;
        const opt = dl.querySelector('option[value="' + CSS.escape(nameInput.value) + '"]');
        if (opt && opt.dataset.email && emailInput) {
          emailInput.value = opt.dataset.email;
        }
      });
    }

    // Reset letter
    const btnReset = $('#btnResetLetter');
    if (btnReset) btnReset.onclick = () => {
      const ta = $('#fCoverLetter');
      if (ta) ta.value = coverTemplate;
    };

    // Add employees
    const btnAdd = $('#btnAddEmployees');
    if (btnAdd) btnAdd.onclick = () => {
      const alreadyIds = formState.items.map(i => i.employee_id);
      openEmployeeSelectModal(alreadyIds, (selectedEmps) => {
        for (const emp of selectedEmps) {
          if (!formState.items.find(i => i.employee_id === emp.id)) {
            formState.items.push({
              employee_id: emp.id,
              employee: emp,
              permit_type_ids: [],
              existing_permits: [],
              notes: ''
            });
          }
        }
        refreshTable();
      });
    };

    // Save draft
    const btnSave = $('#btnSaveDraft');
    if (btnSave) btnSave.onclick = async () => {
      const cn = ($('#fContractorName') || {}).value || '';
      const ce = ($('#fContractorEmail') || {}).value || '';
      const tt = ($('#fTitle') || {}).value || '';
      const cl = ($('#fCoverLetter') || {}).value || '';

      if (!cn || cn.trim().length < 2) { toast('Ошибка', 'Укажите подрядчика', 'err'); return; }
      if (formState.items.length === 0) { toast('Ошибка', 'Добавьте сотрудников', 'err'); return; }

      const hasEmpty = formState.items.some(i => !i.permit_type_ids || i.permit_type_ids.length === 0);
      if (hasEmpty) { toast('Ошибка', 'Для всех сотрудников выберите разрешения', 'err'); return; }

      const payload = {
        title: tt,
        contractor_name: cn.trim(),
        contractor_email: ce.trim(),
        cover_letter: cl || null,
        items: formState.items.map(i => ({
          employee_id: i.employee_id,
          permit_type_ids: i.permit_type_ids,
          notes: i.notes || ''
        }))
      };

      try {
        if (formState.id) {
          await apiFetch('/api/permit-applications/' + formState.id, { method: 'PUT', body: payload });
          toast('Готово', 'Заявка обновлена', 'ok');
        } else {
          const data = await apiFetch('/api/permit-applications', { method: 'POST', body: payload });
          formState.id = data.application.id;
          toast('Готово', 'Заявка создана: ' + (data.application.number || ''), 'ok');
        }
      } catch(e) { toast('Ошибка', e.message, 'err'); }
    };

    // Download Excel (need to save first)
    const btnExcel = $('#btnDownloadExcel');
    if (btnExcel) btnExcel.onclick = async () => {
      if (!formState.id) { toast('Внимание', 'Сначала сохраните заявку', 'err'); return; }
      try {
        const blob = await apiFetch('/api/permit-applications/' + formState.id + '/excel', { blob: true });
        downloadBlob(blob, 'реестр.xlsx');
      } catch(e) { toast('Ошибка', e.message, 'err'); }
    };

    // Send email
    const btnSend = $('#btnSendEmail');
    if (btnSend) btnSend.onclick = async () => {
      // Save first
      if (btnSave) await btnSave.onclick();
      if (!formState.id) return;

      try {
        const data = await apiFetch('/api/permit-applications/' + formState.id);
        openSendConfirmModal(data.application, () => {
          location.hash = '#/permit-applications';
        });
      } catch(e) { toast('Ошибка', e.message, 'err'); }
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // МОДАЛКА: Выбор сотрудников
  // ═══════════════════════════════════════════════════════════════
  function openEmployeeSelectModal(alreadySelected, onConfirm) {
    const selected = new Set(alreadySelected.map(String));

    // Get unique role_tags for filter
    const roleTags = [...new Set(allEmployees.map(e => e.role_tag).filter(Boolean))].sort();

    function renderEmpList(filter, search) {
      let filtered = allEmployees;
      if (filter) filtered = filtered.filter(e => e.role_tag === filter);
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(e => (e.fio || e.full_name || '').toLowerCase().includes(q));
      }

      return filtered.map(e => {
        const checked = selected.has(String(e.id)) ? 'checked' : '';
        const highlight = checked ? 'background:var(--primary-glow);' : '';
        return `<label style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--radius-sm);cursor:pointer;${highlight}"
                 onmouseover="this.style.background=this.style.background||'var(--bg-hover)'" onmouseout="this.style.background='${checked?'var(--primary-glow)':''}'" >
          <input type="checkbox" class="empCheck" data-id="${e.id}" ${checked}/>
          <div style="flex:1">
            <div style="font-weight:600">${esc(e.fio || e.full_name || 'ID:' + e.id)}</div>
            <div class="help" style="font-size:11px">${esc(e.role_tag||'')}${e.phone ? ' &middot; ' + esc(e.phone) : ''}</div>
          </div>
        </label>`;
      }).join('');
    }

    const filterOpts = roleTags.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');

    const html = `
    <div class="modal-overlay" id="empSelectModal">
      <div class="modal-content" style="max-width:800px">
        <div class="modal-header">
          <h3>Выбрать сотрудников</h3>
          <button class="btn ghost btnClose">&times;</button>
        </div>
        <div class="modal-body" style="max-height:65vh;overflow-y:auto">
          <div style="display:flex;gap:12px;margin-bottom:16px">
            <input id="empSearch" class="inp" placeholder="Поиск по ФИО..." style="flex:1"/>
            <select id="empFilter" class="inp" style="width:200px">
              <option value="">Все должности</option>
              ${filterOpts}
            </select>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <button class="btn mini ghost" id="empSelectAll">Выбрать всех</button>
            <button class="btn mini ghost" id="empDeselectAll">Снять все</button>
          </div>
          <div id="empList">${renderEmpList('', '')}</div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:space-between;align-items:center;padding:16px">
          <span class="help" id="empSelectedCount">Выбрано: ${selected.size}</span>
          <div style="display:flex;gap:12px">
            <button class="btn ghost btnClose">Отмена</button>
            <button class="btn primary" id="btnConfirmEmp">Добавить выбранных</button>
          </div>
        </div>
      </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById('empSelectModal');
    modal.querySelectorAll('.btnClose').forEach(b => b.onclick = () => modal.remove());
    modal.onclick = e => { if (e.target === modal) modal.remove(); };

    function updateCount() {
      const el = document.getElementById('empSelectedCount');
      if (el) el.textContent = 'Выбрано: ' + selected.size;
    }

    function refreshList() {
      const search = (document.getElementById('empSearch') || {}).value || '';
      const filter = (document.getElementById('empFilter') || {}).value || '';
      const listEl = document.getElementById('empList');
      if (listEl) listEl.innerHTML = renderEmpList(filter, search);
      attachCheckboxes();
    }

    function attachCheckboxes() {
      document.querySelectorAll('#empSelectModal .empCheck').forEach(cb => {
        cb.onchange = () => {
          if (cb.checked) selected.add(cb.dataset.id);
          else selected.delete(cb.dataset.id);
          updateCount();
        };
      });
    }
    attachCheckboxes();

    const empSearch = document.getElementById('empSearch');
    if (empSearch) empSearch.oninput = debounce(refreshList, 300);
    const empFilter = document.getElementById('empFilter');
    if (empFilter) empFilter.onchange = refreshList;

    document.getElementById('empSelectAll').onclick = () => {
      document.querySelectorAll('#empSelectModal .empCheck').forEach(cb => {
        cb.checked = true;
        selected.add(cb.dataset.id);
      });
      updateCount();
    };
    document.getElementById('empDeselectAll').onclick = () => {
      document.querySelectorAll('#empSelectModal .empCheck').forEach(cb => {
        cb.checked = false;
      });
      selected.clear();
      updateCount();
    };

    document.getElementById('btnConfirmEmp').onclick = () => {
      const selectedEmps = allEmployees.filter(e => selected.has(String(e.id)));
      modal.remove();
      onConfirm(selectedEmps);
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // МОДАЛКА: Выбор разрешений для сотрудника
  // ═══════════════════════════════════════════════════════════════
  function openPermitSelectModal(employeeId, currentTypeIds, existingPermits, onConfirm) {
    const selected = new Set(currentTypeIds.map(Number));
    const emp = allEmployees.find(e => e.id === employeeId) || {};
    const empName = emp.fio || emp.full_name || 'Сотрудник';

    // Group types by category
    const byCategory = {};
    permitTypes.forEach(pt => {
      if (!byCategory[pt.category]) byCategory[pt.category] = [];
      byCategory[pt.category].push(pt);
    });

    function renderCategories() {
      return Object.entries(byCategory).map(([cat, types]) => {
        const catInfo = CATEGORIES[cat] || { name: cat, color: '#888' };
        const selectedInCat = types.filter(t => selected.has(t.id)).length;

        const items = types.map(t => {
          const ps = getPermitStatus(existingPermits, t.code);
          const isActive = ps.status === 'active' && ps.date;
          const isChecked = selected.has(t.id);

          let statusHtml = '';
          let disabled = '';
          let opacity = '';
          let strike = '';

          if (isActive && !isChecked) {
            disabled = 'disabled';
            opacity = 'opacity:0.5;';
            strike = 'text-decoration:line-through;';
            statusHtml = `<div style="font-size:11px;color:var(--green)">${esc(ps.label)}</div>`;
          } else if (ps.status === 'expiring') {
            statusHtml = `<div style="font-size:11px;color:var(--amber)">${esc(ps.label)}</div>`;
          } else if (ps.status === 'expired') {
            statusHtml = `<div style="font-size:11px;color:var(--red)">${esc(ps.label)}</div>`;
          }

          return `<label style="display:flex;align-items:flex-start;gap:8px;padding:8px;border-radius:var(--radius-sm);cursor:${disabled?'default':'pointer'};${opacity}"
                         onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
            <input type="checkbox" class="permitCheck" data-id="${t.id}" data-code="${t.code}" ${isChecked && !disabled ? 'checked' : ''} ${isActive && !isChecked ? 'checked disabled' : ''} ${disabled}/>
            <div>
              <div style="font-size:13px;${strike}">${esc(t.name)}</div>
              ${statusHtml}
            </div>
          </label>`;
        }).join('');

        return `<details open style="margin-bottom:12px">
          <summary style="cursor:pointer;padding:10px 0;font-weight:600;display:flex;align-items:center;gap:8px">
            <span class="dot" style="background:${catInfo.color}"></span>
            ${catInfo.name} <span class="help" style="font-size:11px">(${selectedInCat} из ${types.length} выбрано)</span>
          </summary>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:4px;padding-left:18px">
            ${items}
          </div>
        </details>`;
      }).join('');
    }

    const presetButtons = Object.entries(PRESETS).map(([key, p]) =>
      `<button class="btn mini" data-preset="${key}">${esc(p.name)}</button>`
    ).join('');

    // Copy from other employees in current form
    const otherEmps = formState.items.filter(i => i.employee_id !== employeeId && i.permit_type_ids.length > 0);
    const copyBtn = otherEmps.length > 0
      ? '<button class="btn mini ghost" id="btnCopyFrom">Скопировать с...</button>'
      : '';

    const html = `
    <div class="modal-overlay" id="permitSelectModal">
      <div class="modal-content" style="max-width:900px">
        <div class="modal-header">
          <h3>Разрешения для: <span style="color:var(--primary)">${esc(empName)}</span></h3>
          <button class="btn ghost btnClose">&times;</button>
        </div>
        <div class="modal-body" style="max-height:70vh;overflow-y:auto">
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px">
            <span class="help" style="line-height:32px">Быстрый выбор:</span>
            ${presetButtons}
            ${copyBtn}
          </div>
          <div id="permitCategories">${renderCategories()}</div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:space-between;align-items:center;padding:16px">
          <span class="help" id="permitSelectedCount">Выбрано разрешений: ${selected.size}</span>
          <div style="display:flex;gap:12px">
            <button class="btn ghost btnClose">Отмена</button>
            <button class="btn primary" id="btnConfirmPermits">Применить</button>
          </div>
        </div>
      </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById('permitSelectModal');
    modal.querySelectorAll('.btnClose').forEach(b => b.onclick = () => modal.remove());
    modal.onclick = e => { if (e.target === modal) modal.remove(); };

    function updatePermitCount() {
      const el = document.getElementById('permitSelectedCount');
      if (el) el.textContent = 'Выбрано разрешений: ' + selected.size;
    }

    function attachPermitCheckboxes() {
      document.querySelectorAll('#permitSelectModal .permitCheck:not([disabled])').forEach(cb => {
        cb.onchange = () => {
          const id = parseInt(cb.dataset.id);
          if (cb.checked) selected.add(id);
          else selected.delete(id);
          updatePermitCount();
        };
      });
    }
    attachPermitCheckboxes();

    // Presets
    document.querySelectorAll('#permitSelectModal [data-preset]').forEach(btn => {
      btn.onclick = () => {
        const preset = PRESETS[btn.dataset.preset];
        if (!preset) return;
        preset.codes.forEach(code => {
          const pt = permitTypes.find(t => t.code === code);
          if (pt) selected.add(pt.id);
        });
        document.getElementById('permitCategories').innerHTML = renderCategories();
        attachPermitCheckboxes();
        updatePermitCount();
      };
    });

    // Copy from another employee
    const btnCopy = document.getElementById('btnCopyFrom');
    if (btnCopy) {
      btnCopy.onclick = () => {
        const options = otherEmps.map(i => {
          const e = i.employee || {};
          return `<option value="${i.employee_id}">${esc(e.fio || 'Сотрудник')}</option>`;
        }).join('');
        const sel = prompt('ID сотрудника для копирования');
        // Simple approach: use first other employee
        if (otherEmps.length === 1) {
          otherEmps[0].permit_type_ids.forEach(id => selected.add(id));
        } else if (sel) {
          const src = formState.items.find(i => String(i.employee_id) === sel);
          if (src) src.permit_type_ids.forEach(id => selected.add(id));
        }
        document.getElementById('permitCategories').innerHTML = renderCategories();
        attachPermitCheckboxes();
        updatePermitCount();
      };
    }

    document.getElementById('btnConfirmPermits').onclick = () => {
      modal.remove();
      onConfirm(Array.from(selected));
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // МОДАЛКА: Подтверждение отправки email
  // ═══════════════════════════════════════════════════════════════
  function openSendConfirmModal(application, onSuccess) {
    const html = `
    <div class="modal-overlay" id="sendConfirmModal">
      <div class="modal-content" style="max-width:600px">
        <div class="modal-header">
          <h3>Отправить заявку подрядчику</h3>
          <button class="btn ghost btnClose">&times;</button>
        </div>
        <div class="modal-body" style="padding:20px">
          <div style="margin-bottom:16px">
            <div class="help" style="margin-bottom:4px">Кому:</div>
            <div style="font-weight:600">${esc(application.contractor_email || '—')}</div>
          </div>
          <div style="margin-bottom:16px">
            <div class="help" style="margin-bottom:4px">Тема:</div>
            <div>Заявка на оформление разрешений ${esc(application.number || '')} &mdash; ООО &laquo;Асгард Сервис&raquo;</div>
          </div>
          <div style="margin-bottom:16px">
            <div class="help" style="margin-bottom:4px">Вложение:</div>
            <div>${esc(application.number || 'draft')}_реестр.xlsx</div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="sendCopyToSelf"/>
            <span>Отправить копию на мой email</span>
          </label>
        </div>
        <div class="modal-footer" style="display:flex;gap:12px;justify-content:flex-end;padding:16px">
          <button class="btn ghost btnClose">Отмена</button>
          <button class="btn primary" id="btnConfirmSend">Отправить</button>
        </div>
      </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById('sendConfirmModal');
    modal.querySelectorAll('.btnClose').forEach(b => b.onclick = () => modal.remove());
    modal.onclick = e => { if (e.target === modal) modal.remove(); };

    document.getElementById('btnConfirmSend').onclick = async () => {
      const copyToSelf = document.getElementById('sendCopyToSelf')?.checked || false;
      const btn = document.getElementById('btnConfirmSend');
      btn.disabled = true;
      btn.textContent = 'Отправка...';

      try {
        await apiFetch('/api/permit-applications/' + application.id + '/send', {
          method: 'POST',
          body: { copy_to_self: copyToSelf }
        });
        toast('Готово', 'Заявка отправлена', 'ok');
        modal.remove();
        if (onSuccess) onSuccess();
      } catch(e) {
        toast('Ошибка', e.message, 'err');
        btn.disabled = false;
        btn.textContent = 'Отправить';
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // МОДАЛКА: Просмотр заявки (read-only)
  // ═══════════════════════════════════════════════════════════════
  async function openViewModal(applicationId) {
    let data;
    try {
      data = await apiFetch('/api/permit-applications/' + applicationId);
    } catch(e) {
      toast('Ошибка', e.message, 'err');
      return;
    }

    const app = data.application;
    const items = data.items || [];
    const history = data.history || [];

    const itemsHtml = items.map((item, idx) => {
      const permits = (item.permit_type_names || []).join(', ');
      return `<tr>
        <td>${idx + 1}</td>
        <td style="font-weight:600">${esc(item.employee_fio || '')}</td>
        <td>${esc(item.employee_role_tag || '')}</td>
        <td style="font-size:12px">${esc(permits)}</td>
        <td>${esc(item.notes || '')}</td>
      </tr>`;
    }).join('');

    const historyHtml = history.map(h => `
      <div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        ${statusBadge(h.new_status)}
        <span class="help" style="font-size:11px">${esc(h.changed_by_name||'')} &middot; ${formatDate(h.created_at)}</span>
        ${h.comment ? '<span class="help" style="font-size:11px">&mdash; ' + esc(h.comment) + '</span>' : ''}
      </div>
    `).join('');

    const html = `
    <div class="modal-overlay" id="viewAppModal">
      <div class="modal-content" style="max-width:900px">
        <div class="modal-header">
          <h3>Заявка ${esc(app.number || '')}</h3>
          <button class="btn ghost btnClose">&times;</button>
        </div>
        <div class="modal-body" style="max-height:70vh;overflow-y:auto;padding:20px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
            <div>
              <div class="help">Подрядчик</div>
              <div style="font-weight:600">${esc(app.contractor_name || '—')}</div>
              <div class="help">${esc(app.contractor_email || '')}</div>
            </div>
            <div>
              <div class="help">Статус</div>
              <div>${statusBadge(app.status)}</div>
              ${app.sent_at ? '<div class="help" style="margin-top:4px">Отправлено: ' + formatDate(app.sent_at) + '</div>' : ''}
            </div>
          </div>

          ${app.title ? '<div style="margin-bottom:16px"><div class="help">Комментарий</div><div>' + esc(app.title) + '</div></div>' : ''}

          <h4 style="margin-bottom:8px">Сотрудники (${items.length})</h4>
          <div style="overflow-x:auto;margin-bottom:20px">
            <table class="asg"><thead><tr>
              <th style="width:40px">&#8470;</th>
              <th>ФИО</th>
              <th style="width:130px">Должность</th>
              <th>Разрешения</th>
              <th style="width:120px">Примечания</th>
            </tr></thead><tbody>${itemsHtml}</tbody></table>
          </div>

          <h4 style="margin-bottom:8px">История</h4>
          <div>${historyHtml || '<div class="help">Нет записей</div>'}</div>
        </div>
        <div class="modal-footer" style="display:flex;gap:12px;justify-content:flex-end;padding:16px">
          <button class="btn ghost btnClose">Закрыть</button>
        </div>
      </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById('viewAppModal');
    modal.querySelectorAll('.btnClose').forEach(b => b.onclick = () => modal.remove());
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
  }

  return { render, renderForm };
})();
