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
      
      const esc = AsgardUI.esc;
      return `
        <tr data-id="${c.id}" style="background:transparent">
          <td><strong>${esc(c.number) || '—'}</strong></td>
          <td><span class="badge" style="background:${c.type === 'customer' ? 'var(--green-glow)' : 'var(--blue-glow)'}; color:${c.type === 'customer' ? 'var(--green)' : 'var(--blue)'}">${esc(type?.name || c.type)}</span></td>
          <td>${esc(customer?.name || c.counterparty_name) || '—'}</td>
          <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis">${esc(c.subject) || '—'}</td>
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
    const esc = AsgardUI.esc;

    // Стиль секции
    const sectionStyle = 'padding:16px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);margin-bottom:16px';
    const sectionTitle = (icon, text) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;font-weight:600;font-size:13px;color:var(--t2);text-transform:uppercase;letter-spacing:.5px"><span style="font-size:15px">${icon}</span>${text}</div>`;
    const fieldLabel = (text, req) => `<label style="display:block;font-size:12px;font-weight:500;color:var(--t2);margin-bottom:4px">${text}${req ? ' <span style="color:var(--red)">*</span>' : ''}</label>`;

    // Статус-бейдж для шапки
    const statusBadge = isEdit ? (() => {
      const cs = computeStatus(contract);
      const st = CONTRACT_STATUSES.find(s => s.id === cs) || CONTRACT_STATUSES[0];
      return `<span style="font-size:12px;padding:4px 10px;border-radius:20px;background:${st.color}18;color:${st.color};font-weight:600">${st.name}</span>`;
    })() : '';

    const html = `
      <div class="modal-overlay show" id="contractModal" style="z-index:var(--z-modal)">
        <div class="modal-content" style="max-width:640px;background:var(--bg2);border:1px solid rgba(255,255,255,.1);color:var(--t1);border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.5)">
          <div class="modal-header" style="padding:20px 24px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.06)">
            <div style="display:flex;align-items:center;gap:12px">
              <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,var(--primary),var(--blue));display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">&#128196;</div>
              <div>
                <h3 style="margin:0;font-size:17px;font-weight:700">${isEdit ? 'Редактирование договора' : 'Новый договор'}</h3>
                ${isEdit ? `<div style="font-size:12px;color:var(--t3);margin-top:2px">${esc(contract.number || '')}</div>` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              ${statusBadge}
              <button class="btn ghost btnClose" style="width:32px;height:32px;padding:0;border-radius:8px;font-size:16px;display:flex;align-items:center;justify-content:center">&#10005;</button>
            </div>
          </div>
          <div class="modal-body" style="max-height:65vh;overflow-y:auto;padding:20px 24px">
            <form id="contractForm">

              <div style="${sectionStyle}">
                ${sectionTitle('&#128203;', 'Основная информация')}
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                  <div>
                    ${fieldLabel('Номер договора', true)}
                    <input type="text" name="number" class="inp" value="${esc(contract?.number || '')}" placeholder="Д-2026/001" required/>
                  </div>
                  <div>
                    ${fieldLabel('Тип договора', true)}
                    <select name="type" class="inp" required>
                      ${CONTRACT_TYPES.map(t => `<option value="${t.id}" ${contract?.type === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
                    </select>
                  </div>
                </div>
                <div style="margin-top:12px">
                  ${fieldLabel('Контрагент', true)}
                  <select name="counterparty_id" class="inp" required>
                    <option value="">-- Выберите контрагента --</option>
                    ${customers.map(c => `<option value="${c.id}" ${contract?.counterparty_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
                  </select>
                </div>
                <div style="margin-top:12px">
                  ${fieldLabel('Предмет договора')}
                  <textarea name="subject" class="inp" rows="2" placeholder="Краткое описание предмета договора...">${esc(contract?.subject || '')}</textarea>
                </div>
              </div>

              <div style="${sectionStyle}">
                ${sectionTitle('&#128197;', 'Сроки и финансы')}
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                  <div>
                    ${fieldLabel('Дата заключения')}
                    <input type="date" name="start_date" class="inp" value="${contract?.start_date || ''}"/>
                  </div>
                  <div>
                    ${fieldLabel('Сумма')}
                    <div style="position:relative">
                      <input type="number" name="amount" class="inp" step="0.01" value="${contract?.amount || ''}" placeholder="0.00" style="padding-right:32px"/>
                      <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--t3);font-size:14px;pointer-events:none">&#8381;</span>
                    </div>
                  </div>
                </div>
                <div style="margin-top:12px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:end">
                  <div>
                    ${fieldLabel('Срок действия до')}
                    <input type="date" name="end_date" class="inp" id="cmEndDate" value="${contract?.end_date || ''}" ${contract?.is_perpetual ? 'disabled style="opacity:.4"' : ''}/>
                  </div>
                  <label id="cmPerpetualToggle" style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:8px;cursor:pointer;user-select:none;border:1px solid ${contract?.is_perpetual ? 'var(--primary)' : 'rgba(255,255,255,.1)'};background:${contract?.is_perpetual ? 'rgba(var(--primary-rgb,.08))' : 'transparent'};transition:all .15s;margin-bottom:1px;white-space:nowrap">
                    <input type="checkbox" name="is_perpetual" id="isPerpetual" ${contract?.is_perpetual ? 'checked' : ''} style="display:none"/>
                    <span style="width:18px;height:18px;border-radius:4px;border:2px solid ${contract?.is_perpetual ? 'var(--primary)' : 'rgba(255,255,255,.25)'};display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0;background:${contract?.is_perpetual ? 'var(--primary)' : 'transparent'}"><span style="color:#fff;font-size:12px;line-height:1">${contract?.is_perpetual ? '&#10003;' : ''}</span></span>
                    <span style="font-size:13px;color:var(--t2)">Бессрочный</span>
                  </label>
                </div>
                <div id="cmDateHint" style="margin-top:8px;font-size:12px;color:var(--t3);display:${(contract?.end_date && !contract?.is_perpetual) ? 'block' : 'none'}"></div>
              </div>

              <div style="${sectionStyle}">
                ${sectionTitle('&#9881;', 'Дополнительно')}
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                  <div>
                    ${fieldLabel('Ответственный')}
                    <input type="text" name="responsible" class="inp" value="${esc(contract?.responsible || '')}" placeholder="ФИО сотрудника"/>
                  </div>
                  <div>
                    ${fieldLabel('Статус')}
                    <select name="status" class="inp">
                      <option value="draft" ${contract?.status === 'draft' ? 'selected' : ''}>&#9898; Черновик</option>
                      <option value="active" ${(!contract?.status || contract?.status === 'active') ? 'selected' : ''}>&#128994; Действует</option>
                      <option value="terminated" ${contract?.status === 'terminated' ? 'selected' : ''}>&#128308; Расторгнут</option>
                    </select>
                  </div>
                </div>
                <div style="margin-top:12px">
                  ${fieldLabel('Файл договора (ссылка)')}
                  <input type="url" name="file_url" class="inp" placeholder="https://drive.google.com/..." value="${esc(contract?.file_url || '')}"/>
                </div>
                <div style="margin-top:12px">
                  ${fieldLabel('Комментарий')}
                  <textarea name="comment" class="inp" rows="2" placeholder="Заметки по договору...">${esc(contract?.comment || '')}</textarea>
                </div>
              </div>

            </form>
          </div>
          <div class="modal-footer" style="display:flex;gap:10px;justify-content:flex-end;padding:16px 24px;border-top:1px solid rgba(255,255,255,.06)">
            <button class="btn ghost btnClose" style="padding:10px 20px;border-radius:8px">Отмена</button>
            <button class="btn primary" id="btnSaveContract" style="padding:10px 24px;border-radius:8px;font-weight:600">
              ${isEdit ? '&#10003; Сохранить' : '&#43; Создать договор'}
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    const modal = document.getElementById('contractModal');
    const form = document.getElementById('contractForm');
    const endDateInput = document.getElementById('cmEndDate');
    const perpetualToggle = document.getElementById('cmPerpetualToggle');
    const dateHint = document.getElementById('cmDateHint');

    // Подсказка по дням до окончания
    function updateDateHint() {
      if (!endDateInput.value || document.getElementById('isPerpetual').checked) {
        dateHint.style.display = 'none';
        return;
      }
      const days = Math.ceil((new Date(endDateInput.value) - new Date()) / 86400000);
      if (days < 0) {
        dateHint.textContent = 'Договор истёк ' + Math.abs(days) + ' дн. назад';
        dateHint.style.color = 'var(--red)';
      } else if (days <= 30) {
        dateHint.textContent = 'Истекает через ' + days + ' дн.';
        dateHint.style.color = 'var(--amber)';
      } else {
        dateHint.textContent = 'Осталось ' + days + ' дн.';
        dateHint.style.color = 'var(--green)';
      }
      dateHint.style.display = 'block';
    }
    updateDateHint();
    endDateInput.addEventListener('change', updateDateHint);

    // Бессрочный toggle — кастомный чекбокс
    perpetualToggle.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const cb = document.getElementById('isPerpetual');
      cb.checked = !cb.checked;
      const on = cb.checked;
      endDateInput.disabled = on;
      endDateInput.style.opacity = on ? '.4' : '1';
      if (on) endDateInput.value = '';
      perpetualToggle.style.borderColor = on ? 'var(--primary)' : 'rgba(255,255,255,.1)';
      perpetualToggle.style.background = on ? 'rgba(var(--primary-rgb),.08)' : 'transparent';
      const box = perpetualToggle.querySelector('span > span');
      const outer = perpetualToggle.querySelector('span:first-child');
      if (on) {
        outer.style.borderColor = 'var(--primary)';
        outer.style.background = 'var(--primary)';
        box.innerHTML = '&#10003;';
      } else {
        outer.style.borderColor = 'rgba(255,255,255,.25)';
        outer.style.background = 'transparent';
        box.innerHTML = '';
      }
      updateDateHint();
    });

    // Закрытие по Escape
    const onKey = (e) => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); }};
    document.addEventListener('keydown', onKey);

    // Закрытие
    modal.querySelectorAll('.btnClose').forEach(btn => {
      btn.addEventListener('click', () => { modal.remove(); document.removeEventListener('keydown', onKey); });
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) { modal.remove(); document.removeEventListener('keydown', onKey); }
    });

    // Валидация полей в реальном времени
    const requiredFields = form.querySelectorAll('[required]');
    requiredFields.forEach(f => {
      f.addEventListener('blur', () => {
        if (!f.value.trim()) {
          f.style.borderColor = 'var(--red)';
          f.style.boxShadow = '0 0 0 2px rgba(255,59,48,.15)';
        } else {
          f.style.borderColor = '';
          f.style.boxShadow = '';
        }
      });
      f.addEventListener('input', () => {
        if (f.value.trim()) { f.style.borderColor = ''; f.style.boxShadow = ''; }
      });
    });

    // Сохранение
    document.getElementById('btnSaveContract')?.addEventListener('click', async () => {
      const formData = new FormData(form);

      const number = formData.get('number')?.trim();
      const counterparty_id = formData.get('counterparty_id');

      // Визуальная валидация
      let hasErr = false;
      if (!number) {
        const inp = form.querySelector('[name="number"]');
        inp.style.borderColor = 'var(--red)'; inp.style.boxShadow = '0 0 0 2px rgba(255,59,48,.15)'; inp.focus();
        AsgardUI.toast('Ошибка', 'Укажите номер договора', 'err');
        hasErr = true;
      }
      if (!counterparty_id) {
        const inp = form.querySelector('[name="counterparty_id"]');
        inp.style.borderColor = 'var(--red)'; inp.style.boxShadow = '0 0 0 2px rgba(255,59,48,.15)';
        if (!hasErr) inp.focus();
        AsgardUI.toast('Ошибка', 'Выберите контрагента', 'err');
        hasErr = true;
      }
      if (hasErr) return;

      // Валидация дат
      const startDate = formData.get('start_date');
      const endDate = formData.get('end_date');
      if (startDate && endDate && endDate < startDate) {
        AsgardUI.toast('Ошибка', 'Дата окончания не может быть раньше даты заключения', 'err');
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
        start_date: startDate || null,
        end_date: endDate || null,
        is_perpetual: document.getElementById('isPerpetual').checked,
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
      document.removeEventListener('keydown', onKey);
      AsgardUI.toast('Сохранено', isEdit ? 'Договор обновлён' : 'Договор добавлен', 'ok');
      render({ layout: window.layout, title: 'Реестр договоров' });
    });

    // Анимация появления
    requestAnimationFrame(() => {
      const content = modal.querySelector('.modal-content');
      if (content) { content.style.animation = 'modal-slide-up .25s ease forwards'; }
    });
  }

  // Модальное окно выбора/создания договора (для интеграции с расходами/доходами)
  async function openContractSelector(counterpartyId, type, onSelect) {
    const contracts = await findByCounterparty(counterpartyId, type);
    const customers = await AsgardDB.getAll('customers') || [];
    const esc = AsgardUI.esc;

    const html = `
      <div class="modal-overlay show" id="contractSelectorModal" style="z-index:var(--z-modal)">
        <div class="modal-content" style="max-width:500px;background:var(--bg2);border:1px solid rgba(255,255,255,.1);color:var(--t1);border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.5)">
          <div class="modal-header" style="padding:20px 24px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.06)">
            <div style="display:flex;align-items:center;gap:12px">
              <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--primary),var(--blue));display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">&#128196;</div>
              <h3 style="margin:0;font-size:16px;font-weight:700">Выберите договор</h3>
            </div>
            <button class="btn ghost btnClose" style="width:32px;height:32px;padding:0;border-radius:8px;font-size:16px;display:flex;align-items:center;justify-content:center">&#10005;</button>
          </div>
          <div class="modal-body" style="padding:20px 24px;max-height:60vh;overflow-y:auto">
            ${contracts.length > 0 ? `
              <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
                ${contracts.map((c, i) => {
                  const st = CONTRACT_STATUSES.find(s => s.id === computeStatus(c)) || CONTRACT_STATUSES[1];
                  return `
                  <label data-cid="${c.id}" style="display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:10px;border:2px solid rgba(255,255,255,.06);cursor:pointer;transition:all .15s;background:transparent" class="csel-item">
                    <input type="radio" name="selectedContract" value="${c.id}" style="display:none" ${i === 0 ? 'checked' : ''}/>
                    <span class="csel-radio" style="width:20px;height:20px;border-radius:50%;border:2px solid ${i === 0 ? 'var(--primary)' : 'rgba(255,255,255,.2)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;background:${i === 0 ? 'var(--primary)' : 'transparent'}"><span style="width:8px;height:8px;border-radius:50%;background:#fff;display:${i === 0 ? 'block' : 'none'}"></span></span>
                    <div style="flex:1;min-width:0">
                      <div style="font-weight:600;font-size:14px">${esc(c.number)}</div>
                      <div style="font-size:12px;color:var(--t3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.subject || 'Без предмета')}${c.amount ? ' &middot; ' + formatMoney(c.amount) : ''}</div>
                    </div>
                    <span style="font-size:11px;padding:3px 8px;border-radius:20px;background:${st.color}18;color:${st.color};font-weight:600;flex-shrink:0">${st.name}</span>
                  </label>`;
                }).join('')}
              </div>
              <div style="text-align:center;margin:12px 0;font-size:12px;color:var(--t3);display:flex;align-items:center;gap:12px"><span style="flex:1;height:1px;background:rgba(255,255,255,.08)"></span>или<span style="flex:1;height:1px;background:rgba(255,255,255,.08)"></span></div>
            ` : '<div style="text-align:center;padding:20px;color:var(--t3);font-size:14px">Договоров с этим контрагентом не найдено</div>'}
            <button class="btn ghost" id="btnCreateNewContract" style="width:100%;padding:12px;border-radius:10px;border:1px dashed rgba(255,255,255,.15);font-size:14px">+ Создать новый договор</button>
          </div>
          <div class="modal-footer" style="display:flex;gap:10px;justify-content:flex-end;padding:16px 24px;border-top:1px solid rgba(255,255,255,.06)">
            <button class="btn ghost btnClose" style="padding:10px 20px;border-radius:8px">Отмена</button>
            <button class="btn primary" id="btnSelectContract" style="padding:10px 24px;border-radius:8px;font-weight:600" ${contracts.length === 0 ? 'disabled' : ''}>Выбрать</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    const modal = document.getElementById('contractSelectorModal');

    // Интерактивный выбор — подсветка радио-карточек
    modal.querySelectorAll('.csel-item').forEach(item => {
      item.addEventListener('click', () => {
        modal.querySelectorAll('.csel-item').forEach(el => {
          const r = el.querySelector('.csel-radio');
          const dot = r.querySelector('span');
          el.style.borderColor = 'rgba(255,255,255,.06)';
          el.style.background = 'transparent';
          r.style.borderColor = 'rgba(255,255,255,.2)';
          r.style.background = 'transparent';
          dot.style.display = 'none';
        });
        item.style.borderColor = 'var(--primary)';
        item.style.background = 'rgba(var(--primary-rgb),.05)';
        const r = item.querySelector('.csel-radio');
        const dot = r.querySelector('span');
        r.style.borderColor = 'var(--primary)';
        r.style.background = 'var(--primary)';
        dot.style.display = 'block';
        item.querySelector('input').checked = true;
        document.getElementById('btnSelectContract').disabled = false;
      });
    });

    // Escape
    const onKey = (e) => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); }};
    document.addEventListener('keydown', onKey);

    modal.querySelectorAll('.btnClose').forEach(btn => {
      btn.addEventListener('click', () => { modal.remove(); document.removeEventListener('keydown', onKey); });
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) { modal.remove(); document.removeEventListener('keydown', onKey); }
    });

    document.getElementById('btnCreateNewContract')?.addEventListener('click', () => {
      modal.remove();
      document.removeEventListener('keydown', onKey);
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
        const contract = contracts.find(c => String(c.id) === selected.value);
        modal.remove();
        document.removeEventListener('keydown', onKey);
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
