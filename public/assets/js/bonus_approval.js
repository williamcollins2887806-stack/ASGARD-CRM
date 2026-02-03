/**
 * АСГАРД CRM — Согласование премий
 * Этап 33
 * 
 * Workflow:
 * 1. РП вводит расходы по ФОТ на работу
 * 2. РП нажимает "Согласовать премию" → открывается форма
 * 3. РП указывает суммы премий для каждого рабочего + комментарий
 * 4. Отправляет на согласование директору
 * 5. Директор: Согласовать / Отклонить / Вопрос
 * 6. При согласовании — премии авто-разносятся по рабочим
 * 7. РП НЕ может вводить премии вручную (только через согласование)
 */
window.AsgardBonusApproval = (function(){
  
  const BONUS_STATUSES = {
    draft: { name: 'Черновик', color: 'var(--text-muted)' },
    pending: { name: 'На согласовании', color: 'var(--amber)' },
    approved: { name: 'Согласовано', color: 'var(--green)' },
    rejected: { name: 'Отклонено', color: 'var(--red)' },
    question: { name: 'Вопрос', color: 'var(--blue)' }
  };

  // CRUD
  async function getAll() {
    try {
      return await AsgardDB.getAll('bonus_requests') || [];
    } catch(e) {
      const data = localStorage.getItem('asgard_bonus_requests');
      return data ? JSON.parse(data) : [];
    }
  }

  async function getByWork(workId) {
    const all = await getAll();
    return all.filter(b => b.work_id === workId);
  }

  async function getByPm(pmId) {
    const all = await getAll();
    return all.filter(b => b.pm_id === pmId);
  }

  async function getPending() {
    const all = await getAll();
    return all.filter(b => b.status === 'pending');
  }

  async function save(request) {
    try {
      await AsgardDB.put('bonus_requests', request);
    } catch(e) {
      const all = await getAll();
      const idx = all.findIndex(r => r.id === request.id);
      if (idx >= 0) all[idx] = request;
      else all.push(request);
      localStorage.setItem('asgard_bonus_requests', JSON.stringify(all));
    }
  }

  async function remove(id) {
    try {
      await AsgardDB.delete('bonus_requests', id);
    } catch(e) {
      const all = await getAll();
      localStorage.setItem('asgard_bonus_requests', JSON.stringify(all.filter(r => r.id !== id)));
    }
  }

  // Открыть форму согласования премий (вызывается из pm_works или work_expenses)
  async function openBonusModal(workId, onComplete) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) return;
    const user = auth.user;
    
    // Получаем работу
    const work = await AsgardDB.get('works', workId);
    if (!work) {
      AsgardUI.toast('Ошибка', 'Работа не найдена', 'err');
      return;
    }
    
    // Получаем назначенных рабочих
    const assignments = await AsgardDB.byIndex('employee_assignments', 'work_id', workId) || [];
    const employees = await AsgardDB.getAll('employees') || [];
    const empMap = new Map(employees.map(e => [e.id, e]));
    
    // Рабочие на этой работе
    const workers = assignments.map(a => ({
      ...a,
      employee: empMap.get(a.employee_id)
    })).filter(w => w.employee);
    
    if (workers.length === 0) {
      AsgardUI.toast('Ошибка', 'На работе нет назначенных рабочих', 'err');
      return;
    }
    
    // Проверяем, нет ли уже pending запроса
    const existing = await getByWork(workId);
    const pending = existing.find(e => e.status === 'pending');
    if (pending) {
      AsgardUI.toast('Внимание', 'Уже есть запрос на согласовании', 'warn');
      return;
    }
    
    const html = `
      <div class="modal-overlay" id="bonusModal">
        <div class="modal-content" style="max-width:700px">
          <div class="modal-header">
            <h3>Согласование премий</h3>
            <button class="btn ghost btnClose">✕</button>
          </div>
          <div class="modal-body" style="max-height:70vh;overflow-y:auto">
            <div style="margin-bottom:16px">
              <div class="help">Работа:</div>
              <div style="font-weight:600">${esc(work.work_title || work.work_name || 'ID:' + workId)}</div>
            </div>
            
            <div class="tbl-wrap">
              <table class="tbl" id="bonusTable">
                <thead>
                  <tr>
                    <th>Рабочий</th>
                    <th>Должность</th>
                    <th>Период работы</th>
                    <th style="width:120px">Премия (₽)</th>
                  </tr>
                </thead>
                <tbody>
                  ${workers.map((w, i) => `
                    <tr data-emp-id="${w.employee_id}">
                      <td><strong>${esc(w.employee.fio || w.employee.full_name || 'Рабочий')}</strong></td>
                      <td>${esc(w.employee.role_tag || w.role_on_work || '—')}</td>
                      <td>${w.date_from || '—'} — ${w.date_to || '—'}</td>
                      <td><input type="number" class="inp bonusAmount" data-idx="${i}" min="0" step="100" value="0" style="width:100%"/></td>
                    </tr>
                  `).join('')}
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="3" style="text-align:right;font-weight:600">Итого:</td>
                    <td><strong id="bonusTotal">0 ₽</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            
            <div class="field" style="margin-top:16px">
              <label>Обоснование премий *</label>
              <textarea id="bonusComment" class="inp" rows="3" placeholder="За что начисляется премия, обоснование суммы..."></textarea>
            </div>
          </div>
          <div class="modal-footer" style="display:flex;gap:12px;justify-content:flex-end;padding:16px">
            <button class="btn ghost btnClose">Отмена</button>
            <button class="btn primary" id="btnSubmitBonus">Отправить на согласование</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById('bonusModal');
    
    // Закрытие
    modal.querySelectorAll('.btnClose').forEach(b => b.onclick = () => modal.remove());
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    
    // Пересчёт итого
    const recalcTotal = () => {
      let total = 0;
      document.querySelectorAll('.bonusAmount').forEach(inp => {
        total += Number(inp.value) || 0;
      });
      document.getElementById('bonusTotal').textContent = formatMoney(total);
    };
    
    document.querySelectorAll('.bonusAmount').forEach(inp => {
      inp.addEventListener('input', recalcTotal);
    });
    
    // Отправка
    document.getElementById('btnSubmitBonus').onclick = async () => {
      const comment = document.getElementById('bonusComment').value.trim();
      if (!comment) {
        AsgardUI.toast('Ошибка', 'Укажите обоснование', 'err');
        return;
      }
      
      // Собираем суммы
      const bonuses = [];
      let total = 0;
      document.querySelectorAll('#bonusTable tbody tr').forEach(row => {
        const empId = Number(row.dataset.empId);
        const amount = Number(row.querySelector('.bonusAmount').value) || 0;
        if (amount > 0) {
          bonuses.push({ employee_id: empId, amount });
          total += amount;
        }
      });
      
      if (total === 0) {
        AsgardUI.toast('Ошибка', 'Укажите хотя бы одну премию', 'err');
        return;
      }
      
      // Создаём запрос
      const request = {
        id: undefined,
        work_id: workId,
        work_title: work.work_title || work.work_name,
        pm_id: user.id,
        pm_name: user.name || user.login,
        bonuses: bonuses,
        total_amount: total,
        comment: comment,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      await save(request);
      
      // Уведомляем директоров (сайт + Telegram)
      const users = await AsgardDB.getAll('users') || [];
      const directors = users.filter(u => 
        u.role === 'DIRECTOR_GEN' || 
        u.role === 'DIRECTOR_COMM' || 
        u.role === 'DIRECTOR_DEV' ||
        u.role === 'ADMIN' ||
        u.role === 'DIR' ||
        u.role === 'FIN_DIR'
      );
      
      for (const d of directors) {
        try {
          // Уведомление на сайте
          await AsgardDB.add('notifications', {
            user_id: d.id,
            title: 'Запрос на согласование премий',
            message: `РП ${user.name || user.login} запрашивает согласование премий на сумму ${formatMoney(total)}`,
            type: 'bonus_request',
            entity_id: request.id,
            is_read: false,
            created_at: new Date().toISOString()
          });
          
          // Telegram уведомление
          const auth = await AsgardAuth.getAuth();
          if (auth?.token) {
            fetch('/api/notifications/approval', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + auth.token
              },
              body: JSON.stringify({
                type: 'bonus',
                action: 'created',
                entityId: request.id,
                toUserId: d.id,
                details: `РП ${user.name || user.login} запрашивает согласование премий.\nРабота: ${work.work_title || work.work_name}\nСумма: ${formatMoney(total)}`
              })
            }).catch(() => {});
          }
        } catch(e) {}
      }
      
      modal.remove();
      AsgardUI.toast('Отправлено', 'Запрос на согласование отправлен директору', 'ok');
      if (onComplete) onComplete();
    };
  }

  // Рендер страницы согласования (для директора)
  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = "#/login"; return; }
    
    const user = auth.user;
    const isDirector = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user.role);
    const isPM = user.role === 'PM';
    
    if (!isDirector && !isPM) {
      AsgardUI.toast('Доступ', 'Недостаточно прав', 'err');
      location.hash = '#/home';
      return;
    }
    
    let requests = await getAll();
    const employees = await AsgardDB.getAll('employees') || [];
    const empMap = new Map(employees.map(e => [e.id, e]));
    
    // Для РП показываем только его запросы
    if (isPM && !isDirector) {
      requests = requests.filter(r => r.pm_id === user.id);
    }
    
    // Сортировка: pending первые, потом по дате
    requests.sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return new Date(b.created_at) - new Date(a.created_at);
    });
    
    const pendingCount = requests.filter(r => r.status === 'pending').length;
    
    const html = `
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">
          <div>
            <span class="help">Всего запросов: ${requests.length}</span>
            ${pendingCount > 0 ? `<span class="badge" style="background:var(--amber);color:#000;margin-left:8px">⏳ На согласовании: ${pendingCount}</span>` : ''}
          </div>
          <select id="fltStatus" class="inp" style="width:180px">
            <option value="">Все статусы</option>
            ${Object.entries(BONUS_STATUSES).map(([id, s]) => `<option value="${id}">${s.name}</option>`).join('')}
          </select>
        </div>
        
        ${requests.length === 0 ? '<div class="help" style="text-align:center;padding:40px">Запросов на согласование премий нет</div>' : `
          <div id="requestsList">
            ${requests.map(r => renderRequestCard(r, empMap, isDirector)).join('')}
          </div>
        `}
      </div>
    `;
    
    await layout(html, { title: title || 'Согласование премий' });
    
    // Фильтр по статусу
    document.getElementById('fltStatus')?.addEventListener('change', (e) => {
      const status = e.target.value;
      document.querySelectorAll('.bonus-request-card').forEach(card => {
        if (!status || card.dataset.status === status) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    });
    
    // Обработчики кнопок
    attachRequestHandlers(empMap, isDirector);
  }

  function renderRequestCard(request, empMap, isDirector) {
    // Безопасно парсим bonuses (JSONB может прийти как строка из API)
    let bonuses = [];
    try {
      if (typeof request.bonuses === 'string') {
        bonuses = JSON.parse(request.bonuses);
      } else if (Array.isArray(request.bonuses)) {
        bonuses = request.bonuses;
      }
    } catch(e) {
      console.warn('Parse bonuses error:', e);
      bonuses = [];
    }
    request.bonuses = bonuses;
    
    const status = BONUS_STATUSES[request.status] || BONUS_STATUSES.draft;
    
    return `
      <div class="card bonus-request-card" data-id="${request.id}" data-status="${request.status}" style="margin-bottom:16px;padding:16px;border-left:4px solid ${status.color}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
          <div>
            <div style="font-weight:600">${esc(request.work_title || 'Работа')}</div>
            <div class="help">РП: ${esc(request.pm_name)} · ${formatDateTime(request.created_at)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:20px;font-weight:bold">${formatMoney(request.total_amount)}</div>
            <span class="badge" style="background:${status.color}20;color:${status.color}">${status.name}</span>
          </div>
        </div>
        
        <div style="margin-top:12px">
          <div class="help" style="margin-bottom:8px">Распределение:</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${(request.bonuses || []).map(b => {
              const emp = empMap.get(b.employee_id);
              return `<span class="badge" style="background:var(--bg-elevated)">${esc(emp?.fio || emp?.full_name || 'ID:' + b.employee_id)}: ${formatMoney(b.amount)}</span>`;
            }).join('')}
          </div>
        </div>
        
        <div style="margin-top:12px;padding:10px;background:var(--bg-elevated);border-radius:8px">
          <div class="help">Обоснование:</div>
          <div>${esc(request.comment)}</div>
        </div>
        
        ${request.director_comment ? `
          <div style="margin-top:12px;padding:10px;background:var(--bg-card);border-radius:8px;border-left:3px solid ${status.color}">
            <div class="help">Ответ директора:</div>
            <div>${esc(request.director_comment)}</div>
          </div>
        ` : ''}
        
        ${isDirector && request.status === 'pending' ? `
          <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn green btnApprove">✓ Согласовать</button>
            <button class="btn red btnReject">✕ Отклонить</button>
            <button class="btn ghost btnQuestion">? Вопрос</button>
          </div>
        ` : ''}
      </div>
    `;
  }

  function attachRequestHandlers(empMap, isDirector) {
    console.log('🟢 attachRequestHandlers called, isDirector:', isDirector);
    const cards = document.querySelectorAll('.bonus-request-card');
    console.log('🟢 Found cards:', cards.length);
    document.querySelectorAll('.bonus-request-card').forEach(card => {
      console.log('🟡 Processing card, id:', card.dataset.id);
      const id = card.dataset.id;
      
      card.querySelector('.btnApprove')?.addEventListener('click', async () => {
        console.log('🔴 CLICK on Approve button! Card id:', id);
        alert('Кнопка нажата! ID: ' + id);
        console.log('🔴 Before confirm dialog');
        if (!confirm('Согласовать премии?')) {
          console.log('🔴 User cancelled confirm');
          return;
        }
        console.log('🔴 User confirmed, calling processRequest');
        await processRequest(id, 'approved', null, empMap);
      });
      
      card.querySelector('.btnReject')?.addEventListener('click', async () => {
        const comment = prompt('Причина отклонения:');
        if (comment === null) return;
        await processRequest(id, 'rejected', comment);
      });
      
      card.querySelector('.btnQuestion')?.addEventListener('click', async () => {
        const comment = prompt('Ваш вопрос РП:');
        if (!comment) return;
        await processRequest(id, 'question', comment);
      });
    });
  }

  async function processRequest(requestId, newStatus, directorComment, empMap) {
    console.log('🟣 processRequest START', {requestId, newStatus});
    const all = await getAll();
    const request = all.find(r => r.id === Number(requestId) || r.id === requestId);
    
    if (!request) {
      console.error('🔴 Request not found! ID:', requestId);
      AsgardUI.toast('Ошибка', 'Заявка не найдена', 'err');
      return;
    }
    
    // Безопасно парсим bonuses
    if (typeof request.bonuses === 'string') {
      try { request.bonuses = JSON.parse(request.bonuses); } catch(e) { request.bonuses = []; }
    }
    if (!Array.isArray(request.bonuses)) request.bonuses = [];
    
    console.log('🟣 Found request:', request);
    
    const auth = await AsgardAuth.requireUser();
    
    request.status = newStatus;
    request.director_comment = directorComment || '';
    request.processed_by = auth?.user?.id;
    request.processed_at = new Date().toISOString();
    request.updated_at = new Date().toISOString();
    
    // Сериализуем bonuses в JSON-строку для PostgreSQL JSONB
    if (Array.isArray(request.bonuses)) {
      request.bonuses = JSON.stringify(request.bonuses);
    }
    
    await save(request);
    
    // Если согласовано — создаём расходы по премиям
    if (newStatus === 'approved') {
      for (const b of (request.bonuses || [])) {
        try {
          await AsgardDB.add('work_expenses', {
            work_id: request.work_id,
            category: 'fot_bonus',
            amount: b.amount,
            date: new Date().toISOString().slice(0, 10),
            employee_id: b.employee_id,
            comment: `Премия (согласовано): ${request.comment}`,
            bonus_request_id: request.id,
            created_by: auth?.user?.id,
            created_at: new Date().toISOString()
          });
        } catch(e) {
          console.error('Error creating bonus expense:', e);
        }
      }
    }
    
    // Перерисовываем список после изменения
    setTimeout(() => location.reload(), 1000); // Перезагружаем после успешного сохранения

    // Уведомление РП (сайт + Telegram)
    try {
      const statusText = BONUS_STATUSES[newStatus]?.name || newStatus;
      await AsgardDB.add('notifications', {
        user_id: request.pm_id,
        title: `Премии: ${statusText}`,
        message: newStatus === 'approved' 
          ? `Ваш запрос на премии ${formatMoney(request.total_amount)} согласован`
          : `Ваш запрос на премии: ${statusText}. ${directorComment || ''}`,
        type: 'bonus_response',
        entity_id: request.id,
        is_read: false,
        created_at: new Date().toISOString()
      });
      
      // Telegram уведомление РП
      const authData = await AsgardAuth.getAuth();
      if (authData?.token) {
        const tgMessage = newStatus === 'approved'
          ? `Ваш запрос на премии (${formatMoney(request.total_amount)}) согласован!`
          : `Ваш запрос на премии отклонён. ${directorComment || ''}`;
        
        fetch('/api/notifications/approval', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + authData.token
          },
          body: JSON.stringify({
            type: 'bonus',
            action: newStatus,
            entityId: request.id,
            toUserId: request.pm_id,
            details: tgMessage
          })
        }).catch(() => {});
      }
    } catch(e) {}
    
    AsgardUI.toast('Готово', `Запрос ${BONUS_STATUSES[newStatus]?.name.toLowerCase()}`, 'ok');
    
    // Перерендер страницы
    render({ layout: window.layout, title: 'Согласование премий' });
  }

  // Проверка: можно ли РП вводить премию вручную
  // Возвращает false — премии только через согласование
  function canManualBonus(userRole) {
    // Директора могут вводить напрямую
    if (['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(userRole)) {
      return true;
    }
    // РП — только через согласование
    return false;
  }

  // Helpers
  function esc(s) { return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function formatMoney(n) { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(n || 0); }
  function formatDateTime(d) { return d ? new Date(d).toLocaleString('ru-RU') : ''; }

  return {
    render,
    openBonusModal,
    getAll,
    getByWork,
    getByPm,
    getPending,
    save,
    remove,
    canManualBonus,
    BONUS_STATUSES
  };
})();
