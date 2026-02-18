/**
 * АСГАРД CRM — Система напоминаний
 * 
 * Функции:
 * - Автонапоминания о дедлайнах
 * - Напоминания о просроченных счетах
 * - Напоминания о завершении работ
 * - Пользовательские напоминания
 */
window.AsgardReminders = (function(){
  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;

  // Загружаем настройку автоудаления при инициализации модуля
  (async () => {
    try {
      const s = await AsgardDB.get('settings', 'app');
      const cfg = s ? JSON.parse(s.value_json || '{}') : {};
      window._asg_reminder_hours = cfg.reminder_auto_delete_hours || 48;
    } catch (_) {
      window._asg_reminder_hours = 48;
    }
  })();

  // Функция расчёта оставшегося времени до удаления
  function timeLeft(completedAt) {
    const hours = window._asg_reminder_hours || 48;
    const deadline = new Date(new Date(completedAt).getTime() + hours * 3600000);
    const diff = deadline - Date.now();
    if (diff <= 0) return '<span style="color:var(--red)">Удаляется...</span>';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `<span style="color:var(--text-muted)">удалится через ${h}ч ${m}м</span>`;
  }
  
  const REMINDER_TYPES = {
    deadline: { label: 'Дедлайн', icon: '⏰', color: 'var(--amber)' },
    invoice: { label: 'Счёт', icon: '💰', color: 'var(--err-t)' },
    work: { label: 'Работа', icon: '🔧', color: 'var(--info)' },
    tender: { label: 'Тендер', icon: '📋', color: 'var(--purple)' },
    custom: { label: 'Напоминание', icon: '🔔', color: 'var(--t2)' }
  };
  
  const REMINDER_PRIORITIES = {
    low: { label: 'Низкий', color: 'var(--t2)' },
    normal: { label: 'Обычный', color: 'var(--info)' },
    high: { label: 'Высокий', color: 'var(--amber)' },
    urgent: { label: 'Срочный', color: 'var(--err-t)' }
  };
  
  // CRUD
  async function getAll() {
    return await AsgardDB.all('reminders') || [];
  }
  
  async function getActive() {
    const all = await getAll();
    return all.filter(r => !r.completed && !r.dismissed);
  }
  
  async function getByUser(userId) {
    const all = await getAll();
    return all.filter(r => r.user_id === userId && !r.completed && !r.dismissed);
  }
  
  async function save(reminder) {
    reminder.updated_at = new Date().toISOString();
    if (!reminder.id) {
      reminder.id = reminder.id || undefined;
      reminder.created_at = new Date().toISOString();
    }
    await AsgardDB.put('reminders', reminder);
    return reminder;
  }
  
  async function complete(id) {
    const r = await AsgardDB.get('reminders', id);
    if (r) {
      r.completed = true;
      r.completed_at = new Date().toISOString();
      await save(r);
    }
  }
  
  async function dismiss(id) {
    const r = await AsgardDB.get('reminders', id);
    if (r) {
      r.dismissed = true;
      r.dismissed_at = new Date().toISOString();
      await save(r);
    }
  }
  
  async function remove(id) {
    await AsgardDB.del('reminders', id);
  }
  
  // Проверка и создание автонапоминаний
  async function checkAndCreateAutoReminders() {
    const auth = await AsgardAuth.getAuth();
    if (!auth?.user) return;
    
    const user = auth.user;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    
    const reminders = await getAll();
    const existingKeys = new Set(reminders.map(r => r.auto_key));
    
    const newReminders = [];
    
    // 1. Просроченные счета
    if (window.AsgardInvoicesPage) {
      try {
        const invoices = await AsgardDB.all('invoices') || [];
        for (const inv of invoices) {
          if (inv.status === 'paid' || inv.status === 'cancelled') continue;
          if (!inv.due_date) continue;
          
          const dueDate = new Date(inv.due_date);
          const diffDays = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
          
          // Напоминание за 3 дня до срока
          if (diffDays === 3) {
            const key = `invoice_due_3_${inv.id}`;
            if (!existingKeys.has(key)) {
              newReminders.push({
                type: 'invoice',
                priority: 'normal',
                title: 'Счёт скоро просрочится',
                message: `Счёт ${inv.invoice_number} — срок оплаты через 3 дня`,
                entity_type: 'invoice',
                entity_id: inv.id,
                due_date: inv.due_date,
                user_id: user.id,
                auto_key: key
              });
            }
          }
          
          // Напоминание в день срока
          if (diffDays === 0) {
            const key = `invoice_due_0_${inv.id}`;
            if (!existingKeys.has(key)) {
              newReminders.push({
                type: 'invoice',
                priority: 'high',
                title: 'Сегодня срок оплаты!',
                message: `Счёт ${inv.invoice_number} — сегодня последний день оплаты`,
                entity_type: 'invoice',
                entity_id: inv.id,
                due_date: inv.due_date,
                user_id: user.id,
                auto_key: key
              });
            }
          }
          
          // Просроченный счёт
          if (diffDays < 0 && diffDays >= -1) {
            const key = `invoice_overdue_${inv.id}`;
            if (!existingKeys.has(key)) {
              newReminders.push({
                type: 'invoice',
                priority: 'urgent',
                title: 'Счёт просрочен!',
                message: `Счёт ${inv.invoice_number} просрочен на ${Math.abs(diffDays)} дн.`,
                entity_type: 'invoice',
                entity_id: inv.id,
                due_date: inv.due_date,
                user_id: user.id,
                auto_key: key
              });
            }
          }
        }
      } catch (e) {}
    }
    
    // 2. Дедлайны тендеров
    try {
      const tenders = await AsgardDB.all('tenders') || [];
      for (const t of tenders) {
        if (!t.deadline_date) continue;
        if (t.tender_status === 'Клиент согласился' || t.tender_status === 'Клиент отказался') continue;
        
        // Только для ответственного РП или админа
        if (t.responsible_pm_id !== user.id && user.role !== 'ADMIN') continue;
        
        const deadline = new Date(t.deadline_date);
        const diffDays = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
          const key = `tender_deadline_1_${t.id}`;
          if (!existingKeys.has(key)) {
            newReminders.push({
              type: 'tender',
              priority: 'high',
              title: 'Дедлайн тендера завтра!',
              message: `${t.tender_title || t.customer_name} — дедлайн завтра`,
              entity_type: 'tender',
              entity_id: t.id,
              due_date: t.deadline_date,
              user_id: user.id,
              auto_key: key
            });
          }
        }
        
        if (diffDays === 0) {
          const key = `tender_deadline_0_${t.id}`;
          if (!existingKeys.has(key)) {
            newReminders.push({
              type: 'tender',
              priority: 'urgent',
              title: 'Дедлайн тендера СЕГОДНЯ!',
              message: `${t.tender_title || t.customer_name} — дедлайн сегодня`,
              entity_type: 'tender',
              entity_id: t.id,
              due_date: t.deadline_date,
              user_id: user.id,
              auto_key: key
            });
          }
        }
      }
    } catch (e) {}
    
    // 3. Окончание работ
    try {
      const works = await AsgardDB.all('works') || [];
      for (const w of works) {
        if (!w.work_end_plan) continue;
        if (w.work_status === 'Работы сдали') continue;
        
        if (w.pm_id !== user.id && user.role !== 'ADMIN') continue;
        
        const endDate = new Date(w.work_end_plan);
        const diffDays = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 3) {
          const key = `work_end_3_${w.id}`;
          if (!existingKeys.has(key)) {
            newReminders.push({
              type: 'work',
              priority: 'normal',
              title: 'Работа завершается через 3 дня',
              message: `${w.work_title || w.customer_name} — план. окончание через 3 дня`,
              entity_type: 'work',
              entity_id: w.id,
              due_date: w.work_end_plan,
              user_id: user.id,
              auto_key: key
            });
          }
        }
      }
    } catch (e) {}
    
    // Сохраняем новые напоминания
    for (const r of newReminders) {
      await save(r);
    }
    
    return newReminders.length;
  }
  
  // Отображение виджета напоминаний
  async function renderWidget() {
    const auth = await AsgardAuth.getAuth();
    if (!auth?.user) return '';
    
    const reminders = await getByUser(auth.user.id);
    const active = reminders.filter(r => {
      if (r.completed || r.dismissed) return false;
      if (r.due_date) {
        const due = new Date(r.due_date);
        const now = new Date();
        const diffDays = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
        return diffDays <= 7; // Показываем на ближайшую неделю
      }
      return true;
    }).sort((a, b) => {
      // Сначала по приоритету, потом по дате
      const pOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
      const pDiff = (pOrder[a.priority] || 2) - (pOrder[b.priority] || 2);
      if (pDiff !== 0) return pDiff;
      return new Date(a.due_date || '9999') - new Date(b.due_date || '9999');
    });
    
    if (active.length === 0) {
      return '<div class="muted" style="padding:16px;text-align:center">Нет активных напоминаний</div>';
    }
    
    return `
      <div class="reminders-widget">
        ${active.slice(0, 5).map(r => {
          const type = REMINDER_TYPES[r.type] || REMINDER_TYPES.custom;
          const priority = REMINDER_PRIORITIES[r.priority] || REMINDER_PRIORITIES.normal;
          
          return `
            <div class="reminder-item" style="border-left:3px solid ${priority.color}">
              <div class="reminder-header">
                <span style="color:${type.color}">${type.icon}</span>
                <span class="reminder-title">${esc(r.title)}</span>
                <button class="btn mini ghost" data-dismiss-rem="${r.id}" title="Скрыть">✕</button>
              </div>
              <div class="reminder-message">${esc(r.message)}</div>
              ${r.due_date ? `<div class="reminder-due">📅 ${new Date(r.due_date).toLocaleDateString('ru-RU')}</div>` : ''}
            </div>
          `;
        }).join('')}
        ${active.length > 5 ? `<div class="muted" style="text-align:center;padding:8px">+${active.length - 5} ещё</div>` : ''}
      </div>
    `;
  }
  
  // Открыть форму создания напоминания
  async function openCreateModal(options = {}) {
    const auth = await AsgardAuth.getAuth();
    if (!auth?.user) return;
    
    const typeOptions = Object.entries(REMINDER_TYPES).map(([k, v]) =>
      `<option value="${k}" ${options.type === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`
    ).join('');
    
    const priorityOptions = Object.entries(REMINDER_PRIORITIES).map(([k, v]) =>
      `<option value="${k}" ${(options.priority || 'normal') === k ? 'selected' : ''}>${v.label}</option>`
    ).join('');
    
    const html = `
      <div class="stack" style="gap:16px">
        <div class="formrow">
          <div>
            <label>Тип</label>
            <select class="inp" id="rem_type">${typeOptions}</select>
          </div>
          <div>
            <label>Приоритет</label>
            <select class="inp" id="rem_priority">${priorityOptions}</select>
          </div>
        </div>
        
        <div>
          <label>Заголовок</label>
          <input class="inp" id="rem_title" value="${esc(options.title || '')}" placeholder="О чём напомнить?"/>
        </div>
        
        <div>
          <label>Описание</label>
          <textarea class="inp" id="rem_message" rows="3" placeholder="Подробности...">${esc(options.message || '')}</textarea>
        </div>
        
        <div class="formrow">
          <div>
            <label>Дата напоминания</label>
            <input class="inp" id="rem_date" type="date" value="${options.due_date || ''}"/>
          </div>
          <div>
            <label>Время</label>
            <input class="inp" id="rem_time" type="time" value="${options.due_time || '09:00'}"/>
          </div>
        </div>
        
        <div class="row" style="gap:10px;justify-content:flex-end">
          <button class="btn ghost" id="remCancel">Отмена</button>
          <button class="btn primary" id="remSave">🔔 Создать</button>
        </div>
      </div>
    `;
    
    showModal('🔔 Новое напоминание', html);
    
    $('#remCancel')?.addEventListener('click', closeModal);
    
    $('#remSave')?.addEventListener('click', async () => {
      const title = $('#rem_title').value.trim();
      if (!title) {
        toast('Ошибка', 'Укажите заголовок', 'err');
        return;
      }
      
      const reminder = {
        type: $('#rem_type').value,
        priority: $('#rem_priority').value,
        title: title,
        message: $('#rem_message').value.trim(),
        due_date: $('#rem_date').value || null,
        due_time: $('#rem_time').value || null,
        user_id: auth.user.id,
        entity_type: options.entity_type || null,
        entity_id: options.entity_id || null
      };
      
      await save(reminder);
      closeModal();
      toast('Напоминание', 'Создано', 'ok');
    });
  }
  
  // Страница напоминаний
  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    
    // Проверяем автонапоминания
    await checkAndCreateAutoReminders();
    
    const reminders = await getByUser(auth.user.id);
    
    const active = reminders.filter(r => !r.completed && !r.dismissed);
    const completed = reminders.filter(r => r.completed);
    
    function renderList(list, showActions = true, isCompleted = false) {
      if (list.length === 0) {
        return '<div class="muted" style="padding:20px;text-align:center">Нет напоминаний</div>';
      }

      return list.map(r => {
        const type = REMINDER_TYPES[r.type] || REMINDER_TYPES.custom;
        const priority = REMINDER_PRIORITIES[r.priority] || REMINDER_PRIORITIES.normal;

        return `
          <div class="card" style="border-left:4px solid ${isCompleted ? 'var(--text-muted)' : priority.color};padding:16px;margin-bottom:12px;${isCompleted ? 'opacity:0.8;' : ''}">
            <div class="row" style="justify-content:space-between;align-items:flex-start">
              <div>
                <div style="font-weight:600;margin-bottom:4px">
                  <span style="color:${type.color}">${type.icon}</span> ${esc(r.title)}
                  ${isCompleted ? '<span style="margin-left:8px;color:var(--green)">✓</span>' : ''}
                </div>
                <div class="muted" style="font-size:14px">${esc(r.message || '')}</div>
                ${r.due_date ? `<div style="margin-top:8px;font-size:13px">📅 ${new Date(r.due_date).toLocaleDateString('ru-RU')}</div>` : ''}
                ${isCompleted && r.completed_at ? `<div style="margin-top:6px;font-size:12px">${timeLeft(r.completed_at)}</div>` : ''}
              </div>
              ${showActions ? `
                <div class="row" style="gap:4px">
                  <button class="btn mini green" data-complete="${r.id}" title="Выполнено">✓</button>
                  <button class="btn mini ghost" data-dismiss="${r.id}" title="Скрыть">✕</button>
                </div>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');
    }
    
    const html = `
      <div class="page-header">
        <h1>🔔 Напоминания</h1>
        <button class="btn primary" id="btnNewReminder">+ Создать</button>
      </div>
      
      <div class="tabs" style="margin-bottom:20px">
        <button class="tab active" data-tab="active">Активные (${active.length})</button>
        <button class="tab" data-tab="completed">Выполненные (${completed.length})</button>
      </div>
      
      <div id="tab_active">${renderList(active)}</div>
      <div id="tab_completed" style="display:none">${renderList(completed, false, true)}</div>
    `;
    
    await layout(html, { title });

    // Вкладки
    $$('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        $('#tab_active').style.display = tab.dataset.tab === 'active' ? 'block' : 'none';
        $('#tab_completed').style.display = tab.dataset.tab === 'completed' ? 'block' : 'none';
      });
    });
    
    $('#btnNewReminder')?.addEventListener('click', () => openCreateModal());
    
    $$('[data-complete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await complete(btn.dataset.complete);
        toast('Напоминание', 'Выполнено', 'ok');
        render({ layout, title });
      });
    });
    
    $$('[data-dismiss]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await dismiss(btn.dataset.dismiss);
        render({ layout, title });
      });
    });
  }
  
  // Запуск проверки при загрузке
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(checkAndCreateAutoReminders, 5000);
  });
  
  return {
    render,
    getAll,
    getActive,
    getByUser,
    save,
    complete,
    dismiss,
    checkAndCreateAutoReminders,
    renderWidget,
    openCreateModal,
    REMINDER_TYPES,
    REMINDER_PRIORITIES
  };
})();
