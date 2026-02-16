/**
 * АСГАРД CRM — Модуль Склада
 * Учёт ТМЦ, оборудования, инструментов
 */

window.AsgardWarehouse = (function(){
  const { $, $$, esc, toast, showModal, closeModal, confirm } = AsgardUI;
  
  let currentFilters = {};
  let equipment = [];
  let categories = [];
  let objects = [];
  let warehouses = [];
  
  // Статусы оборудования
  const STATUSES = {
    'on_warehouse': { label: 'На складе', color: '#22c55e', icon: '📦' },
    'issued': { label: 'Выдано', color: '#3b82f6', icon: '👤' },
    'in_transit': { label: 'В пути', color: '#f59e0b', icon: '🚚' },
    'repair': { label: 'В ремонте', color: '#f97316', icon: '🔧' },
    'broken': { label: 'Сломано', color: '#ef4444', icon: '❌' },
    'written_off': { label: 'Списано', color: '#6b7280', icon: '🗑️' }
  };
  
  // Состояния
  const CONDITIONS = {
    'new': { label: 'Новое', color: '#22c55e' },
    'good': { label: 'Хорошее', color: '#3b82f6' },
    'satisfactory': { label: 'Удовл.', color: '#f59e0b' },
    'poor': { label: 'Плохое', color: '#f97316' },
    'broken': { label: 'Сломано', color: '#ef4444' }
  };
  
  // ============================================
  // ЗАГРУЗКА ДАННЫХ
  // ============================================
  
  async function loadCategories() {
    try {
      const resp = await fetch('/api/equipment/categories');
      const data = await resp.json();
      categories = data.categories || [];
    } catch(e) {
      categories = [];
    }
  }
  
  async function loadObjects() {
    try {
      const resp = await fetch('/api/equipment/objects');
      const data = await resp.json();
      objects = data.objects || [];
    } catch(e) {
      objects = [];
    }
  }
  
  async function loadWarehouses() {
    try {
      const resp = await fetch('/api/equipment/warehouses');
      const data = await resp.json();
      warehouses = data.warehouses || [];
    } catch(e) {
      warehouses = [];
    }
  }
  
  async function loadEquipment(filters = {}) {
    const auth = await AsgardAuth.getAuth();
    const params = new URLSearchParams(filters);
    
    try {
      const resp = await fetch('/api/equipment?' + params.toString(), {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const data = await resp.json();
      equipment = data.equipment || [];
      return data;
    } catch(e) {
      equipment = [];
      return { equipment: [], stats: {} };
    }
  }
  
  // ============================================
  // ГЛАВНАЯ СТРАНИЦА СКЛАДА
  // ============================================
  
  async function render({ layout, title }) {
    await Promise.all([loadCategories(), loadObjects(), loadWarehouses()]);
    const data = await loadEquipment(currentFilters);
    const auth = await AsgardAuth.getAuth();
    const role = auth?.user?.role || 'USER';
    const canEdit = ['ADMIN', 'WAREHOUSE', 'DIRECTOR', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role);
    const isDirector = ['ADMIN', 'DIRECTOR', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role);
    
    const stats = data.stats || {};
    
    // Форматирование денег
    const formatMoney = (v) => (v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₽';
    
    // Опции фильтров
    const categoryOptions = categories.map(c => 
      `<option value="${c.id}" ${currentFilters.category_id == c.id ? 'selected' : ''}>${c.icon || ''} ${esc(c.name)}</option>`
    ).join('');
    
    const objectOptions = objects.map(o => 
      `<option value="${o.id}" ${currentFilters.object_id == o.id ? 'selected' : ''}>${esc(o.name)}</option>`
    ).join('');
    
    const statusOptions = Object.entries(STATUSES).map(([k, v]) => 
      `<option value="${k}" ${currentFilters.status === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`
    ).join('');
    
    const html = `
      <div class="warehouse-page">
        <!-- Статистика -->
        <div class="stats-row" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px">
          <div style="background:var(--bg-card);padding:16px;border-radius:var(--radius-md);text-align:center">
            <div style="font-size:26px;font-weight:700;color:var(--gold)">${stats.total || 0}</div>
            <div style="font-size:12px;color:var(--text-muted)">Всего ТМЦ</div>
          </div>
          <div style="background:var(--bg-card);padding:16px;border-radius:var(--radius-md);text-align:center">
            <div style="font-size:26px;font-weight:700;color:var(--green)">${stats.on_warehouse || 0}</div>
            <div style="font-size:12px;color:var(--text-muted)">На складе</div>
          </div>
          <div style="background:var(--bg-card);padding:16px;border-radius:var(--radius-md);text-align:center">
            <div style="font-size:26px;font-weight:700;color:var(--blue)">${stats.issued || 0}</div>
            <div style="font-size:12px;color:var(--text-muted)">Выдано</div>
          </div>
          <div style="background:var(--bg-card);padding:16px;border-radius:var(--radius-md);text-align:center">
            <div style="font-size:26px;font-weight:700;color:var(--warning)">${stats.in_repair || 0}</div>
            <div style="font-size:12px;color:var(--text-muted)">В ремонте</div>
          </div>
          ${isDirector ? `
            <div style="background:linear-gradient(135deg,#1e3a5f,#2a3b66);padding:16px;border-radius:6px;text-align:center;border:1px solid var(--accent)">
              <div style="font-size:22px;font-weight:700;color:#f5d78e">${formatMoney(stats.total_book_value)}</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.7)">Балансовая стоимость</div>
              <div style="font-size:10px;color:var(--text-muted);margin-top:4px">
                Закупка: ${formatMoney(stats.total_purchase_value)}
              </div>
            </div>
          ` : ''}
        </div>
        
        <!-- Панель действий -->
        <div class="toolbar" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;align-items:center">
          <input type="text" class="inp" id="searchEquip" placeholder="🔍 Поиск по названию, инв.номеру..." style="flex:1;min-width:200px" value="${esc(currentFilters.search || '')}"/>
          
          <select class="inp" id="filterCategory" style="width:160px">
            <option value="">Все категории</option>
            ${categoryOptions}
          </select>
          
          <select class="inp" id="filterStatus" style="width:140px">
            <option value="">Все статусы</option>
            ${statusOptions}
          </select>
          
          <select class="inp" id="filterObject" style="width:160px">
            <option value="">Все объекты</option>
            ${objectOptions}
          </select>
          
          ${canEdit ? `
            <button class="btn primary" id="btnAddEquip">➕ Добавить</button>
            <button class="btn" id="btnBulkAdd">📋 Массово</button>
            <button class="btn" id="btnScanQR">📷 Сканировать QR</button>
            <button class="btn" id="btnRequests">📋 Запросы</button>
          ` : ''}
          
          <button class="btn ghost" id="btnPrintQR" title="Печать QR-кодов">🏷️ Печать QR</button>
        </div>
        
        <!-- Таблица оборудования -->
        <div class="table-wrap" style="background:var(--bg-card);border-radius:6px;overflow:hidden">
          <table class="tbl" id="equipmentTable">
            <thead>
              <tr>
                <th style="width:40px"><input type="checkbox" id="selectAll"/></th>
                <th>Инв. №</th>
                <th>Наименование</th>
                <th>Категория</th>
                <th>Статус</th>
                <th>Состояние</th>
                <th>Местоположение</th>
                <th>Ответственный</th>
                ${isDirector ? '<th>Балансовая ст.</th>' : ''}
                <th style="width:100px">Действия</th>
              </tr>
            </thead>
            <tbody id="equipmentBody">
              ${renderEquipmentRows(equipment, canEdit, isDirector)}
            </tbody>
          </table>
        </div>
        
        ${equipment.length === 0 ? `
          <div style="text-align:center;padding:40px;color:var(--text-muted)">
            <div style="font-size:48px;margin-bottom:16px">📦</div>
            <div>Оборудование не найдено</div>
          </div>
        ` : ''}
      </div>
    `;
    
    await layout(html, { title: title || 'Склад ТМЦ', motto: 'Учёт оборудования и инструментов' });
    bindEvents(canEdit, role, isDirector);
  }
  
  function renderEquipmentRows(items, canEdit, isDirector = false) {
    if (!items.length) return '';
    
    const formatMoney = (v) => (v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    
    return items.map(eq => {
      const status = STATUSES[eq.status] || STATUSES.on_warehouse;
      const condition = CONDITIONS[eq.condition] || CONDITIONS.good;
      
      const location = eq.status === 'on_warehouse' 
        ? `📦 ${esc(eq.warehouse_name || 'Склад')}`
        : eq.object_name 
          ? `📍 ${esc(eq.object_name)}`
          : '—';
      
      const holder = eq.holder_name ? `👤 ${esc(eq.holder_name)}` : '—';
      
      return `
        <tr data-id="${eq.id}">
          <td><input type="checkbox" class="eq-check" value="${eq.id}"/></td>
          <td><code style="font-size:12px">${esc(eq.inventory_number)}</code></td>
          <td>
            <a href="#" class="eq-link" data-id="${eq.id}" style="font-weight:600">${esc(eq.name)}</a>
            ${eq.serial_number ? `<div style="font-size:11px;color:var(--text-muted)">S/N: ${esc(eq.serial_number)}</div>` : ''}
          </td>
          <td>${eq.category_icon || ''} ${esc(eq.category_name || '—')}</td>
          <td><span class="badge" style="background:${status.color}20;color:${status.color};border:1px solid ${status.color}40">${status.icon} ${status.label}</span></td>
          <td><span style="color:${condition.color}">${condition.label}</span></td>
          <td style="font-size:13px">${location}</td>
          <td style="font-size:13px">${holder}</td>
          ${isDirector ? `<td style="font-size:13px;text-align:right">${formatMoney(eq.book_value)} ₽</td>` : ''}
          <td>
            <div class="row" style="gap:4px">
              ${canEdit && eq.status === 'on_warehouse' ? `
                <button class="btn mini" data-action="issue" data-id="${eq.id}" title="Выдать">📤</button>
              ` : ''}
              ${canEdit && eq.status === 'issued' ? `
                <button class="btn mini" data-action="return" data-id="${eq.id}" title="Вернуть">📥</button>
              ` : ''}
              <button class="btn mini ghost" data-action="qr" data-id="${eq.id}" title="QR-код">🏷️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }
  
  function bindEvents(canEdit, role, isDirector) {
    // Поиск
    let searchTimeout;
    $('#searchEquip')?.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        currentFilters.search = e.target.value;
        refreshTable(isDirector);
      }, 300);
    });
    
    // Фильтры
    $('#filterCategory')?.addEventListener('change', (e) => {
      currentFilters.category_id = e.target.value;
      refreshTable(isDirector);
    });
    
    $('#filterStatus')?.addEventListener('change', (e) => {
      currentFilters.status = e.target.value;
      refreshTable(isDirector);
    });
    
    $('#filterObject')?.addEventListener('change', (e) => {
      currentFilters.object_id = e.target.value;
      refreshTable(isDirector);
    });
    
    // Добавить оборудование
    $('#btnAddEquip')?.addEventListener('click', () => openEquipmentForm());
    
    // Массовое добавление
    $('#btnBulkAdd')?.addEventListener('click', () => openBulkAddForm());
    
    // Сканировать QR
    $('#btnScanQR')?.addEventListener('click', () => openQRScanner());
    
    // Запросы
    $('#btnRequests')?.addEventListener('click', () => openRequestsModal());
    
    // Печать QR
    $('#btnPrintQR')?.addEventListener('click', () => printSelectedQR());
    
    // Выбрать все
    $('#selectAll')?.addEventListener('change', (e) => {
      $$('.eq-check').forEach(cb => cb.checked = e.target.checked);
    });
    
    // Клики по таблице
    $('#equipmentTable')?.addEventListener('click', async (e) => {
      const link = e.target.closest('.eq-link');
      if (link) {
        e.preventDefault();
        openEquipmentCard(link.dataset.id);
        return;
      }
      
      const btn = e.target.closest('[data-action]');
      if (btn) {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        
        if (action === 'issue') openIssueModal(id);
        else if (action === 'return') openReturnModal(id);
        else if (action === 'qr') showQRCode(id);
      }
    });
  }
  
  async function refreshTable(isDirector = false) {
    const data = await loadEquipment(currentFilters);
    const auth = await AsgardAuth.getAuth();
    const canEdit = ['ADMIN', 'WAREHOUSE', 'DIRECTOR', 'DIRECTOR_GEN'].includes(auth?.user?.role);
    
    const tbody = $('#equipmentBody');
    if (tbody) {
      tbody.innerHTML = renderEquipmentRows(data.equipment || [], canEdit, isDirector);
    }
  }
  
  // ============================================
  // QR-СКАНЕР
  // ============================================
  
  async function openQRScanner() {
    const html = `
      <div class="qr-scanner-container">
        <div style="text-align:center;margin-bottom:16px">
          <p>Наведите камеру на QR-код оборудования</p>
        </div>
        
        <div id="qrReaderDiv" style="width:100%;max-width:400px;margin:0 auto"></div>
        
        <div style="margin-top:16px;text-align:center">
          <p style="font-size:12px;color:var(--text-muted)">Или введите инвентарный номер / UUID:</p>
          <div class="row" style="gap:8px;justify-content:center;margin-top:8px">
            <input type="text" class="inp" id="manualQRInput" placeholder="TOOL-26-0001 или UUID" style="width:250px"/>
            <button class="btn primary" id="btnManualSearch">🔍 Найти</button>
          </div>
        </div>
        
        <div id="qrScanResult" style="margin-top:16px"></div>
        
        <div class="row" style="gap:10px;justify-content:center;margin-top:20px">
          <button class="btn ghost" onclick="AsgardUI.closeModal()">Закрыть</button>
        </div>
      </div>
    `;
    
    showModal('📷 Сканирование QR-кода', html, { width: '500px' });
    
    // Инициализация камеры (используем простой input file для мобильных)
    const readerDiv = $('#qrReaderDiv');
    if (readerDiv) {
      readerDiv.innerHTML = `
        <div style="text-align:center;padding:20px;border:2px dashed var(--border);border-radius:6px">
          <input type="file" id="qrFileInput" accept="image/*" capture="environment" style="display:none"/>
          <button class="btn primary" id="btnCaptureQR" style="font-size:18px;padding:16px 32px">
            📷 Сфотографировать QR
          </button>
          <p style="margin-top:12px;font-size:12px;color:var(--text-muted)">
            Нажмите для захвата QR-кода камерой
          </p>
        </div>
      `;
      
      $('#btnCaptureQR')?.addEventListener('click', () => {
        $('#qrFileInput')?.click();
      });
      
      $('#qrFileInput')?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
          // Простой способ: отправляем на сервер для декодирования или используем jsQR
          toast('Обработка', 'Анализ QR-кода...', 'ok');
          // Для MVP просто запрашиваем ввести вручную
          $('#manualQRInput')?.focus();
        }
      });
    }
    
    // Ручной поиск
    $('#btnManualSearch')?.addEventListener('click', async () => {
      const query = $('#manualQRInput')?.value?.trim();
      if (!query) return;
      
      await searchByQR(query);
    });
    
    $('#manualQRInput')?.addEventListener('keypress', async (e) => {
      if (e.key === 'Enter') {
        const query = e.target.value.trim();
        if (query) await searchByQR(query);
      }
    });
  }
  
  async function searchByQR(query) {
    const resultDiv = $('#qrScanResult');
    const auth = await AsgardAuth.getAuth();
    
    try {
      const resp = await fetch('/api/equipment/by-qr/' + encodeURIComponent(query), {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const data = await resp.json();
      
      if (data.success && data.equipment) {
        const eq = data.equipment;
        const status = STATUSES[eq.status] || STATUSES.on_warehouse;
        
        resultDiv.innerHTML = `
          <div style="padding:16px;background:var(--bg);border-radius:6px;border:2px solid var(--accent)">
            <div style="display:flex;gap:12px;align-items:center">
              <div style="font-size:32px">${eq.category_icon || '📦'}</div>
              <div style="flex:1">
                <div style="font-weight:700;font-size:16px">${esc(eq.name)}</div>
                <div style="font-size:12px;color:var(--text-muted)">Инв. № ${esc(eq.inventory_number)}</div>
                <div style="margin-top:8px">
                  <span class="badge" style="background:${status.color}20;color:${status.color};border:1px solid ${status.color}40">${status.icon} ${status.label}</span>
                </div>
                ${eq.holder_name ? `<div style="font-size:12px;margin-top:4px">👤 ${esc(eq.holder_name)}</div>` : ''}
              </div>
            </div>
            <div class="row" style="gap:8px;margin-top:12px;justify-content:flex-end">
              ${eq.status === 'on_warehouse' ? `
                <button class="btn primary" onclick="AsgardUI.closeModal();AsgardWarehouse.openIssueModal(${eq.id})">📤 Выдать</button>
              ` : ''}
              ${eq.status === 'issued' ? `
                <button class="btn primary" onclick="AsgardUI.closeModal();AsgardWarehouse.openReturnModal(${eq.id})">📥 Вернуть</button>
              ` : ''}
              <button class="btn" onclick="AsgardUI.closeModal();AsgardWarehouse.openEquipmentCard(${eq.id})">📋 Карточка</button>
            </div>
          </div>
        `;
      } else {
        resultDiv.innerHTML = `
          <div style="padding:16px;background:#fef2f2;border-radius:6px;color:#dc2626;text-align:center">
            ❌ Оборудование не найдено
          </div>
        `;
      }
    } catch(e) {
      resultDiv.innerHTML = `<div style="color:#ef4444">Ошибка: ${esc(e.message)}</div>`;
    }
  }
  
  // ============================================
  // ПЕЧАТЬ QR-КОДОВ
  // ============================================
  
  async function printSelectedQR() {
    const selected = Array.from($$('.eq-check:checked')).map(cb => parseInt(cb.value));
    
    if (selected.length === 0) {
      toast('Внимание', 'Выберите оборудование для печати QR-кодов', 'warn');
      return;
    }
    
    const auth = await AsgardAuth.getAuth();
    
    try {
      const resp = await fetch('/api/equipment/qr-print-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + auth.token
        },
        body: JSON.stringify({ equipment_ids: selected })
      });
      
      const data = await resp.json();
      
      if (!data.success || !data.items?.length) {
        toast('Ошибка', 'Не удалось получить данные', 'err');
        return;
      }
      
      openQRPrintPreview(data.items);
    } catch(e) {
      toast('Ошибка', e.message, 'err');
    }
  }
  
  function openQRPrintPreview(items) {
    const qrCards = items.map(item => {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(item.qr_uuid || item.inventory_number)}`;
      
      return `
        <div class="qr-print-card" style="width:200px;padding:16px;border:1px solid #ccc;text-align:center;page-break-inside:avoid;display:inline-block;margin:8px">
          <img src="${qrUrl}" alt="QR" style="width:150px;height:150px"/>
          <div style="font-weight:700;font-size:14px;margin-top:8px">${esc(item.inventory_number)}</div>
          <div style="font-size:11px;color:#666;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.name)}</div>
          ${item.serial_number ? `<div style="font-size:10px;color:#999">S/N: ${esc(item.serial_number)}</div>` : ''}
        </div>
      `;
    }).join('');
    
    const html = `
      <div>
        <div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
          <div>Выбрано: <b>${items.length}</b> QR-кодов</div>
          <button class="btn primary" id="btnDoPrint">🖨️ Печать</button>
        </div>
        
        <div id="qrPrintArea" style="max-height:500px;overflow-y:auto;background:#fff;padding:16px;border-radius:6px">
          ${qrCards}
        </div>
      </div>
    `;
    
    showModal('🏷️ Печать QR-кодов', html, { width: '700px' });
    
    $('#btnDoPrint')?.addEventListener('click', () => {
      const printContent = $('#qrPrintArea').innerHTML;
      const printWindow = window.open('', '_blank');
      printWindow.document.write(`
        <html>
          <head>
            <title>QR-коды АСГАРД</title>
            <style>
              body { font-family: Arial, sans-serif; }
              .qr-print-card { width:200px; padding:16px; border:1px solid #ccc; text-align:center; page-break-inside:avoid; display:inline-block; margin:8px; }
              @media print {
                .qr-print-card { break-inside: avoid; }
              }
            </style>
          </head>
          <body>${printContent}</body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 500);
    });
  }
  
  // ============================================
  // МАССОВОЕ ДОБАВЛЕНИЕ
  // ============================================
  
  async function openBulkAddForm() {
    const categoryOptions = categories.map(c => 
      `<option value="${c.id}">${c.icon || ''} ${esc(c.name)}</option>`
    ).join('');
    
    const html = `
      <div class="stack" style="gap:16px">
        <p style="color:var(--text-muted)">Добавьте несколько единиц оборудования одного типа. После создания можно будет распечатать QR-коды.</p>
        
        <div class="formrow">
          <div style="grid-column:1/-1">
            <label>Категория *</label>
            <select class="inp" id="bulk_category">${categoryOptions}</select>
          </div>
        </div>
        
        <div>
          <label>Общие данные</label>
          <div class="formrow">
            <div>
              <input class="inp" id="bulk_brand" placeholder="Бренд"/>
            </div>
            <div>
              <input class="inp" id="bulk_model" placeholder="Модель"/>
            </div>
          </div>
        </div>
        
        <div>
          <label>Цена за единицу (₽)</label>
          <input class="inp" id="bulk_price" type="number" step="0.01"/>
        </div>
        
        <div class="formrow">
          <div>
            <label>Срок исп. (мес.)</label>
            <input class="inp" id="bulk_useful" type="number" value="60"/>
          </div>
          <div>
            <label>Ликвид. стоимость</label>
            <input class="inp" id="bulk_salvage" type="number" value="0"/>
          </div>
        </div>
        
        <div>
          <label>Список оборудования (по одному на строку)</label>
          <textarea class="inp" id="bulk_items" rows="8" placeholder="Дрель Bosch GBH 2-26&#10;Дрель Bosch GBH 2-26&#10;Болгарка Makita GA5030&#10;..."></textarea>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
            Формат: Название | Серийный номер (опционально)
          </div>
        </div>
        
        <div class="row" style="gap:10px;justify-content:flex-end;margin-top:16px">
          <button class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>
          <button class="btn primary" id="btnBulkCreate">📦 Создать и получить QR</button>
        </div>
      </div>
    `;
    
    showModal('📋 Массовое добавление ТМЦ', html, { width: '600px' });
    
    $('#btnBulkCreate')?.addEventListener('click', async () => {
      const category_id = $('#bulk_category').value;
      const brand = $('#bulk_brand').value;
      const model = $('#bulk_model').value;
      const price = parseFloat($('#bulk_price').value) || null;
      const useful_life_months = parseInt($('#bulk_useful').value) || 60;
      const salvage_value = parseFloat($('#bulk_salvage').value) || 0;
      const itemsText = $('#bulk_items').value.trim();
      
      if (!itemsText) {
        toast('Ошибка', 'Введите список оборудования', 'err');
        return;
      }
      
      const lines = itemsText.split('\n').filter(l => l.trim());
      const items = lines.map(line => {
        const parts = line.split('|').map(p => p.trim());
        return {
          name: (brand && model) ? `${brand} ${model}` : parts[0],
          serial_number: parts[1] || null,
          category_id,
          purchase_price: price,
          purchase_date: new Date().toISOString().slice(0, 10),
          useful_life_months,
          salvage_value
        };
      });
      
      if (items.length === 0) {
        toast('Ошибка', 'Нет позиций для создания', 'err');
        return;
      }
      
      const auth = await AsgardAuth.getAuth();
      
      try {
        const resp = await fetch('/api/equipment/bulk-create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + auth.token
          },
          body: JSON.stringify({ items })
        });
        
        const data = await resp.json();
        
        if (data.success && data.created?.length) {
          closeModal();
          toast('Создано', `Добавлено ${data.count} единиц`, 'ok');
          
          // Сразу открываем печать QR
          const ids = data.created.map(c => c.id);
          const qrResp = await fetch('/api/equipment/qr-print-data', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + auth.token
            },
            body: JSON.stringify({ equipment_ids: ids })
          });
          const qrData = await qrResp.json();
          if (qrData.items?.length) {
            openQRPrintPreview(qrData.items);
          }
          
          refreshTable();
        } else {
          toast('Ошибка', data.message || 'Не удалось создать', 'err');
        }
      } catch(e) {
        toast('Ошибка', e.message, 'err');
      }
    });
  }
  
  // ============================================
  // ФОРМА ДОБАВЛЕНИЯ/РЕДАКТИРОВАНИЯ
  // ============================================
  
  async function openEquipmentForm(equipId = null) {
    let eq = {};
    if (equipId) {
      const auth = await AsgardAuth.getAuth();
      const resp = await fetch('/api/equipment/' + equipId, {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const data = await resp.json();
      eq = data.equipment || {};
    }
    
    const categoryOptions = categories.map(c => 
      `<option value="${c.id}" ${eq.category_id == c.id ? 'selected' : ''}>${c.icon || ''} ${esc(c.name)}</option>`
    ).join('');
    
    // Загружаем счета для выбора
    let invoiceOptions = '<option value="">— Без привязки —</option>';
    try {
      const auth = await AsgardAuth.getAuth();
      const resp = await fetch('/api/invoices?limit=50', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const data = await resp.json();
      (data.invoices || []).forEach(inv => {
        invoiceOptions += `<option value="${inv.id}" ${eq.invoice_id == inv.id ? 'selected' : ''}>${esc(inv.invoice_number)} — ${esc(inv.customer_name || '')}</option>`;
      });
    } catch(e) {}
    
    const html = `
      <div class="stack" style="gap:16px;max-height:70vh;overflow-y:auto">
        <div class="formrow">
          <div style="grid-column:1/-1">
            <label>Наименование *</label>
            <input class="inp" id="eq_name" value="${esc(eq.name || '')}" required/>
          </div>
        </div>
        
        <div class="formrow">
          <div>
            <label>Категория *</label>
            <select class="inp" id="eq_category">${categoryOptions}</select>
          </div>
          <div>
            <label>Заводской номер</label>
            <input class="inp" id="eq_serial" value="${esc(eq.serial_number || '')}"/>
          </div>
        </div>
        
        <div class="formrow">
          <div>
            <label>Бренд / Производитель</label>
            <input class="inp" id="eq_brand" value="${esc(eq.brand || '')}"/>
          </div>
          <div>
            <label>Модель</label>
            <input class="inp" id="eq_model" value="${esc(eq.model || '')}"/>
          </div>
        </div>
        
        <div class="formrow">
          <div>
            <label>Количество</label>
            <input class="inp" id="eq_qty" type="number" step="0.001" value="${eq.quantity || 1}"/>
          </div>
          <div>
            <label>Ед. изм.</label>
            <select class="inp" id="eq_unit">
              <option value="шт" ${eq.unit === 'шт' ? 'selected' : ''}>шт</option>
              <option value="м" ${eq.unit === 'м' ? 'selected' : ''}>м</option>
              <option value="кг" ${eq.unit === 'кг' ? 'selected' : ''}>кг</option>
              <option value="л" ${eq.unit === 'л' ? 'selected' : ''}>л</option>
              <option value="компл" ${eq.unit === 'компл' ? 'selected' : ''}>компл</option>
            </select>
          </div>
        </div>
        
        <hr style="border-color:var(--border)"/>
        <div style="font-weight:600;color:var(--accent)">💰 Финансы и амортизация</div>
        
        <div class="formrow">
          <div>
            <label>Цена закупки (₽) *</label>
            <input class="inp" id="eq_price" type="number" step="0.01" value="${eq.purchase_price || ''}"/>
          </div>
          <div>
            <label>Дата закупки</label>
            <input class="inp" id="eq_date" type="date" value="${eq.purchase_date ? eq.purchase_date.slice(0,10) : new Date().toISOString().slice(0,10)}"/>
          </div>
        </div>
        
        <div class="formrow">
          <div style="grid-column:1/-1">
            <label>Счёт закупки (авто-постановка на баланс)</label>
            <select class="inp" id="eq_invoice">${invoiceOptions}</select>
          </div>
        </div>
        
        <div class="formrow">
          <div>
            <label>Срок полезного использования (мес.)</label>
            <input class="inp" id="eq_useful_life" type="number" value="${eq.useful_life_months || 60}" min="1"/>
            <div style="font-size:10px;color:var(--text-muted)">Для расчёта амортизации</div>
          </div>
          <div>
            <label>Ликвидационная стоимость (₽)</label>
            <input class="inp" id="eq_salvage" type="number" step="0.01" value="${eq.salvage_value || 0}"/>
            <div style="font-size:10px;color:var(--text-muted)">Остаток после полной амортизации</div>
          </div>
        </div>
        
        <div>
          <label>
            <input type="checkbox" id="eq_auto_writeoff" ${eq.auto_write_off !== false ? 'checked' : ''}/>
            Автоматическое списание по истечении срока
          </label>
        </div>
        
        <hr style="border-color:var(--border)"/>
        <div style="font-weight:600;color:var(--accent)">🔧 ТО и гарантия</div>
        
        <div class="formrow">
          <div>
            <label>Гарантия до</label>
            <input class="inp" id="eq_warranty" type="date" value="${eq.warranty_end ? eq.warranty_end.slice(0,10) : ''}"/>
          </div>
          <div>
            <label>Интервал ТО (дней)</label>
            <input class="inp" id="eq_maintenance" type="number" value="${eq.maintenance_interval_days || ''}"/>
          </div>
        </div>
        
        <div>
          <label>Примечания</label>
          <textarea class="inp" id="eq_notes" rows="2">${esc(eq.notes || '')}</textarea>
        </div>
        
        <div class="row" style="gap:10px;justify-content:flex-end;margin-top:16px">
          <button class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>
          <button class="btn primary" id="btnSaveEquip">${equipId ? 'Сохранить' : '➕ Добавить и получить QR'}</button>
        </div>
      </div>
    `;
    
    showModal(equipId ? '✏️ Редактирование ТМЦ' : '➕ Новое оборудование', html, { width: '600px' });
    
    $('#btnSaveEquip')?.addEventListener('click', async () => {
      const name = $('#eq_name').value.trim();
      if (!name) {
        toast('Ошибка', 'Укажите наименование', 'err');
        return;
      }
      
      const payload = {
        name,
        category_id: $('#eq_category').value || null,
        serial_number: $('#eq_serial').value || null,
        brand: $('#eq_brand').value || null,
        model: $('#eq_model').value || null,
        quantity: parseFloat($('#eq_qty').value) || 1,
        unit: $('#eq_unit').value,
        purchase_price: parseFloat($('#eq_price').value) || null,
        purchase_date: $('#eq_date').value || null,
        invoice_id: $('#eq_invoice').value || null,
        useful_life_months: parseInt($('#eq_useful_life').value) || 60,
        salvage_value: parseFloat($('#eq_salvage').value) || 0,
        auto_write_off: $('#eq_auto_writeoff').checked,
        warranty_end: $('#eq_warranty').value || null,
        maintenance_interval_days: parseInt($('#eq_maintenance').value) || null,
        notes: $('#eq_notes').value || null
      };
      
      const auth = await AsgardAuth.getAuth();
      const url = equipId ? '/api/equipment/' + equipId : '/api/equipment';
      const method = equipId ? 'PUT' : 'POST';
      
      try {
        const resp = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + auth.token
          },
          body: JSON.stringify(payload)
        });
        
        const data = await resp.json();
        if (data.success) {
          closeModal();
          toast('Успешно', equipId ? 'Оборудование обновлено' : 'Оборудование добавлено', 'ok');
          
          // Для нового оборудования показываем QR-код
          if (!equipId && data.equipment) {
            showQRCode(data.equipment.id);
          }
          
          refreshTable();
        } else {
          toast('Ошибка', data.message || 'Не удалось сохранить', 'err');
        }
      } catch(e) {
        toast('Ошибка', e.message, 'err');
      }
    });
  }
  
  // ============================================
  // ВЫДАЧА ОБОРУДОВАНИЯ
  // ============================================
  
  async function openIssueModal(equipId) {
    const auth = await AsgardAuth.getAuth();
    
    // Загружаем данные оборудования
    const eqResp = await fetch('/api/equipment/' + equipId, {
      headers: { 'Authorization': 'Bearer ' + auth.token }
    });
    const eqData = await eqResp.json();
    const eq = eqData.equipment;
    
    if (!eq) {
      toast('Ошибка', 'Оборудование не найдено', 'err');
      return;
    }
    
    // Загружаем РП
    let pmOptions = '';
    try {
      const resp = await fetch('/api/users?role=PM', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const data = await resp.json();
      (data.users || []).forEach(u => {
        pmOptions += `<option value="${u.id}">${esc(u.name)}</option>`;
      });
    } catch(e) {}
    
    // Загружаем работы
    let workOptions = '<option value="">— Выберите работу —</option>';
    try {
      const resp = await fetch('/api/works?status=active&limit=50', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const data = await resp.json();
      (data.works || []).forEach(w => {
        workOptions += `<option value="${w.id}">${esc(w.work_number || '')} — ${esc(w.work_title || w.customer_name || '')}</option>`;
      });
    } catch(e) {}
    
    const objectOptions = objects.map(o => 
      `<option value="${o.id}">${esc(o.name)}</option>`
    ).join('');
    
    const conditionOptions = Object.entries(CONDITIONS).map(([k, v]) => 
      `<option value="${k}" ${k === eq.condition ? 'selected' : ''}>${v.label}</option>`
    ).join('');
    
    const html = `
      <div class="stack" style="gap:16px">
        <div style="padding:12px;background:var(--bg);border-radius:6px">
          <div style="font-weight:600">${eq.category_icon || '📦'} ${esc(eq.name)}</div>
          <div style="font-size:12px;color:var(--text-muted)">Инв. № ${esc(eq.inventory_number)}</div>
        </div>
        
        <div class="formrow">
          <div>
            <label>Кому выдать (РП) *</label>
            <select class="inp" id="issue_holder" required>${pmOptions}</select>
          </div>
          <div>
            <label>Объект *</label>
            <select class="inp" id="issue_object" required>${objectOptions}</select>
          </div>
        </div>
        
        <div>
          <label>Привязка к работе *</label>
          <select class="inp" id="issue_work" required>${workOptions}</select>
        </div>
        
        ${eq.is_consumable ? `
          <div>
            <label>Количество (из ${eq.quantity} ${eq.unit})</label>
            <input class="inp" id="issue_qty" type="number" step="0.001" value="${eq.quantity}" max="${eq.quantity}"/>
          </div>
        ` : ''}
        
        <div>
          <label>Состояние при выдаче</label>
          <select class="inp" id="issue_condition">${conditionOptions}</select>
        </div>
        
        <div>
          <label>Примечание</label>
          <textarea class="inp" id="issue_notes" rows="2" placeholder="Комплектация, особые условия..."></textarea>
        </div>
        
        <div class="row" style="gap:10px;justify-content:flex-end;margin-top:16px">
          <button class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>
          <button class="btn primary" id="btnConfirmIssue">📤 Выдать</button>
        </div>
      </div>
    `;
    
    showModal('📤 Выдача оборудования', html);
    
    $('#btnConfirmIssue')?.addEventListener('click', async () => {
      const holder_id = $('#issue_holder').value;
      const object_id = $('#issue_object').value;
      const work_id = $('#issue_work').value;
      
      if (!holder_id || !work_id) {
        toast('Ошибка', 'Заполните обязательные поля', 'err');
        return;
      }
      
      const payload = {
        equipment_id: equipId,
        holder_id,
        object_id,
        work_id,
        quantity: $('#issue_qty')?.value || eq.quantity,
        condition_after: $('#issue_condition').value,
        notes: $('#issue_notes').value
      };
      
      try {
        const resp = await fetch('/api/equipment/issue', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + auth.token
          },
          body: JSON.stringify(payload)
        });
        
        const data = await resp.json();
        if (data.success) {
          closeModal();
          toast('Выдано', 'Оборудование передано РП', 'ok');
          refreshTable();
        } else {
          toast('Ошибка', data.message, 'err');
        }
      } catch(e) {
        toast('Ошибка', e.message, 'err');
      }
    });
  }
  
  // ============================================
  // ВОЗВРАТ НА СКЛАД
  // ============================================
  
  async function openReturnModal(equipId) {
    const auth = await AsgardAuth.getAuth();
    
    const eqResp = await fetch('/api/equipment/' + equipId, {
      headers: { 'Authorization': 'Bearer ' + auth.token }
    });
    const eqData = await eqResp.json();
    const eq = eqData.equipment;
    
    const conditionOptions = Object.entries(CONDITIONS).map(([k, v]) => 
      `<option value="${k}" ${k === eq.condition ? 'selected' : ''}>${v.label}</option>`
    ).join('');
    
    const html = `
      <div class="stack" style="gap:16px">
        <div style="padding:12px;background:var(--bg);border-radius:6px">
          <div style="font-weight:600">${eq.category_icon || '📦'} ${esc(eq.name)}</div>
          <div style="font-size:12px;color:var(--text-muted)">
            Инв. № ${esc(eq.inventory_number)} • У: ${esc(eq.holder_name || '—')}
          </div>
        </div>
        
        <div>
          <label>Состояние при возврате</label>
          <select class="inp" id="return_condition">${conditionOptions}</select>
        </div>
        
        <div>
          <label>Примечание</label>
          <textarea class="inp" id="return_notes" rows="2" placeholder="Повреждения, недостача комплектации..."></textarea>
        </div>
        
        <div class="row" style="gap:10px;justify-content:flex-end;margin-top:16px">
          <button class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>
          <button class="btn primary" id="btnConfirmReturn">📥 Вернуть на склад</button>
        </div>
      </div>
    `;
    
    showModal('📥 Возврат на склад', html);
    
    $('#btnConfirmReturn')?.addEventListener('click', async () => {
      const payload = {
        equipment_id: equipId,
        condition_after: $('#return_condition').value,
        notes: $('#return_notes').value
      };
      
      try {
        const resp = await fetch('/api/equipment/return', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + auth.token
          },
          body: JSON.stringify(payload)
        });
        
        const data = await resp.json();
        if (data.success) {
          closeModal();
          toast('Возвращено', 'Оборудование на складе', 'ok');
          refreshTable();
        } else {
          toast('Ошибка', data.message, 'err');
        }
      } catch(e) {
        toast('Ошибка', e.message, 'err');
      }
    });
  }
  
  // ============================================
  // КАРТОЧКА ОБОРУДОВАНИЯ
  // ============================================
  
  async function openEquipmentCard(equipId) {
    const auth = await AsgardAuth.getAuth();
    
    try {
      const resp = await fetch('/api/equipment/' + equipId, {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const data = await resp.json();
      
      if (!data.success || !data.equipment) {
        toast('Ошибка', 'Оборудование не найдено', 'err');
        return;
      }
      
      const eq = data.equipment;
      const movements = data.movements || [];
      const maintenance = data.maintenance || [];
      
      const status = STATUSES[eq.status] || STATUSES.on_warehouse;
      const condition = CONDITIONS[eq.condition] || CONDITIONS.good;
      
      const movementsHtml = movements.length ? movements.map(m => {
        const type = {
          'issue': { label: 'Выдача', icon: '📤', color: '#3b82f6' },
          'return': { label: 'Возврат', icon: '📥', color: '#22c55e' },
          'transfer_out': { label: 'Передача (отдал)', icon: '➡️', color: '#f59e0b' },
          'transfer_in': { label: 'Передача (принял)', icon: '⬅️', color: '#f59e0b' },
          'write_off': { label: 'Списание', icon: '🗑️', color: '#ef4444' },
          'repair_start': { label: 'В ремонт', icon: '🔧', color: '#f97316' },
          'repair_end': { label: 'Из ремонта', icon: '✅', color: '#22c55e' }
        }[m.movement_type] || { label: m.movement_type, icon: '📋', color: '#6b7280' };
        
        const date = new Date(m.created_at).toLocaleDateString('ru-RU');
        const time = new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        
        return `
          <div style="padding:10px;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:flex-start">
            <div style="font-size:20px">${type.icon}</div>
            <div style="flex:1">
              <div style="font-weight:600;color:${type.color}">${type.label}</div>
              <div style="font-size:12px;color:var(--text-muted)">
                ${m.from_holder_name ? `От: ${esc(m.from_holder_name)}` : m.from_warehouse_name ? `Со склада: ${esc(m.from_warehouse_name)}` : ''}
                ${m.to_holder_name ? ` → ${esc(m.to_holder_name)}` : m.to_warehouse_name ? ` → ${esc(m.to_warehouse_name)}` : ''}
              </div>
              ${m.work_title ? `<div style="font-size:12px">📋 ${esc(m.work_number || '')} ${esc(m.work_title)}</div>` : ''}
              ${m.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px">${esc(m.notes)}</div>` : ''}
            </div>
            <div style="font-size:11px;color:var(--text-muted);text-align:right">
              ${date}<br/>${time}
            </div>
          </div>
        `;
      }).join('') : '<div style="padding:20px;text-align:center;color:var(--text-muted)">Нет перемещений</div>';
      
      const maintenanceHtml = maintenance.length ? maintenance.map(m => {
        const date = m.completed_at ? new Date(m.completed_at).toLocaleDateString('ru-RU') : '—';
        return `
          <div style="padding:10px;border-bottom:1px solid var(--border)">
            <div style="font-weight:600">${esc(m.maintenance_type === 'repair' ? '🔧 Ремонт' : m.maintenance_type === 'calibration' ? '📏 Поверка' : '🔄 ТО')}</div>
            <div style="font-size:12px">${esc(m.description || '—')}</div>
            <div style="font-size:11px;color:var(--text-muted)">${date} ${m.cost ? '• ' + Number(m.cost).toLocaleString('ru-RU') + ' ₽' : ''}</div>
          </div>
        `;
      }).join('') : '<div style="padding:20px;text-align:center;color:var(--text-muted)">Нет записей</div>';
      
      const html = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          <!-- Левая колонка -->
          <div>
            <div style="background:var(--bg);padding:16px;border-radius:6px;margin-bottom:16px">
              <div style="font-size:24px;margin-bottom:8px">${eq.category_icon || '📦'}</div>
              <div style="font-size:18px;font-weight:700">${esc(eq.name)}</div>
              <div style="font-size:13px;color:var(--text-muted);margin-top:4px">
                ${eq.brand ? esc(eq.brand) : ''} ${eq.model ? esc(eq.model) : ''}
              </div>
              <div style="margin-top:12px;display:flex;gap:8px">
                <span class="badge" style="background:${status.color}20;color:${status.color};border:1px solid ${status.color}40">${status.icon} ${status.label}</span>
                <span class="badge" style="background:${condition.color}20;color:${condition.color};border:1px solid ${condition.color}40">${condition.label}</span>
              </div>
            </div>
            
            <table style="width:100%;font-size:13px">
              <tr><td style="color:var(--text-muted);padding:4px 0">Инв. номер</td><td style="font-weight:600">${esc(eq.inventory_number)}</td></tr>
              <tr><td style="color:var(--text-muted);padding:4px 0">Серийный номер</td><td>${esc(eq.serial_number || '—')}</td></tr>
              <tr><td style="color:var(--text-muted);padding:4px 0">Категория</td><td>${esc(eq.category_name || '—')}</td></tr>
              <tr><td style="color:var(--text-muted);padding:4px 0">Количество</td><td>${eq.quantity} ${eq.unit}</td></tr>
              <tr><td style="color:var(--text-muted);padding:4px 0">Цена</td><td>${eq.purchase_price ? Number(eq.purchase_price).toLocaleString('ru-RU') + ' ₽' : '—'}</td></tr>
              <tr><td style="color:var(--text-muted);padding:4px 0">Дата покупки</td><td>${eq.purchase_date ? new Date(eq.purchase_date).toLocaleDateString('ru-RU') : '—'}</td></tr>
              <tr><td style="color:var(--text-muted);padding:4px 0">Гарантия до</td><td>${eq.warranty_end ? new Date(eq.warranty_end).toLocaleDateString('ru-RU') : '—'}</td></tr>
              <tr><td style="color:var(--text-muted);padding:4px 0">След. ТО</td><td>${eq.next_maintenance ? new Date(eq.next_maintenance).toLocaleDateString('ru-RU') : '—'}</td></tr>
            </table>
            
            ${eq.current_holder_id ? `
              <div style="margin-top:16px;padding:12px;background:var(--bg);border-radius:6px">
                <div style="font-size:12px;color:var(--text-muted)">Текущий ответственный</div>
                <div style="font-weight:600">👤 ${esc(eq.holder_name)}</div>
                ${eq.holder_phone ? `<div style="font-size:12px">${esc(eq.holder_phone)}</div>` : ''}
                ${eq.object_name ? `<div style="font-size:12px">📍 ${esc(eq.object_name)}</div>` : ''}
              </div>
            ` : ''}
          </div>
          
          <!-- Правая колонка: история -->
          <div>
            <div style="font-weight:600;margin-bottom:8px">📜 История перемещений</div>
            <div style="max-height:250px;overflow-y:auto;border:1px solid var(--border);border-radius:6px">
              ${movementsHtml}
            </div>
            
            <div style="font-weight:600;margin:16px 0 8px">🔧 ТО и ремонт</div>
            <div style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:6px">
              ${maintenanceHtml}
            </div>
          </div>
        </div>
        
        <div class="row" style="gap:10px;justify-content:flex-end;margin-top:20px">
          <button class="btn ghost" onclick="AsgardUI.closeModal()">Закрыть</button>
          <button class="btn" onclick="AsgardWarehouse.openEquipmentForm(${eq.id})">✏️ Редактировать</button>
          <button class="btn" onclick="AsgardWarehouse.showQRCode(${eq.id})">🏷️ QR-код</button>
        </div>
      `;
      
      showModal('📋 ' + eq.inventory_number, html, { width: '800px' });
      
    } catch(e) {
      toast('Ошибка', e.message, 'err');
    }
  }
  
  // ============================================
  // QR-КОД
  // ============================================
  
  async function showQRCode(equipId) {
    const auth = await AsgardAuth.getAuth();
    
    const resp = await fetch('/api/equipment/' + equipId, {
      headers: { 'Authorization': 'Bearer ' + auth.token }
    });
    const data = await resp.json();
    const eq = data.equipment;
    
    if (!eq) return;
    
    // Генерируем QR через API или библиотеку
    const qrData = encodeURIComponent(JSON.stringify({
      type: 'ASGARD_EQUIPMENT',
      id: eq.id,
      inv: eq.inventory_number
    }));
    
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${qrData}`;
    
    const html = `
      <div style="text-align:center">
        <img src="${qrUrl}" alt="QR" style="width:200px;height:200px;margin-bottom:16px"/>
        <div style="font-weight:600;font-size:18px">${esc(eq.inventory_number)}</div>
        <div style="color:var(--text-muted)">${esc(eq.name)}</div>
        <div style="margin-top:16px">
          <button class="btn" onclick="window.print()">🖨️ Печать</button>
        </div>
      </div>
    `;
    
    showModal('🏷️ QR-код', html);
  }
  
  function printSelectedQR() {
    const selected = Array.from($$('.eq-check:checked')).map(cb => cb.value);
    if (selected.length === 0) {
      toast('Внимание', 'Выберите оборудование для печати QR', 'warn');
      return;
    }
    
    toast('Печать', `Будет напечатано ${selected.length} QR-кодов`, 'ok');
    // TODO: открыть страницу печати с несколькими QR
  }
  
  // ============================================
  // ЗАПРОСЫ НА ПЕРЕДАЧУ
  // ============================================
  
  async function openRequestsModal() {
    const auth = await AsgardAuth.getAuth();
    
    const resp = await fetch('/api/equipment/requests?status=pending', {
      headers: { 'Authorization': 'Bearer ' + auth.token }
    });
    const data = await resp.json();
    const requests = data.requests || [];
    
    const html = requests.length ? `
      <div style="max-height:400px;overflow-y:auto">
        ${requests.map(r => `
          <div style="padding:12px;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:center">
            <div style="flex:1">
              <div style="font-weight:600">${esc(r.equipment_name)}</div>
              <div style="font-size:12px;color:var(--text-muted)">
                ${esc(r.requester_name)} → ${esc(r.target_holder_name || 'Склад')}
              </div>
              <div style="font-size:12px">📋 ${esc(r.work_number || '')} ${esc(r.work_title || '')}</div>
            </div>
            <div>
              <button class="btn mini primary" data-action="approve" data-id="${r.id}">✅</button>
              <button class="btn mini ghost" data-action="reject" data-id="${r.id}">❌</button>
            </div>
          </div>
        `).join('')}
      </div>
    ` : '<div style="padding:40px;text-align:center;color:var(--text-muted)">Нет активных запросов</div>';
    
    showModal('📋 Запросы на передачу', html);
    
    $$('[data-action="approve"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const requestId = btn.dataset.id;
        try {
          const resp = await fetch('/api/equipment/transfer-execute', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + auth.token
            },
            body: JSON.stringify({ request_id: requestId })
          });
          const data = await resp.json();
          if (data.success) {
            toast('Успешно', 'Передача выполнена', 'ok');
            closeModal();
            refreshTable();
          } else {
            toast('Ошибка', data.message, 'err');
          }
        } catch(e) {
          toast('Ошибка', e.message, 'err');
        }
      });
    });
  }
  
  // ============================================
  // ПУБЛИЧНЫЙ API
  // ============================================
  
  return {
    render,
    openEquipmentForm,
    openEquipmentCard,
    showQRCode,
    openIssueModal,
    openReturnModal,
    refreshTable
  };
})();
