/**
 * АСГАРД CRM — Реестр печатей
 * Этап 30
 */
window.AsgardSealsPage = (function(){
  
  const SEAL_TYPES = [
    { id: 'main', name: 'Основная (гербовая)' },
    { id: 'documents', name: 'Для документов' },
    { id: 'contracts', name: 'Для договоров' },
    { id: 'facsimile', name: 'Факсимиле директора' },
    { id: 'stamp_date', name: 'Штамп (дата)' },
    { id: 'stamp_in', name: 'Штамп (входящий)' },
    { id: 'stamp_out', name: 'Штамп (исходящий)' },
    { id: 'other', name: 'Другое' }
  ];

  const SEAL_STATUSES = [
    { id: 'office', name: 'В офисе', color: 'var(--green)' },
    { id: 'employee', name: 'У сотрудника', color: 'var(--blue)' },
    { id: 'transfer', name: 'Передаётся', color: 'var(--amber)' },
    { id: 'lost', name: 'Утеряна', color: 'var(--red)' }
  ];

  // CRUD
  async function getAll() {
    try {
      return await AsgardDB.getAll('seals') || [];
    } catch(e) {
      const data = localStorage.getItem('asgard_seals');
      return data ? JSON.parse(data) : [];
    }
  }

  async function save(seal) {
    try {
      await AsgardDB.put('seals', seal);
    } catch(e) {
      const all = await getAll();
      const idx = all.findIndex(s => String(s.id) === String(seal.id));
      if (idx >= 0) all[idx] = seal;
      else all.push(seal);
      localStorage.setItem('asgard_seals', JSON.stringify(all));
    }
  }

  async function remove(id) {
    try {
      await AsgardDB.delete('seals', id);
    } catch(e) {
      const all = await getAll();
      localStorage.setItem('asgard_seals', JSON.stringify(all.filter(s => s.id !== id)));
    }
  }

  // История передач
  async function getTransferHistory(sealId) {
    try {
      const all = await AsgardDB.getAll('seal_transfers') || [];
      return all.filter(t => t.seal_id === sealId).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    } catch(e) {
      const data = localStorage.getItem('asgard_seal_transfers');
      const all = data ? JSON.parse(data) : [];
      return all.filter(t => t.seal_id === sealId);
    }
  }

  async function saveTransfer(transfer) {
    try {
      await AsgardDB.put('seal_transfers', transfer);
    } catch(e) {
      const data = localStorage.getItem('asgard_seal_transfers');
      const all = data ? JSON.parse(data) : [];
      all.push(transfer);
      localStorage.setItem('asgard_seal_transfers', JSON.stringify(all));
    }
  }

  // Получить пользователей
  async function getUsers() {
    return await AsgardDB.getAll('users') || [];
  }

  // Рендер
  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = "#/login"; return; }
    
    const user = auth.user;
    const allowedRoles = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'OFFICE_MANAGER'];
    if (!allowedRoles.includes(user.role)) {
      AsgardUI.toast('Доступ', 'Недостаточно прав', 'err');
      location.hash = '#/home';
      return;
    }

    const seals = await getAll();
    const users = await getUsers();

    const html = `
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">
          <input type="text" id="fltSearch" class="inp" placeholder="Поиск..." style="max-width:300px"/>
          <button class="btn primary" id="btnAddSeal">+ Новая печать</button>
        </div>
        
        <div class="tbl-wrap">
          <table class="tbl" id="sealsTable">
            <thead>
              <tr>
                <th>Название</th>
                <th>Тип</th>
                <th>Инв. №</th>
                <th>Держатель</th>
                <th>Срок до</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="sealsBody">
              ${renderRows(seals, users)}
            </tbody>
          </table>
        </div>
        ${seals.length === 0 ? '<div class="help" style="text-align:center;padding:40px">Печатей пока нет</div>' : ''}
      </div>
    `;

    await layout(html, { title: title || 'Реестр печатей' });

    // Handlers
    $('#btnAddSeal')?.addEventListener('click', () => openSealModal(null, users));
    
    $('#fltSearch')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = seals.filter(s => 
        (s.name || '').toLowerCase().includes(q) ||
        (s.inv_number || '').toLowerCase().includes(q)
      );
      $('#sealsBody').innerHTML = renderRows(filtered, users);
      attachHandlers(users);
    });

    attachHandlers(users);
  }

  function renderRows(seals, users) {
    if (!seals.length) return '';
    
    return seals.map(s => {
      const type = SEAL_TYPES.find(t => t.id === s.type) || { name: s.type };
      const status = SEAL_STATUSES.find(st => st.id === s.status) || SEAL_STATUSES[0];
      const holder = users.find(u => u.id === s.holder_id);
      
      return `
        <tr data-id="${s.id}">
          <td><strong>${esc(s.name)}</strong></td>
          <td>${type.name}</td>
          <td>${esc(s.inv_number || '—')}</td>
          <td>${holder ? esc(holder.name) : (s.status === 'office' ? '<span style="opacity:0.6">В офисе</span>' : '—')}</td>
          <td>${s.return_date ? formatDate(s.return_date) : (s.is_indefinite ? '<span style="opacity:0.6">Бессрочно</span>' : '—')}</td>
          <td><span class="badge" style="background:${status.color}20;color:${status.color}">${status.name}</span></td>
          <td>
            <div style="display:flex;gap:6px">
              <button class="btn mini ghost btnTransfer" title="Передать">🔄</button>
              <button class="btn mini ghost btnHistory" title="История">📋</button>
              <button class="btn mini ghost btnEdit" title="Редактировать">✏️</button>
              <button class="btn mini ghost btnDelete" title="Удалить">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function attachHandlers(users) {
    document.querySelectorAll('#sealsBody tr').forEach(row => {
      const id = row.dataset.id;
      
      row.querySelector('.btnEdit')?.addEventListener('click', async () => {
        const seals = await getAll();
        const seal = seals.find(s => String(s.id) === String(id));
        if (seal) openSealModal(seal, users);
      });
      
      row.querySelector('.btnDelete')?.addEventListener('click', async () => {
        if (confirm('Удалить печать?')) {
          await remove(id);
          AsgardUI.toast('Удалено', 'Печать удалена', 'ok');
          location.hash = '#/seals';
        }
      });
      
      row.querySelector('.btnTransfer')?.addEventListener('click', async () => {
        const seals = await getAll();
        const seal = seals.find(s => String(s.id) === String(id));
        if (seal) openTransferModal(seal, users);
      });
      
      row.querySelector('.btnHistory')?.addEventListener('click', async () => {
        const seals = await getAll();
        const seal = seals.find(s => String(s.id) === String(id));
        if (seal) openHistoryModal(seal, users);
      });
    });
  }

  // Модалка создания/редактирования
  async function openSealModal(seal, users) {
    const isEdit = !!seal;
    
    const html = `
      <div class="modal-overlay show" id="sealModal">
        <div class="modal-content" style="max-width:500px">
          <div class="modal-header">
            <h3>${isEdit ? 'Редактирование печати' : 'Новая печать'}</h3>
            <button class="btn ghost btnClose">✕</button>
          </div>
          <div class="modal-body">
            <div class="field">
              <label>Название *</label>
              <input type="text" id="sealName" class="inp" value="${esc(seal?.name || '')}" required/>
            </div>
            <div class="field" style="margin-top:12px">
              <label>Тип</label>
              <select id="sealType" class="inp">
                ${SEAL_TYPES.map(t => `<option value="${t.id}" ${seal?.type === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
              </select>
            </div>
            <div class="field" style="margin-top:12px">
              <label>Инвентарный номер</label>
              <input type="text" id="sealInv" class="inp" value="${esc(seal?.inv_number || '')}"/>
            </div>
            <div class="field" style="margin-top:12px">
              <label>Дата покупки</label>
              <input type="date" id="sealPurchase" class="inp" value="${(seal?.purchase_date || '').slice(0,10)}"/>
            </div>
            <div class="field" style="margin-top:12px">
              <label>Комментарий</label>
              <textarea id="sealComment" class="inp" rows="2">${esc(seal?.comment || '')}</textarea>
            </div>
          </div>
          <div class="modal-footer" style="display:flex;gap:12px;justify-content:flex-end;padding:16px">
            <button class="btn ghost btnClose">Отмена</button>
            <button class="btn primary" id="btnSaveSeal">Сохранить</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    const modal = $('#sealModal');
    
    modal.querySelectorAll('.btnClose').forEach(b => b.onclick = () => modal.remove());
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    
    $('#btnSaveSeal').onclick = async () => {
      const name = $('#sealName').value.trim();
      if (!name) { AsgardUI.toast('Ошибка', 'Укажите название', 'err'); return; }
      
      const data = {
        id: seal?.id || undefined,
        name,
        type: $('#sealType').value,
        inv_number: $('#sealInv').value.trim(),
        purchase_date: $('#sealPurchase').value || null,
        comment: $('#sealComment').value.trim(),
        status: seal?.status || 'office',
        holder_id: seal?.holder_id || null,
        return_date: seal?.return_date || null,
        is_indefinite: seal?.is_indefinite || false,
        created_at: seal?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      await save(data);
      modal.remove();
      AsgardUI.toast('Сохранено', isEdit ? 'Печать обновлена' : 'Печать добавлена', 'ok');
      location.hash = '#/seals';
    };
  }

  // Модалка передачи
  async function openTransferModal(seal, users) {
    const activeUsers = users.filter(u => u.is_active !== false && u.name && u.name.trim());
    
    const html = `
      <div class="modal-overlay show" id="transferModal">
        <div class="modal-content" style="max-width:450px">
          <div class="modal-header">
            <h3>Передача печати</h3>
            <button class="btn ghost btnClose">✕</button>
          </div>
          <div class="modal-body">
            <p style="margin-bottom:16px"><strong>${esc(seal.name)}</strong></p>
            
            <div class="field">
              <label>Кому передать *</label>
            <div id="transferToPicker"></div>
            <button type="button" class="btn ghost mini" id="transferToOffice" style="margin-top:8px;width:100%">\U0001f3e2 Вернуть в офис</button>
            </div>
            
            <div class="field" style="margin-top:12px">
              <label>Дата передачи</label>
              <input type="date" id="transferDate" class="inp" value="${today()}"/>
            </div>
            
            <div id="returnBlock" style="margin-top:12px;display:none">
              <div class="field">
                <label>Срок возврата</label>
                <input type="date" id="returnDate" class="inp"/>
              </div>
              <div class="field" style="margin-top:8px">
                <label><input type="checkbox" id="isIndefinite" style="width:auto"/> Бессрочно</label>
              </div>
            </div>
            
            <div class="field" style="margin-top:12px">
              <label>Цель / комментарий</label>
              <textarea id="transferPurpose" class="inp" rows="2" placeholder="Зачем нужна печать..."></textarea>
            </div>
          </div>
          <div class="modal-footer" style="display:flex;gap:12px;justify-content:flex-end;padding:16px">
            <button class="btn ghost btnClose">Отмена</button>
            <button class="btn primary" id="btnDoTransfer">Передать</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    const modal = $('#transferModal');
    
    modal.querySelectorAll('.btnClose').forEach(b => b.onclick = () => modal.remove());
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    
    // Show/hide return date
    // Wire up employee picker for transfer
    window.__sealTransferToOffice = '';
    if(window.AsgardEmployeePicker) {
      AsgardEmployeePicker.renderButton('transferToPicker', {
        placeholder: 'Выберите сотрудника...',
        title: 'Кому передать печать',
        onChange: (emp) => {
          window.__sealTransferToOffice = '';
          const rb = document.getElementById('returnBlock');
          if(rb) rb.style.display = emp ? 'block' : 'none';
        }
      });
    }
    const _offBtn = document.getElementById('transferToOffice');
    if(_offBtn) _offBtn.onclick = () => {
      window.__sealTransferToOffice = '__office__';
      const c = document.getElementById('transferToPicker');
      if(c) c.innerHTML = '<div class="ep-btn" style="pointer-events:none;opacity:0.8"><span>\U0001f3e2 Возврат в офис</span></div>';
      const rb = document.getElementById('returnBlock');
      if(rb) rb.style.display = 'none';
    };
    
    $('#isIndefinite').onchange = () => {
      $('#returnDate').disabled = $('#isIndefinite').checked;
    };
    
    $('#btnDoTransfer').onclick = async () => {
      const toId = document.getElementById('transferToPicker')?.pickerValue || window.__sealTransferToOffice || '';
      if (!toId) { AsgardUI.toast('Ошибка', 'Выберите получателя', 'err'); return; }
      
      const auth = await AsgardAuth.requireUser();
      const isReturnToOffice = toId === '__office__';
      
      // Сохраняем историю
      const transfer = {
        id: undefined,
        seal_id: seal.id,
        from_id: seal.holder_id,
        to_id: isReturnToOffice ? null : toId,
        transfer_date: $('#transferDate').value || today(),
        return_date: isReturnToOffice ? null : ($('#returnDate').value || null),
        is_indefinite: isReturnToOffice ? false : $('#isIndefinite').checked,
        purpose: $('#transferPurpose').value.trim(),
        status: 'pending', // Ожидает подтверждения
        created_by: auth.user.id,
        created_at: new Date().toISOString()
      };
      
      await saveTransfer(transfer);
      
      // Обновляем печать
      seal.status = isReturnToOffice ? 'office' : 'transfer';
      seal.holder_id = isReturnToOffice ? null : toId;
      seal.return_date = transfer.return_date;
      seal.is_indefinite = transfer.is_indefinite;
      seal.pending_transfer_id = isReturnToOffice ? null : transfer.id;
      seal.updated_at = new Date().toISOString();
      
      await save(seal);
      
      // Уведомление получателю
      if (!isReturnToOffice) {
        try {
          await AsgardDB.add('notifications', {
            user_id: toId,
            title: 'Передача печати',
            message: `Вам передаётся печать "${seal.name}". Подтвердите получение.`,
            type: 'seal_transfer',
            entity_id: transfer.id,
            is_read: false,
            created_at: new Date().toISOString()
          });
        } catch(e) {}
      }
      
      modal.remove();
      AsgardUI.toast('Успешно', isReturnToOffice ? 'Печать возвращена в офис' : 'Запрос на передачу отправлен', 'ok');
      location.hash = '#/seals';
    };
  }

  // Модалка истории
  async function openHistoryModal(seal, users) {
    const history = await getTransferHistory(seal.id);
    
    const html = `
      <div class="modal-overlay show" id="historyModal">
        <div class="modal-content" style="max-width:600px">
          <div class="modal-header">
            <h3>История передач: ${esc(seal.name)}</h3>
            <button class="btn ghost btnClose">✕</button>
          </div>
          <div class="modal-body" style="max-height:60vh;overflow-y:auto">
            ${history.length === 0 ? '<p style="opacity:0.6">История пуста</p>' : `
              <table class="tbl">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>От кого</th>
                    <th>Кому</th>
                    <th>Цель</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  ${history.map(h => {
                    const from = users.find(u => u.id === h.from_id);
                    const to = users.find(u => u.id === h.to_id);
                    const statusText = h.status === 'confirmed' ? '✅ Принято' : (h.status === 'pending' ? '⏳ Ожидает' : h.status);
                    return `
                      <tr>
                        <td>${formatDate(h.transfer_date)}</td>
                        <td>${from ? esc(from.name) : '<span style="opacity:0.6">Офис</span>'}</td>
                        <td>${to ? esc(to.name) : '<span style="opacity:0.6">Офис</span>'}</td>
                        <td style="max-width:200px">${esc(h.purpose || '—')}</td>
                        <td>${statusText}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            `}
          </div>
          <div class="modal-footer" style="padding:16px">
            <button class="btn ghost btnClose">Закрыть</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    const modal = $('#historyModal');
    modal.querySelectorAll('.btnClose').forEach(b => b.onclick = () => modal.remove());
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
  }

  // Подтверждение получения (вызывается из уведомлений)
  async function confirmTransfer(transferId) {
    const data = localStorage.getItem('asgard_seal_transfers');
    const transfers = data ? JSON.parse(data) : [];
    const transfer = transfers.find(t => t.id === transferId);
    
    if (!transfer) {
      try {
        const all = await AsgardDB.getAll('seal_transfers') || [];
        const found = all.find(t => t.id === transferId);
        if (found) {
          found.status = 'confirmed';
          found.confirmed_at = new Date().toISOString();
          await AsgardDB.put('seal_transfers', found);
          
          // Обновляем печать
          const seals = await getAll();
          const seal = seals.find(s => s.id === found.seal_id);
          if (seal) {
            seal.status = 'employee';
            seal.pending_transfer_id = null;
            await save(seal);
          }
        }
      } catch(e) {}
    } else {
      transfer.status = 'confirmed';
      transfer.confirmed_at = new Date().toISOString();
      localStorage.setItem('asgard_seal_transfers', JSON.stringify(transfers));
    }
    
    AsgardUI.toast('Подтверждено', 'Получение печати подтверждено', 'ok');
  }

  // Helpers
  function $(sel) { return document.querySelector(sel); }
  function esc(s) { return String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function today() { return new Date().toISOString().slice(0,10); }
  function formatDate(d) { return d ? new Date(d).toLocaleDateString('ru-RU') : ''; }

  return {
    render,
    getAll,
    save,
    remove,
    confirmTransfer,
    SEAL_TYPES,
    SEAL_STATUSES
  };
})();
