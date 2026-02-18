/**
 * АСГАРД CRM — Моё оборудование (для РП)
 * Просмотр и управление выданным оборудованием
 */

window.AsgardMyEquipment = (function(){
  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;
  
  async function render({ layout, title }) {
    const auth = await AsgardAuth.getAuth();
    const userId = auth?.user?.id;
    
    // Загружаем оборудование текущего пользователя
    let equipment = [];
    try {
      const resp = await fetch('/api/equipment/by-holder/' + userId, {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const data = await resp.json();
      equipment = data.equipment || [];
    } catch(e) {}
    
    // Загружаем объекты для формы передачи
    let objects = [];
    try {
      const resp = await fetch('/api/equipment/objects', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const data = await resp.json();
      objects = data.objects || [];
    } catch(e) {}
    
    const CONDITIONS = {
      'new': { label: 'Новое', color: '#22c55e' },
      'good': { label: 'Хорошее', color: '#3b82f6' },
      'satisfactory': { label: 'Удовл.', color: '#f59e0b' },
      'poor': { label: 'Плохое', color: '#f97316' },
      'broken': { label: 'Сломано', color: '#ef4444' }
    };
    
    const html = `
      <div class="my-equipment-page">
        <!-- Статистика -->
        <div class="stats-row" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px">
          <div class="stat-card" style="background:var(--bg-card);padding:16px;border-radius:6px;text-align:center">
            <div style="font-size:32px;font-weight:700;color:var(--accent)">${equipment.length}</div>
            <div style="font-size:12px;color:var(--text-muted)">Единиц оборудования</div>
          </div>
        </div>
        
        <!-- Действия -->
        <div class="toolbar" style="display:flex;gap:10px;margin-bottom:16px">
          <input type="text" class="inp" id="searchMyEquip" placeholder="🔍 Поиск..." style="flex:1;max-width:300px"/>
          <button class="btn" id="btnTransferRequest">📤 Запрос на передачу</button>
          <button class="btn" id="btnReturnRequest">📥 Вернуть на склад</button>
        </div>
        
        <!-- Таблица -->
        <div class="tbl-wrap" style="background:var(--bg-card);border-radius:6px;overflow:hidden">
          <table class="tbl" id="myEquipmentTable">
            <thead>
              <tr>
                <th style="width:40px"><input type="checkbox" id="selectAllMy"/></th>
                <th>Инв. №</th>
                <th>Наименование</th>
                <th>Категория</th>
                <th>Объект</th>
                <th>Работа</th>
                <th>Состояние</th>
              </tr>
            </thead>
            <tbody>
              ${equipment.length ? equipment.map(eq => {
                const cond = CONDITIONS[eq.condition] || CONDITIONS.good;
                return `
                  <tr data-id="${eq.id}">
                    <td><input type="checkbox" class="my-eq-check" value="${eq.id}"/></td>
                    <td><code style="font-size:12px">${esc(eq.inventory_number)}</code></td>
                    <td>
                      <span style="font-weight:600">${eq.category_icon || ''} ${esc(eq.name)}</span>
                      ${eq.serial_number ? `<div style="font-size:11px;color:var(--text-muted)">S/N: ${esc(eq.serial_number)}</div>` : ''}
                    </td>
                    <td>${esc(eq.category_name || '—')}</td>
                    <td>📍 ${esc(eq.object_name || '—')}</td>
                    <td>${eq.work_number ? `📋 ${esc(eq.work_number)}` : '—'}</td>
                    <td><span style="color:${cond.color}">${cond.label}</span></td>
                  </tr>
                `;
              }).join('') : `
                <tr>
                  <td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">
                    <div style="font-size:48px;margin-bottom:16px">📦</div>
                    <div>У вас нет выданного оборудования</div>
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    await layout(html, { title: title || 'Моё оборудование', motto: 'Оборудование в вашем распоряжении' });
    
    // События
    $('#selectAllMy')?.addEventListener('change', (e) => {
      $$('.my-eq-check').forEach(cb => cb.checked = e.target.checked);
    });
    
    $('#btnReturnRequest')?.addEventListener('click', async () => {
      const selected = Array.from($$('.my-eq-check:checked')).map(cb => cb.value);
      if (selected.length === 0) {
        toast('Внимание', 'Выберите оборудование для возврата', 'warn');
        return;
      }
      
      const conditionOptions = Object.entries(CONDITIONS).map(([k, v]) => 
        `<option value="${k}">${v.label}</option>`
      ).join('');
      
      showModal('📥 Возврат на склад', `
        <div class="stack" style="gap:16px">
          <p>Выбрано оборудования: <b>${selected.length}</b></p>
          
          <div>
            <label>Состояние при возврате</label>
            <select class="inp" id="returnCondition">${conditionOptions}</select>
          </div>
          
          <div>
            <label>Примечание</label>
            <textarea class="inp" id="returnNotes" rows="2"></textarea>
          </div>
          
          <div class="row" style="gap:10px;justify-content:flex-end">
            <button class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>
            <button class="btn primary" id="btnConfirmReturn">📥 Вернуть</button>
          </div>
        </div>
      `);
      
      $('#btnConfirmReturn')?.addEventListener('click', async () => {
        const condition = $('#returnCondition').value;
        const notes = $('#returnNotes').value;
        
        let success = 0;
        for (const eqId of selected) {
          try {
            const resp = await fetch('/api/equipment/return', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + auth.token
              },
              body: JSON.stringify({
                equipment_id: parseInt(eqId),
                condition_after: condition,
                notes
              })
            });
            const data = await resp.json();
            if (data.success) success++;
          } catch(e) {}
        }
        
        closeModal();
        toast('Возврат', `Возвращено: ${success} из ${selected.length}`, 'ok');
        location.reload();
      });
    });
    
    $('#btnTransferRequest')?.addEventListener('click', async () => {
      const selected = Array.from($$('.my-eq-check:checked')).map(cb => cb.value);
      if (selected.length === 0) {
        toast('Внимание', 'Выберите оборудование для передачи', 'warn');
        return;
      }
      
      // Загружаем список РП
      let pmOptions = '';
      try {
        const resp = await fetch('/api/users?role=PM', {
          headers: { 'Authorization': 'Bearer ' + auth.token }
        });
        const data = await resp.json();
        (data.users || []).filter(u => u.id !== userId).forEach(u => {
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
          workOptions += `<option value="${w.id}">${esc(w.work_number || '')} — ${esc(w.work_title || '')}</option>`;
        });
      } catch(e) {}
      
      const objectOptions = objects.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('');
      
      showModal('📤 Запрос на передачу', `
        <div class="stack" style="gap:16px">
          <p>Выбрано оборудования: <b>${selected.length}</b></p>
          
          <div>
            <label>Кому передать (РП) *</label>
            <select class="inp" id="transferTo">${pmOptions}</select>
          </div>
          
          <div>
            <label>Для какой работы *</label>
            <select class="inp" id="transferWork">${workOptions}</select>
          </div>
          
          <div>
            <label>Объект</label>
            <select class="inp" id="transferObject">${objectOptions}</select>
          </div>
          
          <div>
            <label>Примечание</label>
            <textarea class="inp" id="transferNotes" rows="2"></textarea>
          </div>
          
          <div class="row" style="gap:10px;justify-content:flex-end">
            <button class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>
            <button class="btn primary" id="btnConfirmTransfer">📤 Отправить запрос</button>
          </div>
        </div>
      `);
      
      $('#btnConfirmTransfer')?.addEventListener('click', async () => {
        const targetId = $('#transferTo').value;
        const workId = $('#transferWork').value;
        const objectId = $('#transferObject').value;
        const notes = $('#transferNotes').value;
        
        if (!targetId || !workId) {
          toast('Ошибка', 'Заполните обязательные поля', 'err');
          return;
        }
        
        let success = 0;
        for (const eqId of selected) {
          try {
            const resp = await fetch('/api/equipment/transfer-request', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + auth.token
              },
              body: JSON.stringify({
                equipment_id: parseInt(eqId),
                target_holder_id: parseInt(targetId),
                work_id: parseInt(workId),
                object_id: objectId ? parseInt(objectId) : null,
                notes
              })
            });
            const data = await resp.json();
            if (data.success) success++;
          } catch(e) {}
        }
        
        closeModal();
        toast('Запрос', `Создано запросов: ${success} из ${selected.length}`, 'ok');
      });
    });
  }
  
  return { render };
})();
