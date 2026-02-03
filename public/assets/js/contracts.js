/**
 * АСГАРД CRM — Реестр договоров
 * Этап 29
 */
window.AsgardContractsPage = (function(){
  
  const CONTRACT_TYPES = [
    { id: 'customer', name: 'Покупатель (заказчик)' },
    { id: 'supplier', name: 'Поставщик' }
  ];
  
  const CONTRACT_STATUSES = [
    { id: 'draft', name: 'Черновик', color: 'var(--text-muted)' },
    { id: 'active', name: 'Действует', color: 'var(--green)' },
    { id: 'expiring', name: 'Истекает', color: 'var(--amber)' },
    { id: 'expired', name: 'Истёк', color: 'var(--red)' },
    { id: 'terminated', name: 'Расторгнут', color: 'var(--red)' }
  ];

  // Получить store договоров
  async function getStore() {
    const db = await AsgardDB.open();
    // Создаём store если не существует
    if (!db.objectStoreNames.contains('contracts')) {
      // Нужно пересоздать через версию БД, пока используем localStorage fallback
    }
    return 'contracts';
  }

  // CRUD операции
  async function getAll() {
    try {
      const db = await AsgardDB.open();
      return await AsgardDB.getAll('contracts') || [];
    } catch(e) {
      // Fallback to localStorage
      const data = localStorage.getItem('asgard_contracts');
      return data ? JSON.parse(data) : [];
    }
  }

  async function save(contract) {
    try {
      const db = await AsgardDB.open();
      await AsgardDB.put('contracts', contract);
    } catch(e) {
      // Fallback
      const all = await getAll();
      const idx = all.findIndex(c => c.id === contract.id);
      if (idx >= 0) all[idx] = contract;
      else all.push(contract);
      localStorage.setItem('asgard_contracts', JSON.stringify(all));
    }
  }

  async function remove(id) {
    try {
      await AsgardDB.delete('contracts', id);
    } catch(e) {
      const all = await getAll();
      const filtered = all.filter(c => c.id !== id);
      localStorage.setItem('asgard_contracts', JSON.stringify(filtered));
    }
  }

  // Вычислить статус на основе дат
  function computeStatus(contract) {
    if (contract.status === 'terminated' || contract.status === 'draft') {
      return contract.status;
    }
    if (!contract.end_date || contract.is_perpetual) {
      return 'active';
    }
    const today = new Date();
    const endDate = new Date(contract.end_date);
    const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
    
    if (daysLeft < 0) return 'expired';
    if (daysLeft <= 30) return 'expiring';
    return 'active';
  }

  // Поиск договоров по контрагенту
  async function findByCounterparty(counterpartyId, type = null) {
    const all = await getAll();
    return all.filter(c => {
      const matchCounterparty = c.counterparty_id === counterpartyId;
      const matchType = !type || c.type === type;
      const isActive = computeStatus(c) === 'active' || computeStatus(c) === 'expiring';
      return matchCounterparty && matchType && isActive;
    });
  }

  // Рендер списка
  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = "#/login"; return; }
    
    const user = auth.user;
    const allowedRoles = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'OFFICE_MANAGER', 'BUH'];
    if (!allowedRoles.includes(user.role)) {
      AsgardUI.toast('Доступ', 'Недостаточно прав', 'err');
      location.hash = '#/home';
      return;
    }

    const contracts = await getAll();
    const customers = await AsgardDB.getAll('customers') || [];
    
    // Обновляем статусы
    contracts.forEach(c => c.computed_status = computeStatus(c));
    
    // Сортировка по дате (новые первые)
    contracts.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    const filterHtml = `
      <div class="filters" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <input type="text" id="fltSearch" class="inp" placeholder="Поиск по номеру/названию..." style="flex:1;min-width:200px"/>
        <select id="fltType" class="inp" style="width:180px">
          <option value="">Все типы</option>
          ${CONTRACT_TYPES.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
        </select>
        <select id="fltStatus" class="inp" style="width:160px">
          <option value="">Все статусы</option>
          ${CONTRACT_STATUSES.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
        </select>
        <button class="btn primary" id="btnAddContract">+ Новый договор</button>
      </div>
    `;

    const tableHtml = `
      <div class="tbl-wrap">
        <table class="tbl" id="contractsTable">
          <thead>
            <tr>
              <th>Номер</th>
              <th>Тип</th>
              <th>Контрагент</th>
              <th>Предмет</th>
              <th>Дата</th>
              <th>Срок до</th>
              <th>Сумма</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="contractsBody">
            ${renderRows(contracts, customers)}
          </tbody>
        </table>
      </div>
      ${contracts.length === 0 ? '<div class="help" style="text-align:center;padding:40px">Договоров пока нет. Нажмите «+ Новый договор» для добавления.</div>' : ''}
    `;

    const body = `
      <div class="panel">
        ${filterHtml}
        ${tableHtml}
      </div>
    `;

    await layout(body, { title: title || 'Реестр договоров' });

    // Обработчики
    document.getElementById('btnAddContract')?.addEventListener('click', () => openContractModal(null, customers));
    
    // Фильтры
    const applyFilters = () => {
      const search = document.getElementById('fltSearch')?.value.toLowerCase() || '';
      const type = document.getElementById('fltType')?.value || '';
      const status = document.getElementById('fltStatus')?.value || '';
      
      const filtered = contracts.filter(c => {
        const matchSearch = !search || 
          (c.number || '').toLowerCase().includes(search) ||
          (c.subject || '').toLowerCase().includes(search) ||
          (c.counterparty_name || '').toLowerCase().includes(search);
        const matchType = !type || c.type === type;
        const matchStatus = !status || c.computed_status === status;
        return matchSearch && matchType && matchStatus;
      });
      
      document.getElementById('contractsBody').innerHTML = renderRows(filtered, customers);
      attachRowHandlers(customers);
    };

    document.getElementById('fltSearch')?.addEventListener('input', applyFilters);
    document.getElementById('fltType')?.addEventListener('change', applyFilters);
    document.getElementById('fltStatus')?.addEventListener('change', applyFilters);

    attachRowHandlers(customers);
  }

  function renderRows(contracts, customers) {
    if (!contracts.length) return '';
    
    return contracts.map(c => {
      const status = CONTRACT_STATUSES.find(s => s.id === c.computed_status) || CONTRACT_STATUSES[0];
      const type = CONTRACT_TYPES.find(t => t.id === c.type);
      const customer = customers.find(cust => cust.id === c.counterparty_id);
      
      return `
        <tr data-id="${c.id}">
          <td><strong>${c.number || '—'}</strong></td>
          <td><span class="badge" style="background:${c.type === 'customer' ? 'var(--green-glow)' : 'var(--blue-glow)'}; color:${c.type === 'customer' ? 'var(--green)' : 'var(--blue)'}">${type?.name || c.type}</span></td>
          <td>${customer?.name || c.counterparty_name || '—'}</td>
          <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis">${c.subject || '—'}</td>
          <td>${c.start_date ? formatDate(c.start_date) : '—'}</td>
          <td>${c.is_perpetual ? '<span style="opacity:0.7">Бессрочный</span>' : (c.end_date ? formatDate(c.end_date) : '—')}</td>
          <td>${c.amount ? formatMoney(c.amount) : '—'}</td>
          <td><span class="badge" style="background:${status.color}20;color:${status.color}">${status.name}</span></td>
          <td>
            <div style="display:flex;gap:6px">
              <button class="btn mini ghost btnEdit" title="Редактировать">✏️</button>
              <button class="btn mini ghost btnDelete" title="Удалить">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function attachRowHandlers(customers) {
    document.querySelectorAll('#contractsBody tr').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('.btnEdit')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const contracts = await getAll();
        const contract = contracts.find(c => String(c.id) === String(id));
        if (contract) openContractModal(contract, customers);
      });
      row.querySelector('.btnDelete')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Удалить договор?')) {
          await remove(id);
          AsgardUI.toast('Удалено', 'Договор удалён', 'ok');
          render({ layout: window.layout, title: 'Реестр договоров' });
        }
      });
    });
  }

  // Модальное окно создания/редактирования
  async function openContractModal(contract, customers) {
    const isEdit = !!contract;
    
    const html = `
      <div class="modal-overlay" id="contractModal">
        <div class="modal-content" style="max-width:600px">
          <div class="modal-header">
            <h3>${isEdit ? 'Редактирование договора' : 'Новый договор'}</h3>
            <button class="btn ghost btnClose">✕</button>
          </div>
          <div class="modal-body" style="max-height:70vh;overflow-y:auto">
            <form id="contractForm">
              <div class="formrow" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <div class="field">
                  <label>Номер договора *</label>
                  <input type="text" name="number" class="inp" value="${contract?.number || ''}" required/>
                </div>
                <div class="field">
                  <label>Тип *</label>
                  <select name="type" class="inp" required>
                    ${CONTRACT_TYPES.map(t => `<option value="${t.id}" ${contract?.type === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
                  </select>
                </div>
              </div>
              
              <div class="field" style="margin-top:12px">
                <label>Контрагент *</label>
                <select name="counterparty_id" class="inp" required>
                  <option value="">— Выберите —</option>
                  ${customers.map(c => `<option value="${c.id}" ${contract?.counterparty_id === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
                </select>
              </div>
              
              <div class="field" style="margin-top:12px">
                <label>Предмет договора</label>
                <textarea name="subject" class="inp" rows="2">${contract?.subject || ''}</textarea>
              </div>
              
              <div class="formrow" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
                <div class="field">
                  <label>Дата заключения</label>
                  <input type="date" name="start_date" class="inp" value="${contract?.start_date || ''}"/>
                </div>
                <div class="field">
                  <label>Сумма (₽)</label>
                  <input type="number" name="amount" class="inp" step="0.01" value="${contract?.amount || ''}"/>
                </div>
              </div>
              
              <div class="formrow" style="display:grid;grid-template-columns:1fr auto;gap:12px;margin-top:12px;align-items:end">
                <div class="field">
                  <label>Срок действия до</label>
                  <input type="date" name="end_date" class="inp" value="${contract?.end_date || ''}" ${contract?.is_perpetual ? 'disabled' : ''}/>
                </div>
                <div class="field" style="display:flex;align-items:center;gap:8px;padding-bottom:8px">
                  <input type="checkbox" name="is_perpetual" id="isPerpetual" ${contract?.is_perpetual ? 'checked' : ''}/>
                  <label for="isPerpetual" style="margin:0;cursor:pointer">Бессрочный</label>
                </div>
              </div>
              
              <div class="field" style="margin-top:12px">
                <label>Ответственный сотрудник</label>
                <input type="text" name="responsible" class="inp" value="${contract?.responsible || ''}"/>
              </div>
              
              <div class="field" style="margin-top:12px">
                <label>Статус</label>
                <select name="status" class="inp">
                  <option value="draft" ${contract?.status === 'draft' ? 'selected' : ''}>Черновик</option>
                  <option value="active" ${(!contract?.status || contract?.status === 'active') ? 'selected' : ''}>Действует</option>
                  <option value="terminated" ${contract?.status === 'terminated' ? 'selected' : ''}>Расторгнут</option>
                </select>
              </div>
              
              <div class="field" style="margin-top:12px">
                <label>Файл договора (ссылка)</label>
                <input type="url" name="file_url" class="inp" placeholder="https://..." value="${contract?.file_url || ''}"/>
              </div>
              
              <div class="field" style="margin-top:12px">
                <label>Комментарий</label>
                <textarea name="comment" class="inp" rows="2">${contract?.comment || ''}</textarea>
              </div>
            </form>
          </div>
          <div class="modal-footer" style="display:flex;gap:12px;justify-content:flex-end;padding:16px">
            <button class="btn ghost btnClose">Отмена</button>
            <button class="btn primary" id="btnSaveContract">Сохранить</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    
    const modal = document.getElementById('contractModal');
    const form = document.getElementById('contractForm');
    
    // Бессрочный toggle
    document.getElementById('isPerpetual')?.addEventListener('change', (e) => {
      const endDateInput = form.querySelector('[name="end_date"]');
      endDateInput.disabled = e.target.checked;
      if (e.target.checked) endDateInput.value = '';
    });
    
    // Закрытие
    modal.querySelectorAll('.btnClose').forEach(btn => {
      btn.addEventListener('click', () => modal.remove());
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    
    // Сохранение
    document.getElementById('btnSaveContract')?.addEventListener('click', async () => {
      const formData = new FormData(form);
      
      const number = formData.get('number')?.trim();
      const counterparty_id = formData.get('counterparty_id');
      
      if (!number) {
        AsgardUI.toast('Ошибка', 'Укажите номер договора', 'err');
        return;
      }
      if (!counterparty_id) {
        AsgardUI.toast('Ошибка', 'Выберите контрагента', 'err');
        return;
      }
      
      const customer = customers.find(c => c.id === counterparty_id);
      
      const data = {
        id: contract?.id || undefined,
        number: number,
        type: formData.get('type'),
        counterparty_id: counterparty_id,
        counterparty_name: customer?.name || '',
        subject: formData.get('subject')?.trim() || '',
        start_date: formData.get('start_date') || null,
        end_date: formData.get('end_date') || null,
        is_perpetual: formData.get('is_perpetual') === 'on',
        amount: formData.get('amount') ? parseFloat(formData.get('amount')) : null,
        responsible: formData.get('responsible')?.trim() || '',
        status: formData.get('status'),
        file_url: formData.get('file_url')?.trim() || '',
        comment: formData.get('comment')?.trim() || '',
        created_at: contract?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      await save(data);
      modal.remove();
      AsgardUI.toast('Сохранено', isEdit ? 'Договор обновлён' : 'Договор добавлен', 'ok');
      render({ layout: window.layout, title: 'Реестр договоров' });
    });
  }

  // Модальное окно выбора/создания договора (для интеграции с расходами/доходами)
  async function openContractSelector(counterpartyId, type, onSelect) {
    const contracts = await findByCounterparty(counterpartyId, type);
    const customers = await AsgardDB.getAll('customers') || [];
    
    const html = `
      <div class="modal-overlay" id="contractSelectorModal">
        <div class="modal-content" style="max-width:500px">
          <div class="modal-header">
            <h3>Выберите договор</h3>
            <button class="btn ghost btnClose">✕</button>
          </div>
          <div class="modal-body">
            ${contracts.length > 0 ? `
              <div style="margin-bottom:16px">
                <label style="font-weight:600;margin-bottom:8px;display:block">Существующие договоры:</label>
                <div style="display:flex;flex-direction:column;gap:8px">
                  ${contracts.map(c => `
                    <label class="card" style="cursor:pointer;padding:12px;display:flex;align-items:center;gap:12px">
                      <input type="radio" name="selectedContract" value="${c.id}"/>
                      <div>
                        <strong>${c.number}</strong>
                        <div style="font-size:12px;opacity:0.7">${c.subject || 'Без предмета'}</div>
                      </div>
                    </label>
                  `).join('')}
                </div>
              </div>
              <div style="text-align:center;margin:16px 0;opacity:0.5">— или —</div>
            ` : '<p style="opacity:0.7;margin-bottom:16px">Договоров с этим контрагентом не найдено.</p>'}
            <button class="btn ghost" id="btnCreateNewContract" style="width:100%">+ Создать новый договор</button>
          </div>
          <div class="modal-footer" style="display:flex;gap:12px;justify-content:flex-end;padding:16px">
            <button class="btn ghost btnClose">Отмена</button>
            <button class="btn primary" id="btnSelectContract" ${contracts.length === 0 ? 'disabled' : ''}>Выбрать</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    
    const modal = document.getElementById('contractSelectorModal');
    
    modal.querySelectorAll('.btnClose').forEach(btn => {
      btn.addEventListener('click', () => modal.remove());
    });
    
    document.getElementById('btnCreateNewContract')?.addEventListener('click', () => {
      modal.remove();
      const customer = customers.find(c => c.id === counterpartyId);
      openContractModal({ 
        counterparty_id: counterpartyId, 
        counterparty_name: customer?.name,
        type: type 
      }, customers);
    });
    
    document.getElementById('btnSelectContract')?.addEventListener('click', () => {
      const selected = modal.querySelector('input[name="selectedContract"]:checked');
      if (selected) {
        const contract = contracts.find(c => c.id === selected.value);
        modal.remove();
        if (onSelect) onSelect(contract);
      }
    });
  }

  // Helpers
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU');
  }

  function formatMoney(amount) {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(amount);
  }

  // Проверка истекающих договоров для уведомлений
  async function checkExpiringContracts() {
    const contracts = await getAll();
    const expiring = contracts.filter(c => {
      const status = computeStatus(c);
      return status === 'expiring';
    });
    return expiring;
  }

  return {
    render,
    getAll,
    save,
    remove,
    findByCounterparty,
    openContractSelector,
    checkExpiringContracts,
    CONTRACT_TYPES,
    CONTRACT_STATUSES
  };
})();
