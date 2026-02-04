/**
 * АСГАРД CRM — Модуль Склад / Оборудование
 * 
 * Функции:
 * - Реестр ТМЦ с фильтрами и поиском
 * - Выдача / Возврат оборудования
 * - Передача между РП (через склад)
 * - ТО и ремонт
 * - Бронирование под работы
 * - QR-коды
 */

window.AsgardWarehouse = (function(){
  const { $, $$, esc, toast, showModal, closeModal, confirm } = AsgardUI;
  
  // Состояние
  let categories = [];
  let objects = [];
  let warehouses = [];
  let currentFilters = {};
  let pmList = [];
  let worksList = [];
  
  // Статусы оборудования
  const STATUS_MAP = {
    'on_warehouse': { label: 'На складе', color: '#22c55e', icon: '📦' },
    'issued': { label: 'Выдано', color: '#3b82f6', icon: '👷' },
    'in_transit': { label: 'В пути', color: '#f59e0b', icon: '🚚' },
    'repair': { label: 'Ремонт', color: '#ef4444', icon: '🔧' },
    'broken': { label: 'Сломано', color: '#dc2626', icon: '❌' },
    'written_off': { label: 'Списано', color: '#6b7280', icon: '🗑️' }
  };
  
  const CONDITION_MAP = {
    'new': { label: 'Новое', color: '#22c55e' },
    'good': { label: 'Хорошее', color: '#3b82f6' },
    'satisfactory': { label: 'Удовл.', color: '#f59e0b' },
    'poor': { label: 'Плохое', color: '#ef4444' },
    'broken': { label: 'Сломано', color: '#dc2626' }
  };
  
  // Форматирование
  function money(x) {
    const n = Number(x) || 0;
    return n.toLocaleString('ru-RU', { minimumFractionDigits: 2 });
  }
  
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('ru-RU');
  }
  
  // Загрузка справочников
  async function loadDictionaries() {
    const auth = await AsgardAuth.getAuth();
    const headers = { 'Authorization': 'Bearer ' + auth.token };
    
    try {
      const [catRes, objRes, whRes] = await Promise.all([
        fetch('/api/equipment/categories', { headers }),
        fetch('/api/equipment/objects', { headers }),
        fetch('/api/equipment/warehouses', { headers })
      ]);
      
      const catData = await catRes.json();
      const objData = await objRes.json();
      const whData = await whRes.json();
      
      categories = catData.categories || [];
      objects = objData.objects || [];
      warehouses = whData.warehouses || [];
      
      // Загружаем РП и работы
      const [pmRes, worksRes] = await Promise.all([
        fetch('/api/users?role=PM', { headers }),
        fetch('/api/works?limit=200', { headers })
      ]);
      
      const pmData = await pmRes.json();
      const worksData = await worksRes.json();
      
      pmList = pmData.users || [];
      worksList = worksData.works || [];
      
    } catch(e) {
      console.error('Load dictionaries error:', e);
    }
  }
  
  // ============================================
  // ГЛАВНАЯ СТРАНИЦА СКЛАДА
  // ============================================
  
  async function render({ layout, title }) {
    await loadDictionaries();
    
    const auth = await AsgardAuth.getAuth();
    const user = auth?.user || {};
    const isWarehouseAdmin = ['ADMIN', 'WAREHOUSE', 'DIRECTOR', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user.role);
    const isPM = ['PM', 'MANAGER'].includes(user.role);
    
    const categoryOptions = categories.map(c => 
      `<option value="${c.id}">${c.icon || ''} ${esc(c.name)}</option>`
    ).join('');
    
    const objectOptions = objects.map(o => 
      `<option value="${o.id}">${esc(o.name)}</option>`
    ).join('');
    
    const pmOptions = pmList.map(p => 
      `<option value="${p.id}">${esc(p.name)}</option>`
    ).join('');
    
    const html = `
      <div class="warehouse-page">
        <!-- Статистика -->
        <div class="warehouse-stats" id="warehouseStats">
          <div class="stat-card">
            <div class="stat-icon">📦</div>
            <div class="stat-info">
              <div class="stat-value" id="statTotal">—</div>
              <div class="stat-label">Всего ТМЦ</div>
            </div>
          </div>
          <div class="stat-card green">
            <div class="stat-icon">🏠</div>
            <div class="stat-info">
              <div class="stat-value" id="statOnWarehouse">—</div>
              <div class="stat-label">На складе</div>
            </div>
          </div>
          <div class="stat-card blue">
            <div class="stat-icon">👷</div>
            <div class="stat-info">
              <div class="stat-value" id="statIssued">—</div>
              <div class="stat-label">Выдано</div>
            </div>
          </div>
          <div class="stat-card orange">
            <div class="stat-icon">🔧</div>
            <div class="stat-info">
              <div class="stat-value" id="statRepair">—</div>
              <div class="stat-label">В ремонте</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">💰</div>
            <div class="stat-info">
              <div class="stat-value" id="statValue">—</div>
              <div class="stat-label">Стоимость</div>
            </div>
          </div>
        </div>
        
        <!-- Фильтры -->
        <div class="warehouse-filters card">
          <div class="filters-row">
            <div class="filter-group">
              <input type="text" id="filterSearch" class="inp" placeholder="🔍 Поиск по названию, инв.№, серийнику..."/>
            </div>
            <div class="filter-group">
              <select id="filterStatus" class="inp">
                <option value="">Все статусы</option>
                <option value="on_warehouse">📦 На складе</option>
                <option value="issued">👷 Выдано</option>
                <option value="repair">🔧 В ремонте</option>
                <option value="broken">❌ Сломано</option>
              </select>
            </div>
            <div class="filter-group">
              <select id="filterCategory" class="inp">
                <option value="">Все категории</option>
                ${categoryOptions}
              </select>
            </div>
            <div class="filter-group">
              <select id="filterHolder" class="inp">
                <option value="">Все ответственные</option>
                ${pmOptions}
              </select>
            </div>
            <div class="filter-group">
              <select id="filterObject" class="inp">
                <option value="">Все объекты</option>
                ${objectOptions}
              </select>
            </div>
          </div>
          <div class="filters-actions">
            ${isWarehouseAdmin ? `
              <button class="btn primary" id="btnAddEquipment">➕ Добавить ТМЦ</button>
              <button class="btn ghost" id="btnPrintQR">🏷️ Печать QR</button>
            ` : ''}
            ${isPM ? `
              <button class="btn" id="btnMyEquipment">📋 Моё оборудование</button>
              <button class="btn ghost" id="btnRequestEquipment">📝 Запросить</button>
            ` : ''}
            <button class="btn ghost" id="btnExport">📥 Экспорт</button>
          </div>
        </div>
        
        <!-- Запросы на обработку (для кладовщика) -->
        ${isWarehouseAdmin ? `
        <div class="pending-requests card" id="pendingRequests" style="display:none">
          <h3>📥 Запросы на обработку</h3>
          <div id="requestsList"></div>
        </div>
        ` : ''}
        
        <!-- Таблица оборудования -->
        <div class="card">
          <div class="table-container">
            <table class="tbl" id="equipmentTable">
              <thead>
                <tr>
                  <th style="width:40px"></th>
                  <th>Инв. №</th>
                  <th>Наименование</th>
                  <th>Категория</th>
                  <th>Статус</th>
                  <th>Состояние</th>
                  <th>Ответственный</th>
                  <th>Объект</th>
                  <th>Кол-во</th>
                  <th style="width:120px">Действия</th>
                </tr>
              </thead>
              <tbody id="equipmentBody"></tbody>
            </table>
          </div>
        </div>
      </div>
      
      <style>
        .warehouse-page { padding: 20px; }
        
        .warehouse-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px;
          margin-bottom: 20px;
        }
        
        .stat-card {
          background: var(--bg-card);
          border-radius: 12px;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          border: 1px solid var(--border);
        }
        
        .stat-card.green { border-left: 4px solid #22c55e; }
        .stat-card.blue { border-left: 4px solid #3b82f6; }
        .stat-card.orange { border-left: 4px solid #f59e0b; }
        
        .stat-icon { font-size: 32px; }
        .stat-value { font-size: 24px; font-weight: 700; color: var(--text); }
        .stat-label { font-size: 12px; color: var(--text-muted); }
        
        .warehouse-filters {
          padding: 16px;
          margin-bottom: 20px;
        }
        
        .filters-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 12px;
        }
        
        .filter-group { flex: 1; min-width: 150px; }
        .filter-group .inp { width: 100%; }
        
        .filters-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        
        .pending-requests {
          padding: 16px;
          margin-bottom: 20px;
          border-left: 4px solid #f59e0b;
        }
        
        .pending-requests h3 {
          margin: 0 0 12px;
          font-size: 16px;
        }
        
        .request-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px;
          background: var(--bg);
          border-radius: 8px;
          margin-bottom: 8px;
        }
        
        .request-info { flex: 1; }
        .request-actions { display: flex; gap: 8px; }
        
        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 500;
        }
        
        .condition-badge {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
        }
        
        .equipment-row { cursor: pointer; }
        .equipment-row:hover { background: var(--bg-hover); }
        
        .equipment-name {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .equipment-photo {
          width: 36px;
          height: 36px;
          border-radius: 6px;
          object-fit: cover;
          background: var(--bg);
        }
        
        .action-btn {
          padding: 4px 8px;
          border-radius: 4px;
          border: none;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
        }
        
        .action-btn.issue { background: #22c55e; color: white; }
        .action-btn.return { background: #3b82f6; color: white; }
        .action-btn.transfer { background: #f59e0b; color: white; }
        .action-btn.repair { background: #ef4444; color: white; }
        
        @media (max-width: 768px) {
          .warehouse-stats { grid-template-columns: repeat(2, 1fr); }
          .filters-row { flex-direction: column; }
          .filter-group { min-width: 100%; }
        }
      </style>
    `;
    
    await layout(html, { title: title || 'Склад' });
    
    bindEvents(user);
    loadEquipment();
    loadStats();
    
    if (isWarehouseAdmin) {
      loadPendingRequests();
    }
  }
  
  // Привязка событий
  function bindEvents(user) {
    // Фильтры
    $('#filterSearch')?.addEventListener('input', debounce(loadEquipment, 300));
    $('#filterStatus')?.addEventListener('change', loadEquipment);
    $('#filterCategory')?.addEventListener('change', loadEquipment);
    $('#filterHolder')?.addEventListener('change', loadEquipment);
    $('#filterObject')?.addEventListener('change', loadEquipment);
    
    // Кнопки
    $('#btnAddEquipment')?.addEventListener('click', openAddForm);
    $('#btnPrintQR')?.addEventListener('click', printQRCodes);
    $('#btnMyEquipment')?.addEventListener('click', () => showMyEquipment(user.id));
    $('#btnRequestEquipment')?.addEventListener('click', openRequestForm);
    $('#btnExport')?.addEventListener('click', exportToExcel);
  }
  
  // Debounce
  function debounce(fn, ms) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }
  
  // ============================================
  // ЗАГРУЗКА ДАННЫХ
  // ============================================
  
  async function loadEquipment() {
    const auth = await AsgardAuth.getAuth();
    const headers = { 'Authorization': 'Bearer ' + auth.token };
    
    const params = new URLSearchParams();
    
    const search = $('#filterSearch')?.value?.trim();
    const status = $('#filterStatus')?.value;
    const category = $('#filterCategory')?.value;
    const holder = $('#filterHolder')?.value;
    const object = $('#filterObject')?.value;
    
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (category) params.set('category_id', category);
    if (holder) params.set('holder_id', holder);
    if (object) params.set('object_id', object);
    
    try {
      const resp = await fetch('/api/equipment?' + params.toString(), { headers });
      const data = await resp.json();
      
      if (data.success) {
        renderTable(data.equipment);
        updateStats(data.stats);
      }
    } catch(e) {
      console.error('Load equipment error:', e);
    }
  }
  
  async function loadStats() {
    const auth = await AsgardAuth.getAuth();
    const headers = { 'Authorization': 'Bearer ' + auth.token };
    
    try {
      const resp = await fetch('/api/equipment/stats/summary', { headers });
      const data = await resp.json();
      
      if (data.success) {
        updateStats(data.stats);
      }
    } catch(e) {}
  }
  
  function updateStats(stats) {
    if (!stats) return;
    
    $('#statTotal').textContent = stats.total || 0;
    $('#statOnWarehouse').textContent = stats.on_warehouse || 0;
    $('#statIssued').textContent = stats.issued || 0;
    $('#statRepair').textContent = stats.in_repair || 0;
    $('#statValue').textContent = money(stats.total_value || 0) + ' ₽';
  }
  
  // ============================================
  // РЕНДЕР ТАБЛИЦЫ
  // ============================================
  
  function renderTable(equipment) {
    const tbody = $('#equipmentBody');
    if (!tbody) return;
    
    if (!equipment || equipment.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted)">Оборудование не найдено</td></tr>`;
      return;
    }
    
    tbody.innerHTML = equipment.map(eq => {
      const status = STATUS_MAP[eq.status] || STATUS_MAP['on_warehouse'];
      const condition = CONDITION_MAP[eq.condition] || CONDITION_MAP['good'];
      
      const actions = getActions(eq);
      
      return `
        <tr class="equipment-row" data-id="${eq.id}">
          <td>
            <input type="checkbox" class="eq-checkbox" data-id="${eq.id}"/>
          </td>
          <td><code style="font-size:12px">${esc(eq.inventory_number)}</code></td>
          <td>
            <div class="equipment-name">
              ${eq.category_icon || '📦'}
              <div>
                <div style="font-weight:500">${esc(eq.name)}</div>
                ${eq.serial_number ? `<div style="font-size:11px;color:var(--text-muted)">S/N: ${esc(eq.serial_number)}</div>` : ''}
              </div>
            </div>
          </td>
          <td>${eq.category_name ? esc(eq.category_name) : '—'}</td>
          <td>
            <span class="status-badge" style="background:${status.color}20;color:${status.color}">
              ${status.icon} ${status.label}
            </span>
          </td>
          <td>
            <span class="condition-badge" style="background:${condition.color}20;color:${condition.color}">
              ${condition.label}
            </span>
          </td>
          <td>${eq.holder_name ? esc(eq.holder_name) : '—'}</td>
          <td>${eq.object_name ? esc(eq.object_name) : '—'}</td>
          <td>${eq.quantity || 1} ${eq.unit || 'шт'}</td>
          <td>
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              ${actions}
            </div>
          </td>
        </tr>
      `;
    }).join('');
    
    // Клик по строке — открыть карточку
    tbody.querySelectorAll('.equipment-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.action-btn') || e.target.closest('.eq-checkbox')) return;
        openEquipmentCard(row.dataset.id);
      });
    });
    
    // Кнопки действий
    tbody.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        
        switch(action) {
          case 'issue': openIssueForm(id); break;
          case 'return': doReturn(id); break;
          case 'transfer': openTransferForm(id); break;
          case 'repair': openRepairForm(id); break;
        }
      });
    });
  }
  
  function getActions(eq) {
    const auth = AsgardAuth.getSession();
    const user = auth?.user || {};
    const isWarehouseAdmin = ['ADMIN', 'WAREHOUSE', 'DIRECTOR', 'DIRECTOR_GEN'].includes(user.role);
    const isPM = ['PM', 'MANAGER'].includes(user.role);
    const isMyEquipment = eq.current_holder_id === user.id;
    
    let actions = '';
    
    if (eq.status === 'on_warehouse' && isWarehouseAdmin) {
      actions += `<button class="action-btn issue" data-action="issue" data-id="${eq.id}" title="Выдать">📤</button>`;
    }
    
    if (eq.status === 'issued') {
      if (isWarehouseAdmin || isMyEquipment) {
        actions += `<button class="action-btn return" data-action="return" data-id="${eq.id}" title="Вернуть">📥</button>`;
      }
      if (isPM && isMyEquipment) {
        actions += `<button class="action-btn transfer" data-action="transfer" data-id="${eq.id}" title="Передать">🔄</button>`;
      }
    }
    
    if (isWarehouseAdmin && eq.status !== 'repair') {
      actions += `<button class="action-btn repair" data-action="repair" data-id="${eq.id}" title="В ремонт">🔧</button>`;
    }
    
    return actions || '—';
  }
  
  // ============================================
  // КАРТОЧКА ОБОРУДОВАНИЯ
  // ============================================
  
  async function openEquipmentCard(id) {
    const auth = await AsgardAuth.getAuth();
    const headers = { 'Authorization': 'Bearer ' + auth.token };
    
    try {
      const resp = await fetch('/api/equipment/' + id, { headers });
      const data = await resp.json();
      
      if (!data.success) {
        toast('Ошибка', 'Не удалось загрузить данные', 'err');
        return;
      }
      
      const eq = data.equipment;
      const movements = data.movements || [];
      const maintenance = data.maintenance || [];
      
      const status = STATUS_MAP[eq.status] || STATUS_MAP['on_warehouse'];
      const condition = CONDITION_MAP[eq.condition] || CONDITION_MAP['good'];
      
      const categoryOptions = categories.map(c => 
        `<option value="${c.id}" ${c.id === eq.category_id ? 'selected' : ''}>${c.icon || ''} ${esc(c.name)}</option>`
      ).join('');
      
      const html = `
        <div class="equipment-card">
          <div class="eq-header">
            <div class="eq-title">
              <span class="eq-icon">${eq.category_icon || '📦'}</span>
              <div>
                <h2>${esc(eq.name)}</h2>
                <code>${esc(eq.inventory_number)}</code>
              </div>
            </div>
            <div class="eq-status">
              <span class="status-badge" style="background:${status.color}20;color:${status.color}">
                ${status.icon} ${status.label}
              </span>
              <span class="condition-badge" style="background:${condition.color}20;color:${condition.color}">
                ${condition.label}
              </span>
            </div>
          </div>
          
          <div class="eq-tabs">
            <button class="eq-tab active" data-tab="info">📋 Информация</button>
            <button class="eq-tab" data-tab="movements">📍 Перемещения (${movements.length})</button>
            <button class="eq-tab" data-tab="maintenance">🔧 ТО и ремонт (${maintenance.length})</button>
            <button class="eq-tab" data-tab="qr">🏷️ QR-код</button>
          </div>
          
          <div class="eq-tab-content" id="tabInfo">
            <div class="eq-info-grid">
              <div class="info-section">
                <h4>Основное</h4>
                <div class="info-row"><span>Категория:</span> <span>${eq.category_name || '—'}</span></div>
                <div class="info-row"><span>Серийный №:</span> <span>${eq.serial_number || '—'}</span></div>
                <div class="info-row"><span>Штрих-код:</span> <span>${eq.barcode || '—'}</span></div>
                <div class="info-row"><span>Количество:</span> <span>${eq.quantity || 1} ${eq.unit || 'шт'}</span></div>
              </div>
              
              <div class="info-section">
                <h4>Местоположение</h4>
                <div class="info-row"><span>Склад:</span> <span>${eq.warehouse_name || '—'}</span></div>
                <div class="info-row"><span>Ответственный:</span> <span>${eq.holder_name || '—'}</span></div>
                <div class="info-row"><span>Объект:</span> <span>${eq.object_name || '—'}</span></div>
              </div>
              
              <div class="info-section">
                <h4>Финансы</h4>
                <div class="info-row"><span>Стоимость:</span> <span>${eq.purchase_price ? money(eq.purchase_price) + ' ₽' : '—'}</span></div>
                <div class="info-row"><span>Дата покупки:</span> <span>${fmtDate(eq.purchase_date)}</span></div>
                <div class="info-row"><span>Счёт:</span> <span>${eq.invoice_number || '—'}</span></div>
                <div class="info-row"><span>На балансе:</span> <span>${eq.balance_status === 'on_balance' ? '✅ Да' : '❌ Нет'}</span></div>
              </div>
              
              <div class="info-section">
                <h4>ТО и гарантия</h4>
                <div class="info-row"><span>Гарантия до:</span> <span>${fmtDate(eq.warranty_end)}</span></div>
                <div class="info-row"><span>След. ТО:</span> <span>${fmtDate(eq.next_maintenance)}</span></div>
                <div class="info-row"><span>Поверка:</span> <span>${fmtDate(eq.next_calibration)}</span></div>
              </div>
            </div>
            
            ${eq.description ? `<div class="info-section"><h4>Описание</h4><p>${esc(eq.description)}</p></div>` : ''}
          </div>
          
          <div class="eq-tab-content" id="tabMovements" style="display:none">
            ${movements.length > 0 ? `
              <div class="movements-list">
                ${movements.map(m => renderMovement(m)).join('')}
              </div>
            ` : '<p style="color:var(--text-muted);text-align:center;padding:20px">Нет перемещений</p>'}
          </div>
          
          <div class="eq-tab-content" id="tabMaintenance" style="display:none">
            <button class="btn mini" id="btnAddMaintenance">➕ Добавить запись</button>
            ${maintenance.length > 0 ? `
              <div class="maintenance-list" style="margin-top:12px">
                ${maintenance.map(m => `
                  <div class="maintenance-item">
                    <div class="maint-type">${getMaintenanceIcon(m.maintenance_type)} ${m.maintenance_type}</div>
                    <div class="maint-date">${fmtDate(m.performed_date)}</div>
                    <div class="maint-desc">${esc(m.description || '')}</div>
                    ${m.cost ? `<div class="maint-cost">${money(m.cost)} ₽</div>` : ''}
                  </div>
                `).join('')}
              </div>
            ` : '<p style="color:var(--text-muted);text-align:center;padding:20px">Нет записей ТО</p>'}
          </div>
          
          <div class="eq-tab-content" id="tabQr" style="display:none">
            <div style="text-align:center;padding:20px">
              <div id="qrCodeContainer" style="display:inline-block;padding:20px;background:white;border-radius:12px"></div>
              <p style="margin-top:12px">${esc(eq.inventory_number)}</p>
              <button class="btn" id="btnPrintSingleQR">🖨️ Печать QR</button>
            </div>
          </div>
        </div>
        
        <style>
          .equipment-card { max-width: 800px; }
          .eq-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
          .eq-title { display: flex; gap: 12px; align-items: center; }
          .eq-title h2 { margin: 0; font-size: 20px; }
          .eq-icon { font-size: 40px; }
          .eq-status { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
          
          .eq-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
          .eq-tab { 
            padding: 10px 16px; border: none; background: none; cursor: pointer; 
            color: var(--text-muted); font-size: 13px; border-bottom: 2px solid transparent;
            transition: all 0.2s;
          }
          .eq-tab:hover { color: var(--text); }
          .eq-tab.active { color: var(--primary); border-bottom-color: var(--primary); }
          
          .eq-info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
          .info-section { background: var(--bg); padding: 12px; border-radius: 8px; }
          .info-section h4 { margin: 0 0 10px; font-size: 13px; color: var(--text-muted); }
          .info-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
          .info-row span:first-child { color: var(--text-muted); }
          
          .movements-list { max-height: 400px; overflow-y: auto; }
          .movement-item { 
            display: flex; align-items: center; gap: 12px; padding: 12px; 
            border-bottom: 1px solid var(--border);
          }
          .movement-icon { font-size: 24px; }
          .movement-info { flex: 1; }
          .movement-type { font-weight: 500; }
          .movement-details { font-size: 12px; color: var(--text-muted); }
          .movement-date { font-size: 11px; color: var(--text-muted); }
          
          .maintenance-item {
            display: grid; grid-template-columns: 1fr 100px 2fr 100px; gap: 10px;
            padding: 10px; border-bottom: 1px solid var(--border); font-size: 13px;
          }
          
          @media (max-width: 600px) {
            .eq-info-grid { grid-template-columns: 1fr; }
            .eq-tabs { overflow-x: auto; }
          }
        </style>
      `;
      
      showModal('Карточка оборудования', html);
      
      // Табы
      $$('.eq-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          $$('.eq-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          
          $$('.eq-tab-content').forEach(c => c.style.display = 'none');
          const tabName = tab.dataset.tab;
          $(`#tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`).style.display = 'block';
          
          // Генерация QR при открытии вкладки
          if (tabName === 'qr') {
            generateQRCode(eq);
          }
        });
      });
      
      // Добавление ТО
      $('#btnAddMaintenance')?.addEventListener('click', () => {
        openMaintenanceForm(eq.id);
      });
      
    } catch(e) {
      console.error('Load equipment card error:', e);
      toast('Ошибка', 'Не удалось загрузить карточку', 'err');
    }
  }
  
  function renderMovement(m) {
    const typeMap = {
      'issue': { icon: '📤', label: 'Выдача' },
      'return': { icon: '📥', label: 'Возврат' },
      'transfer_out': { icon: '➡️', label: 'Передача (отдал)' },
      'transfer_in': { icon: '⬅️', label: 'Передача (получил)' },
      'write_off': { icon: '🗑️', label: 'Списание' },
      'repair_start': { icon: '🔧', label: 'В ремонт' },
      'repair_end': { icon: '✅', label: 'Из ремонта' }
    };
    
    const type = typeMap[m.movement_type] || { icon: '📍', label: m.movement_type };
    
    let details = '';
    if (m.from_holder_name) details += `От: ${m.from_holder_name}`;
    if (m.to_holder_name) details += (details ? ' → ' : '') + `Кому: ${m.to_holder_name}`;
    if (m.to_object_name) details += ` (${m.to_object_name})`;
    if (m.work_title) details += ` | Работа: ${m.work_title}`;
    
    return `
      <div class="movement-item">
        <div class="movement-icon">${type.icon}</div>
        <div class="movement-info">
          <div class="movement-type">${type.label}</div>
          <div class="movement-details">${details || '—'}</div>
          ${m.notes ? `<div class="movement-notes" style="font-style:italic;font-size:11px">${esc(m.notes)}</div>` : ''}
        </div>
        <div class="movement-date">${fmtDate(m.created_at)}<br/>${m.created_by_name || ''}</div>
      </div>
    `;
  }
  
  function getMaintenanceIcon(type) {
    const icons = {
      'scheduled_to': '🔄',
      'repair': '🔧',
      'calibration': '📏',
      'inspection': '🔍'
    };
    return icons[type] || '📋';
  }
  
  // ============================================
  // ФОРМЫ
  // ============================================
  
  async function openAddForm() {
    const categoryOptions = categories.map(c => 
      `<option value="${c.id}">${c.icon || ''} ${esc(c.name)}</option>`
    ).join('');
    
    const html = `
      <form id="addEquipmentForm" class="form-grid">
        <div class="form-row">
          <div class="form-group">
            <label>Наименование *</label>
            <input type="text" name="name" class="inp" required/>
          </div>
          <div class="form-group">
            <label>Категория *</label>
            <select name="category_id" class="inp" required>
              <option value="">Выберите...</option>
              ${categoryOptions}
            </select>
          </div>
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label>Серийный номер</label>
            <input type="text" name="serial_number" class="inp"/>
          </div>
          <div class="form-group">
            <label>Штрих-код</label>
            <input type="text" name="barcode" class="inp"/>
          </div>
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label>Количество</label>
            <input type="number" name="quantity" class="inp" value="1" step="0.01"/>
          </div>
          <div class="form-group">
            <label>Ед. измерения</label>
            <select name="unit" class="inp">
              <option value="шт">шт</option>
              <option value="м">м</option>
              <option value="кг">кг</option>
              <option value="л">л</option>
              <option value="компл">компл</option>
            </select>
          </div>
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label>Стоимость (руб)</label>
            <input type="number" name="purchase_price" class="inp" step="0.01"/>
          </div>
          <div class="form-group">
            <label>Дата покупки</label>
            <input type="date" name="purchase_date" class="inp"/>
          </div>
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label>Гарантия до</label>
            <input type="date" name="warranty_end" class="inp"/>
          </div>
          <div class="form-group">
            <label>Интервал ТО (дней)</label>
            <input type="number" name="maintenance_interval_days" class="inp"/>
          </div>
        </div>
        
        <div class="form-group" style="grid-column:1/-1">
          <label>Описание</label>
          <textarea name="description" class="inp" rows="2"></textarea>
        </div>
        
        <div class="form-group" style="grid-column:1/-1">
          <label>
            <input type="checkbox" name="auto_balance" checked/>
            Автоматически поставить на баланс
          </label>
        </div>
        
        <div class="form-actions" style="grid-column:1/-1">
          <button type="button" class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>
          <button type="submit" class="btn primary">💾 Сохранить</button>
        </div>
      </form>
      
      <style>
        .form-grid { display: grid; gap: 16px; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .form-group label { display: block; margin-bottom: 4px; font-size: 13px; color: var(--text-muted); }
        .form-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 10px; }
        @media (max-width: 500px) { .form-row { grid-template-columns: 1fr; } }
      </style>
    `;
    
    showModal('➕ Добавить ТМЦ', html);
    
    $('#addEquipmentForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const form = e.target;
      const formData = new FormData(form);
      
      const data = {
        name: formData.get('name'),
        category_id: formData.get('category_id'),
        serial_number: formData.get('serial_number'),
        barcode: formData.get('barcode'),
        quantity: formData.get('quantity') || 1,
        unit: formData.get('unit'),
        purchase_price: formData.get('purchase_price'),
        purchase_date: formData.get('purchase_date'),
        warranty_end: formData.get('warranty_end'),
        maintenance_interval_days: formData.get('maintenance_interval_days'),
        notes: formData.get('description')
      };
      
      const auth = await AsgardAuth.getAuth();
      
      try {
        const resp = await fetch('/api/equipment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + auth.token
          },
          body: JSON.stringify(data)
        });
        
        const result = await resp.json();
        
        if (result.success) {
          closeModal();
          toast('Успех', 'Оборудование добавлено: ' + result.equipment.inventory_number, 'ok');
          loadEquipment();
          loadStats();
        } else {
          toast('Ошибка', result.message || 'Не удалось сохранить', 'err');
        }
      } catch(e) {
        toast('Ошибка', e.message, 'err');
      }
    });
  }

  // Форма запроса оборудования
  async function openRequestForm() {
    const categoryOptions = categories.map(c =>
      `<option value="${c.id}">${c.icon || ''} ${esc(c.name)}</option>`
    ).join('');

    const workOptions = worksList.filter(w => w.work_status !== 'Завершена').map(w =>
      `<option value="${w.id}">${esc(w.work_number || '')} — ${esc(w.work_title || w.customer_name)}</option>`
    ).join('');

    const objectOptions = objects.map(o =>
      `<option value="${o.id}">${esc(o.name)}</option>`
    ).join('');

    const html = `
      <form id="requestEquipmentForm">
        <div class="form-group">
          <label>Категория оборудования *</label>
          <select name="category_id" class="inp">
            <option value="">Любая категория</option>
            ${categoryOptions}
          </select>
        </div>

        <div class="form-group">
          <label>Для какой работы *</label>
          <select name="work_id" class="inp" required>
            <option value="">Выберите работу...</option>
            ${workOptions}
          </select>
        </div>

        <div class="form-group">
          <label>Объект</label>
          <select name="object_id" class="inp">
            <option value="">Выберите объект...</option>
            ${objectOptions}
          </select>
        </div>

        <div class="form-group">
          <label>Описание запроса *</label>
          <textarea name="notes" class="inp" rows="3" required placeholder="Укажите что именно нужно..."></textarea>
        </div>

        <button type="submit" class="btn btn-primary w-full">📝 Отправить заявку</button>
      </form>
    `;

    showModal('📋 Запрос оборудования', html);

    $('#requestEquipmentForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const form = e.target;
      const formData = new FormData(form);
      const auth = await AsgardAuth.getAuth();

      const data = {
        request_type: 'equipment',
        requester_id: auth.user.id,
        work_id: formData.get('work_id'),
        object_id: formData.get('object_id') || null,
        notes: formData.get('notes'),
        status: 'pending'
      };

      try {
        const resp = await fetch('/api/data/equipment_requests', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + auth.token
          },
          body: JSON.stringify(data)
        });

        if (resp.ok) {
          closeModal();
          toast('Успех', 'Заявка на оборудование отправлена', 'ok');
        } else {
          const err = await resp.json();
          toast('Ошибка', err.error || 'Не удалось отправить заявку', 'err');
        }
      } catch(e) {
        toast('Ошибка', e.message, 'err');
      }
    });
  }

  // Форма выдачи
  async function openIssueForm(equipmentId) {
    const pmOptions = pmList.map(p => 
      `<option value="${p.id}">${esc(p.name)}</option>`
    ).join('');
    
    const objectOptions = objects.map(o => 
      `<option value="${o.id}">${esc(o.name)}</option>`
    ).join('');
    
    const workOptions = worksList.filter(w => w.work_status !== 'Завершена').map(w => 
      `<option value="${w.id}">${esc(w.work_number || '')} — ${esc(w.work_title || w.customer_name)}</option>`
    ).join('');
    
    const html = `
      <form id="issueForm">
        <div class="form-group">
          <label>Кому выдать (РП) *</label>
          <select name="holder_id" class="inp" required>
            <option value="">Выберите...</option>
            ${pmOptions}
          </select>
        </div>
        
        <div class="form-group">
          <label>Работа (обязательно) *</label>
          <select name="work_id" class="inp" required>
            <option value="">Выберите...</option>
            ${workOptions}
          </select>
        </div>
        
        <div class="form-group">
          <label>Объект *</label>
          <select name="object_id" class="inp" required>
            <option value="">Выберите...</option>
            ${objectOptions}
          </select>
        </div>
        
        <div class="form-group">
          <label>Состояние при выдаче</label>
          <select name="condition_after" class="inp">
            <option value="good">Хорошее</option>
            <option value="satisfactory">Удовлетворительное</option>
            <option value="poor">Плохое</option>
          </select>
        </div>
        
        <div class="form-group">
          <label>Примечание</label>
          <textarea name="notes" class="inp" rows="2"></textarea>
        </div>
        
        <div class="form-actions">
          <button type="button" class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>
          <button type="submit" class="btn primary">📤 Выдать</button>
        </div>
      </form>
    `;
    
    showModal('📤 Выдача оборудования', html);
    
    $('#issueForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const form = e.target;
      const formData = new FormData(form);
      
      const data = {
        equipment_id: parseInt(equipmentId),
        holder_id: parseInt(formData.get('holder_id')),
        work_id: parseInt(formData.get('work_id')),
        object_id: parseInt(formData.get('object_id')),
        condition_after: formData.get('condition_after'),
        notes: formData.get('notes')
      };
      
      const auth = await AsgardAuth.getAuth();
      
      try {
        const resp = await fetch('/api/equipment/issue', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + auth.token
          },
          body: JSON.stringify(data)
        });
        
        const result = await resp.json();
        
        if (result.success) {
          closeModal();
          toast('Успех', 'Оборудование выдано', 'ok');
          loadEquipment();
          loadStats();
        } else {
          toast('Ошибка', result.message, 'err');
        }
      } catch(e) {
        toast('Ошибка', e.message, 'err');
      }
    });
  }
  
  // Возврат на склад
  async function doReturn(equipmentId) {
    const ok = await confirm('Вернуть оборудование на склад?');
    if (!ok) return;
    
    const auth = await AsgardAuth.getAuth();
    
    try {
      const resp = await fetch('/api/equipment/return', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + auth.token
        },
        body: JSON.stringify({
          equipment_id: parseInt(equipmentId)
        })
      });
      
      const result = await resp.json();
      
      if (result.success) {
        toast('Успех', 'Оборудование возвращено на склад', 'ok');
        loadEquipment();
        loadStats();
      } else {
        toast('Ошибка', result.message, 'err');
      }
    } catch(e) {
      toast('Ошибка', e.message, 'err');
    }
  }
  
  // Форма передачи другому РП
  async function openTransferForm(equipmentId) {
    const pmOptions = pmList.map(p => 
      `<option value="${p.id}">${esc(p.name)}</option>`
    ).join('');
    
    const objectOptions = objects.map(o => 
      `<option value="${o.id}">${esc(o.name)}</option>`
    ).join('');
    
    const workOptions = worksList.filter(w => w.work_status !== 'Завершена').map(w => 
      `<option value="${w.id}">${esc(w.work_number || '')} — ${esc(w.work_title || w.customer_name)}</option>`
    ).join('');
    
    const html = `
      <form id="transferForm">
        <p style="color:var(--text-muted);margin-bottom:16px">
          Передача происходит через склад: оборудование будет возвращено и выдано новому РП.
        </p>
        
        <div class="form-group">
          <label>Кому передать (РП) *</label>
          <select name="target_holder_id" class="inp" required>
            <option value="">Выберите...</option>
            ${pmOptions}
          </select>
        </div>
        
        <div class="form-group">
          <label>Работа (обязательно) *</label>
          <select name="work_id" class="inp" required>
            <option value="">Выберите...</option>
            ${workOptions}
          </select>
        </div>
        
        <div class="form-group">
          <label>Объект *</label>
          <select name="object_id" class="inp" required>
            <option value="">Выберите...</option>
            ${objectOptions}
          </select>
        </div>
        
        <div class="form-group">
          <label>Примечание</label>
          <textarea name="notes" class="inp" rows="2"></textarea>
        </div>
        
        <div class="form-actions">
          <button type="button" class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>
          <button type="submit" class="btn primary">🔄 Создать запрос</button>
        </div>
      </form>
    `;
    
    showModal('🔄 Передача оборудования', html);
    
    $('#transferForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const form = e.target;
      const formData = new FormData(form);
      
      const data = {
        equipment_id: parseInt(equipmentId),
        target_holder_id: parseInt(formData.get('target_holder_id')),
        work_id: parseInt(formData.get('work_id')),
        object_id: parseInt(formData.get('object_id')),
        notes: formData.get('notes')
      };
      
      const auth = await AsgardAuth.getAuth();
      
      try {
        const resp = await fetch('/api/equipment/transfer-request', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + auth.token
          },
          body: JSON.stringify(data)
        });
        
        const result = await resp.json();
        
        if (result.success) {
          closeModal();
          toast('Успех', 'Запрос на передачу создан. Кладовщик обработает.', 'ok');
        } else {
          toast('Ошибка', result.message, 'err');
        }
      } catch(e) {
        toast('Ошибка', e.message, 'err');
      }
    });
  }
  
  // ============================================
  // ЗАПРОСЫ (ДЛЯ КЛАДОВЩИКА)
  // ============================================
  
  async function loadPendingRequests() {
    const auth = await AsgardAuth.getAuth();
    const headers = { 'Authorization': 'Bearer ' + auth.token };
    
    try {
      const resp = await fetch('/api/equipment/requests?status=pending', { headers });
      const data = await resp.json();
      
      const container = $('#pendingRequests');
      const list = $('#requestsList');
      
      if (data.requests && data.requests.length > 0) {
        container.style.display = 'block';
        
        list.innerHTML = data.requests.map(r => `
          <div class="request-item" data-id="${r.id}">
            <div class="request-info">
              <strong>${esc(r.equipment_name)}</strong> (${esc(r.inventory_number)})<br/>
              <span style="font-size:12px;color:var(--text-muted)">
                ${r.request_type === 'transfer' ? '🔄 Передача' : '📝 Запрос'}: 
                ${esc(r.requester_name)} → ${esc(r.target_holder_name || '?')}<br/>
                Работа: ${esc(r.work_title || '—')} | Объект: ${esc(r.object_name || '—')}
              </span>
            </div>
            <div class="request-actions">
              <button class="btn mini primary" onclick="AsgardWarehouse.executeTransfer(${r.id})">✅ Выполнить</button>
              <button class="btn mini ghost" onclick="AsgardWarehouse.rejectRequest(${r.id})">❌</button>
            </div>
          </div>
        `).join('');
      } else {
        container.style.display = 'none';
      }
    } catch(e) {
      console.error('Load requests error:', e);
    }
  }
  
  async function executeTransfer(requestId) {
    const auth = await AsgardAuth.getAuth();
    
    try {
      const resp = await fetch('/api/equipment/transfer-execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + auth.token
        },
        body: JSON.stringify({ request_id: requestId })
      });
      
      const result = await resp.json();
      
      if (result.success) {
        toast('Успех', 'Передача выполнена', 'ok');
        loadPendingRequests();
        loadEquipment();
      } else {
        toast('Ошибка', result.message, 'err');
      }
    } catch(e) {
      toast('Ошибка', e.message, 'err');
    }
  }
  
  async function rejectRequest(requestId) {
    const reason = prompt('Причина отклонения:');
    if (reason === null) return;
    
    const auth = await AsgardAuth.getAuth();
    
    try {
      const resp = await fetch('/api/equipment/requests/' + requestId + '/reject', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + auth.token
        },
        body: JSON.stringify({ reason })
      });
      
      const result = await resp.json();
      
      if (result.success) {
        toast('Успех', 'Запрос отклонён', 'ok');
        loadPendingRequests();
      } else {
        toast('Ошибка', result.message, 'err');
      }
    } catch(e) {
      toast('Ошибка', e.message, 'err');
    }
  }
  
  // ============================================
  // QR КОДЫ
  // ============================================
  
  function generateQRCode(eq) {
    const container = $('#qrCodeContainer');
    if (!container) return;
    
    const qrData = JSON.stringify({
      type: 'ASGARD_EQ',
      inv: eq.inventory_number,
      id: eq.id
    });
    
    // Используем библиотеку QRCode (нужно подключить)
    if (typeof QRCode !== 'undefined') {
      container.innerHTML = '';
      new QRCode(container, {
        text: qrData,
        width: 200,
        height: 200
      });
    } else {
      // Fallback - показываем данные
      container.innerHTML = `
        <div style="padding:20px;background:#f0f0f0;border-radius:8px;font-family:monospace;font-size:12px">
          ${esc(qrData)}
        </div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:8px">
          QRCode.js не загружен
        </p>
      `;
    }
  }
  
  function printQRCodes() {
    const selected = Array.from($$('.eq-checkbox:checked')).map(cb => cb.dataset.id);
    
    if (selected.length === 0) {
      toast('Ошибка', 'Выберите оборудование для печати QR', 'err');
      return;
    }
    
    toast('Информация', 'Печать QR для ' + selected.length + ' позиций', 'info');
    // TODO: Открыть страницу печати QR
  }
  
  // ============================================
  // ЭКСПОРТ
  // ============================================
  
  async function exportToExcel() {
    toast('Информация', 'Экспорт в Excel...', 'info');
    // TODO: Реализовать экспорт
  }
  
  // ============================================
  // МОЁ ОБОРУДОВАНИЕ (ДЛЯ РП)
  // ============================================
  
  async function showMyEquipment(userId) {
    const auth = await AsgardAuth.getAuth();
    const headers = { 'Authorization': 'Bearer ' + auth.token };
    
    try {
      const resp = await fetch('/api/equipment/by-holder/' + userId, { headers });
      const data = await resp.json();
      
      if (!data.equipment || data.equipment.length === 0) {
        toast('Информация', 'У вас нет закреплённого оборудования', 'info');
        return;
      }
      
      const html = `
        <div class="my-equipment-list">
          ${data.equipment.map(eq => `
            <div class="my-eq-item">
              <div class="my-eq-icon">${eq.category_icon || '📦'}</div>
              <div class="my-eq-info">
                <div class="my-eq-name">${esc(eq.name)}</div>
                <div class="my-eq-details">${esc(eq.inventory_number)} | ${eq.object_name || '—'}</div>
              </div>
              <button class="btn mini" onclick="AsgardWarehouse.doReturn(${eq.id}); AsgardUI.closeModal();">📥 Вернуть</button>
            </div>
          `).join('')}
        </div>
        
        <style>
          .my-equipment-list { max-height: 400px; overflow-y: auto; }
          .my-eq-item { display: flex; align-items: center; gap: 12px; padding: 12px; border-bottom: 1px solid var(--border); }
          .my-eq-icon { font-size: 24px; }
          .my-eq-info { flex: 1; }
          .my-eq-name { font-weight: 500; }
          .my-eq-details { font-size: 12px; color: var(--text-muted); }
        </style>
      `;
      
      showModal('📋 Моё оборудование (' + data.equipment.length + ')', html);
      
    } catch(e) {
      toast('Ошибка', 'Не удалось загрузить', 'err');
    }
  }
  
  // Публичный API
  return {
    render,
    openEquipmentCard,
    doReturn,
    executeTransfer,
    rejectRequest
  };
})();

// Алиас
window.AsgardEquipmentPage = window.AsgardWarehouse;
