/**
 * ASGARD CRM — Задачи и Todo-список (M3)
 * Двухпанельный интерфейс: слева задачи от руководства, справа личный todo
 */

window.AsgardTasksPage = (function() {
  'use strict';

  const STATUS_LABELS = {
    new: 'Новая',
    accepted: 'Принята',
    in_progress: 'В работе',
    done: 'Выполнена',
    overdue: 'Просрочена'
  };

  const STATUS_COLORS = {
    new: 'var(--amber)',
    accepted: 'var(--info)',
    in_progress: 'var(--orange)',
    done: 'var(--ok-t)',
    overdue: 'var(--err-t)'
  };

  function getStatusClass(status) {
    const map = {
      'new': 'new', 'accepted': 'in-progress', 'in_progress': 'working',
      'done': 'done', 'completed': 'done', 'overdue': 'error',
      'cancelled': 'rejected', 'review': 'in-progress', 'blocked': 'rejected'
    };
    return map[status] || 'pending';
  }

  const PRIORITY_LABELS = {
    low: 'Низкий',
    normal: 'Обычный',
    high: 'Высокий',
    urgent: 'Срочный'
  };

  const PRIORITY_COLORS = {
    urgent: 'var(--err-t)',
    high: 'var(--orange)',
    normal: 'var(--info)',
    low: 'var(--t2)'
  };

  let currentTasks = [];
  let currentTodo = [];
  let users = [];
  let expandedTaskId = null;
  let currentFilter = '';
  let isDirector = false;
  let _escapeHandler = null;
  let highlightTaskId = null;

  function parseTags(t) {
    let tags = t && t.tags;
    if (typeof tags === 'string') {
      try { tags = JSON.parse(tags); } catch (_) { tags = []; }
    }
    return Array.isArray(tags) ? tags.map(String) : [];
  }

  function sourceBadgesHtml(t) {
    const tags = parseTags(t);
    const badges = [];
    if (tags.includes('пропущенный') || tags.includes('перезвонить')) {
      badges.push('<span class="task-badge task-badge--missed">Пропущенный</span>');
    } else if (tags.includes('звонок')) {
      badges.push('<span class="task-badge task-badge--call">Звонок</span>');
    }
    if (t.task_kind === 'help') {
      badges.push('<span class="task-badge task-badge--help">Помощь</span>');
    } else if (!badges.length) {
      badges.push('<span class="task-badge">Поручение</span>');
    }
    if (tags.includes('нужен_исполнитель')) {
      badges.push('<span class="task-badge task-badge--assignee">Нужен исполнитель</span>');
    }
    return badges.length
      ? `<div class="task-source-badges">${badges.join('')}</div>`
      : '';
  }

  function openModal(el) {
    if (!el) return;
    if (el._tasksClosing) {
      clearTimeout(el._tasksClosing);
      el._tasksClosing = null;
    }
    el.classList.remove('is-leaving');
    el.style.display = '';
    el.classList.add('is-open');
    const focusable = el.querySelector('input, textarea, button, select');
    if (focusable) setTimeout(() => focusable.focus(), 0);
    if (!_escapeHandler) {
      _escapeHandler = (e) => {
        if (e.key === 'Escape') {
          closeCreateModal();
          closeCompleteModal();
        }
      };
      document.addEventListener('keydown', _escapeHandler);
    }
  }

  function closeModalEl(el) {
    if (!el || !el.classList.contains('is-open')) return;
    if (el._tasksClosing) return;
    el.classList.remove('is-open');
    el.classList.add('is-leaving');
    el._tasksClosing = setTimeout(() => {
      el._tasksClosing = null;
      el.classList.remove('is-leaving');
      el.style.display = '';
    }, 250);
  }

  // ─────────────────────────────────────────────────────────────────
  // API HELPERS
  // ─────────────────────────────────────────────────────────────────
  function getHeaders() {
    const auth = AsgardAuth.getAuth();
    return {
      'Authorization': 'Bearer ' + (auth?.token || ''),
      'Content-Type': 'application/json'
    };
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(val) {
    if (!val) return '';
    return new Date(val).toLocaleDateString('ru-RU');
  }

  function formatDateTime(val) {
    if (!val) return '';
    return new Date(val).toLocaleString('ru-RU');
  }

  function isOverdue(deadline) {
    if (!deadline) return false;
    return new Date(deadline) < new Date();
  }

  // ─────────────────────────────────────────────────────────────────
  // RENDER PAGE
  // ─────────────────────────────────────────────────────────────────
  async function render(container) {
    const auth = AsgardAuth.getAuth();
    if (!auth?.token) { location.hash = '#login'; return; }
    const role = auth?.user?.role || '';
    isDirector = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role);

    // Deep-link: #/tasks?id=123 или ?id= в query
    try {
      const hash = String(location.hash || '');
      const q = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : (location.search || '').replace(/^\?/, '');
      const idParam = new URLSearchParams(q).get('id');
      if (idParam) {
        highlightTaskId = parseInt(idParam, 10) || null;
        if (highlightTaskId) expandedTaskId = highlightTaskId;
      }
    } catch (_) { /* ignore */ }

    container.innerHTML = `
      <div class="tasks-page">
        <div>
          <div class="tasks-panel">
            <div class="tasks-panel-head">
              <h3>Задачи от руководства</h3>
              <div style="display:flex; gap:10px; align-items:center">
                <div id="crselect-taskFilter"></div>
                ${isDirector ? '<button class="btn" type="button" onclick="AsgardTasksPage.showCreateModal()">Создать задачу</button>' : ''}
              </div>
            </div>
            <div id="tasksList">
              <div style="text-align:center; padding:20px"><div class="spinner-border"></div></div>
            </div>
          </div>

          ${isDirector ? `
          <div class="tasks-panel" style="margin-top:20px">
            <h3 style="margin:0 0 12px">Мои поручения</h3>
            <div id="createdTasksList">
              <div style="text-align:center; padding:20px"><div class="spinner-border"></div></div>
            </div>
          </div>
          ` : ''}
        </div>

        <div>
          <div class="todo-panel">
            <h3 style="margin-bottom:15px">Мои дела <span id="todoCounter" style="font-size:0.8em; color:var(--dim)"></span></h3>
            <div class="todo-add">
              <input type="text" id="todoInput" class="inp" placeholder="Что нужно сделать..." style="flex:1"
                onkeydown="if(event.key==='Enter') AsgardTasksPage.addTodo()"/>
              <button class="btn" type="button" onclick="AsgardTasksPage.addTodo()">+</button>
            </div>
            <div id="todoList" class="todo-list">
              <div style="text-align:center; padding:20px"><div class="spinner-border"></div></div>
            </div>
          </div>
        </div>
      </div>

      <div class="tasks-modal-overlay" id="createTaskModal" role="dialog" aria-modal="true"
           onclick="if(event.target===this) AsgardTasksPage.closeCreateModal()">
        <div class="modal" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h3>Создать задачу</h3>
            <button class="btn ghost" type="button" onclick="AsgardTasksPage.closeCreateModal()" aria-label="Закрыть">&times;</button>
          </div>
          <div class="modal-body">
            <form id="createTaskForm">
              <div class="field" style="margin-bottom:12px">
                <label>Исполнитель *</label>
                <div id="crselect-taskAssignee"></div>
              </div>
              <div class="field" style="margin-bottom:12px">
                <label>Название *</label>
                <input type="text" id="taskTitle" class="inp" required/>
              </div>
              <div class="field" style="margin-bottom:12px">
                <label>Описание</label>
                <textarea id="taskDescription" class="inp" rows="3"></textarea>
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px">
                <div class="field">
                  <label>Дедлайн</label>
                  <input type="datetime-local" id="taskDeadline" class="inp"/>
                </div>
                <div class="field">
                  <label>Приоритет</label>
                  <div id="crselect-taskPriority"></div>
                </div>
              </div>
              <div class="field" style="margin-bottom:12px">
                <label>Комментарий</label>
                <textarea id="taskComment" class="inp" rows="2" placeholder="Дополнительные инструкции..."></textarea>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button class="btn ghost" type="button" onclick="AsgardTasksPage.closeCreateModal()">Отмена</button>
            <button class="btn" type="button" onclick="AsgardTasksPage.submitCreateTask()">Создать</button>
          </div>
        </div>
      </div>

      <div class="tasks-modal-overlay" id="completeTaskModal" role="dialog" aria-modal="true"
           onclick="if(event.target===this) AsgardTasksPage.closeCompleteModal()">
        <div class="modal" style="max-width:400px" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h3>Завершить задачу</h3>
            <button class="btn ghost" type="button" onclick="AsgardTasksPage.closeCompleteModal()" aria-label="Закрыть">&times;</button>
          </div>
          <div class="modal-body">
            <div class="field">
              <label>Комментарий о выполнении</label>
              <textarea id="completeComment" class="inp" rows="3" placeholder="Что было сделано..."></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn ghost" type="button" onclick="AsgardTasksPage.closeCompleteModal()">Отмена</button>
            <button class="btn" type="button" onclick="AsgardTasksPage.submitComplete()">Завершить</button>
          </div>
        </div>
      </div>
    `;

    // CRSelect init — task filter
    document.getElementById('crselect-taskFilter')?.appendChild(CRSelect.create({
      id: 'taskFilter', options: [
        { value: '', label: 'Все задачи' },
        { value: 'new', label: 'Новые' },
        { value: 'accepted', label: 'Принятые' },
        { value: 'in_progress', label: 'В работе' },
        { value: 'done', label: 'Выполненные' },
        { value: 'overdue', label: 'Просроченные' },
      ],
      placeholder: 'Все задачи',
      onChange: (v) => filterTasks(v),
    }));
    // CRSelect init — assignee (populated later by populateAssigneeSelect)
    document.getElementById('crselect-taskAssignee')?.appendChild(CRSelect.create({
      id: 'taskAssignee', options: [{ value: '', label: 'Выберите...' }],
      placeholder: 'Выберите исполнителя', required: true, fullWidth: true,
    }));
    // CRSelect init — priority
    document.getElementById('crselect-taskPriority')?.appendChild(CRSelect.create({
      id: 'taskPriority', value: 'normal', fullWidth: true,
      options: [
        { value: 'low', label: 'Низкий' },
        { value: 'normal', label: 'Обычный' },
        { value: 'high', label: 'Высокий' },
        { value: 'urgent', label: 'Срочный' },
      ],
    }));

    await Promise.all([loadTasks(), loadTodo(), loadUsers()]);

    if (highlightTaskId) {
      setTimeout(() => {
        const el = document.querySelector('.task-card[data-task-id="' + highlightTaskId + '"]');
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // TASKS
  // ─────────────────────────────────────────────────────────────────
  async function loadTasks() {
    try {
      let url = '/api/tasks/my';
      if (currentFilter) url += '?status=' + currentFilter;

      const resp = await fetch(url, { headers: getHeaders() });
      if (!resp.ok) throw new Error('Ошибка загрузки');
      const data = await resp.json();
      currentTasks = data.tasks || [];
      renderTasksList();

      // Также загружаем созданные задачи для директоров
      if (isDirector) {
        const createdResp = await fetch('/api/tasks/created', { headers: getHeaders() });
        if (createdResp.ok) {
          const createdData = await createdResp.json();
          renderCreatedTasksList(createdData.tasks || []);
        }
      }
    } catch (e) {
      console.error('loadTasks error:', e);
      // D-205: и здесь контейнера может уже не быть — без защиты это второй TypeError
      // из catch (страница «мертва» без внятного сообщения).
      const host = document.getElementById('tasksList');
      if (host) host.innerHTML = '<div style="color:var(--red); padding:10px">Ошибка загрузки задач</div>';
    }
  }

  function renderTasksList() {
    const container = document.getElementById('tasksList');
    // D-205: страница могла уже уйти из DOM (уход по роутеру/перерисовка SPA), пока шёл
    // запрос — getElementById вернёт null и запись в innerHTML падала TypeError'ом.
    // Выходим тихо: рендерить в никуда нечего, страница не на экране.
    if (!container) return;
    if (!currentTasks.length) {
      container.innerHTML = `
        <div class="tasks-empty">
          <strong>Пока пусто</strong>
          Здесь появятся поручения от руководства и задачи из звонков
        </div>`;
      return;
    }

    container.innerHTML = currentTasks.map(t => renderTaskCard(t)).join('');
  }

  function renderTaskCard(t) {
    const statusLabel = STATUS_LABELS[t.status] || t.status;
    const deadlineOverdue = t.status !== 'done' && isOverdue(t.deadline);
    const isExpanded = expandedTaskId === t.id;
    const pClass = 'priority-' + (PRIORITY_LABELS[t.priority] ? t.priority : 'normal');
    const hiClass = (highlightTaskId === t.id) ? ' is-highlight' : '';

    let actionsHtml = '';
    if (t.status === 'new') {
      actionsHtml = `
        <button class="btn mini" type="button" onclick="AsgardTasksPage.acceptTask(${t.id})">Принять</button>
        <button class="btn mini ghost" type="button" onclick="AsgardTasksPage.startTask(${t.id})">Начать</button>
      `;
    } else if (t.status === 'accepted') {
      actionsHtml = `<button class="btn mini" type="button" onclick="AsgardTasksPage.startTask(${t.id})">Начать работу</button>`;
    } else if (t.status === 'in_progress' || t.status === 'overdue') {
      actionsHtml = `<button class="btn mini" type="button" onclick="AsgardTasksPage.showCompleteModal(${t.id})">Завершить</button>`;
    } else if (t.status === 'done') {
      actionsHtml = `<div style="color:var(--ok-t, var(--green))">Выполнено ${formatDateTime(t.completed_at)}</div>`;
      if (t.assignee_comment) {
        actionsHtml += `<div style="margin-top:6px; font-style:italic; color:var(--dim)">"${escapeHtml(t.assignee_comment)}"</div>`;
      }
    }

    const filesHtml = (Array.isArray(t.files) && t.files.length > 0) ?
      `<div style="margin-top:8px"><strong>Файлы:</strong> ${t.files.map(f =>
        `<a href="/api/tasks/${t.id}/file/${encodeURIComponent(f.filename)}" target="_blank" style="margin-left:6px">${escapeHtml(f.original_name)}</a>`
      ).join('')}</div>` : '';

    return `
      <div class="task-card ${pClass}${hiClass}" data-task-id="${t.id}"
           onclick="AsgardTasksPage.toggleTask(${t.id})">
        <div class="task-card-top">
          <div style="flex:1">
            <div class="task-card-title">${escapeHtml(t.title)}</div>
            <div class="task-card-meta">
              От: ${escapeHtml(t.creator_name || '?')}
              ${t.deadline ? ` · Срок: <span style="color:${deadlineOverdue ? 'var(--err-t)' : 'inherit'}">${formatDate(t.deadline)}${deadlineOverdue ? ' !' : ''}</span>` : ''}
            </div>
            ${sourceBadgesHtml(t)}
          </div>
          <div>
            <span class="status-badge ${getStatusClass(t.status)}">${statusLabel}</span>
          </div>
        </div>
        ${isExpanded ? `
          <div class="task-card-body" onclick="event.stopPropagation()">
            ${t.description ? `<div style="margin-bottom:10px; white-space:pre-wrap">${escapeHtml(t.description)}</div>` : ''}
            ${t.creator_comment ? `<div style="margin-bottom:10px; font-style:italic; color:var(--dim)">${escapeHtml(t.creator_comment)}</div>` : ''}
            ${filesHtml}
            <div class="task-card-actions">
              ${actionsHtml}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderCreatedTasksList(tasks) {
    const container = document.getElementById('createdTasksList');
    if (!container) return;

    if (!tasks.length) {
      container.innerHTML = '<div style="color:var(--dim); padding:10px; text-align:center">Нет созданных задач</div>';
      return;
    }

    container.innerHTML = `
      <div style="max-height:300px; overflow-y:auto">
        ${tasks.map(t => {
          const statusColor = STATUS_COLORS[t.status] || 'var(--t2)';
          const statusLabel = STATUS_LABELS[t.status] || t.status;
          return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border)">
              <div>
                <div style="font-weight:500">${escapeHtml(t.title)}</div>
                <div style="font-size:0.85em; color:var(--dim)">${escapeHtml(t.assignee_name)}</div>
              </div>
              <span class="status-badge ${getStatusClass(t.status)}">${statusLabel}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function toggleTask(id) {
    expandedTaskId = (expandedTaskId === id) ? null : id;
    renderTasksList();
  }

  function filterTasks(status) {
    currentFilter = status;
    loadTasks();
  }

  async function acceptTask(id) {
    try {
      const resp = await fetch(`/api/tasks/${id}/accept`, { method: 'PUT', headers: getHeaders() });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Ошибка');
      }
      AsgardUI.toast('Задача принята', 'success');
      await loadTasks();
    } catch (e) {
      AsgardUI.toast('Ошибка', e.message, 'err');
    }
  }

  async function startTask(id) {
    try {
      const resp = await fetch(`/api/tasks/${id}/start`, { method: 'PUT', headers: getHeaders() });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Ошибка');
      }
      AsgardUI.toast('Работа начата', 'success');
      await loadTasks();
    } catch (e) {
      AsgardUI.toast('Ошибка', e.message, 'err');
    }
  }

  let completeTaskId = null;

  function showCompleteModal(id) {
    completeTaskId = id;
    const c = document.getElementById('completeComment');
    if (c) c.value = '';
    openModal(document.getElementById('completeTaskModal'));
  }

  function closeCompleteModal() {
    completeTaskId = null;
    closeModalEl(document.getElementById('completeTaskModal'));
  }

  async function submitComplete() {
    if (!completeTaskId) return;
    const comment = document.getElementById('completeComment').value.trim();

    try {
      const resp = await fetch(`/api/tasks/${completeTaskId}/complete`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ comment })
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Ошибка');
      }
      closeCompleteModal();
      AsgardUI.toast('Задача выполнена!', 'success');
      await loadTasks();
    } catch (e) {
      AsgardUI.toast('Ошибка', e.message, 'err');
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // CREATE TASK (для директоров)
  // ─────────────────────────────────────────────────────────────────
  async function loadUsers() {
    try {
      const resp = await fetch('/api/users?active=true', { headers: getHeaders() });
      if (resp.ok) {
        const data = await resp.json();
        users = data.users || data || [];
        populateAssigneeSelect();
      }
    } catch (e) {
      console.warn('loadUsers error:', e);
    }
  }

  function populateAssigneeSelect() {
    const opts = [{ value: '', label: 'Выберите исполнителя...' }];
    users.forEach(u => opts.push({ value: String(u.id), label: escapeHtml(u.name) + ' (' + u.role + ')' }));
    CRSelect.setOptions('taskAssignee', opts);
  }

  function showCreateModal() {
    document.getElementById('createTaskForm')?.reset();
    CRSelect.setValue('taskAssignee', '');
    CRSelect.setValue('taskPriority', 'normal');
    openModal(document.getElementById('createTaskModal'));
  }

  function closeCreateModal() {
    closeModalEl(document.getElementById('createTaskModal'));
  }

  async function submitCreateTask() {
    const assignee_id = CRSelect.getValue('taskAssignee');
    const title = document.getElementById('taskTitle').value.trim();
    const description = document.getElementById('taskDescription').value.trim();
    const deadline = document.getElementById('taskDeadline').value;
    const priority = CRSelect.getValue('taskPriority');
    const creator_comment = document.getElementById('taskComment').value.trim();

    if (!assignee_id) {
      AsgardUI.toast('Выберите исполнителя', 'warning');
      return;
    }
    if (!title) {
      AsgardUI.toast('Укажите название', 'warning');
      return;
    }

    try {
      const resp = await fetch('/api/tasks', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          assignee_id: parseInt(assignee_id),
          title,
          description: description || null,
          deadline: deadline || null,
          priority,
          creator_comment: creator_comment || null
        })
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Ошибка создания');
      }

      closeCreateModal();
      AsgardUI.toast('Задача создана', 'success');
      await loadTasks();
    } catch (e) {
      AsgardUI.toast('Ошибка', e.message, 'err');
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // TODO LIST
  // ─────────────────────────────────────────────────────────────────
  async function loadTodo() {
    try {
      const resp = await fetch('/api/tasks/todo', { headers: getHeaders() });
      if (!resp.ok) throw new Error('Ошибка');
      const data = await resp.json();
      currentTodo = data.items || [];
      renderTodoList();
    } catch (e) {
      console.error('loadTodo error:', e);
      // D-205: без защиты это бросало второй TypeError поверх исходного.
      const host = document.getElementById('todoList');
      if (host) host.innerHTML = '<div style="color:var(--red)">Ошибка загрузки</div>';
    }
  }

  function renderTodoList() {
    const container = document.getElementById('todoList');
    const counter = document.getElementById('todoCounter');
    // D-205: см. комментарий в renderTasksList — страница могла уже уйти из DOM.
    if (!container) return;
    const doneCount = currentTodo.filter(i => i.done).length;

    if (counter) {
      counter.textContent = `${doneCount}/${currentTodo.length}`;
    }

    if (!currentTodo.length) {
      container.innerHTML = '<div style="color:var(--dim); text-align:center; padding:20px">Список пуст</div>';
      return;
    }

    // Вычисление оставшегося времени до автоудаления
    function getRemainingTime(item) {
      if (!item.done || !item.done_at) return null;
      const doneAt = new Date(item.done_at);
      const deleteHours = item.auto_delete_hours || 48;
      const deleteAt = new Date(doneAt.getTime() + deleteHours * 60 * 60 * 1000);
      const now = new Date();
      const remainingMs = deleteAt.getTime() - now.getTime();
      if (remainingMs <= 0) return null;
      const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000));
      const remainingMins = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
      if (remainingHours > 0) {
        return `${remainingHours} ч`;
      }
      return `${remainingMins} мин`;
    }

    container.innerHTML = currentTodo.map(item => {
      const remaining = getRemainingTime(item);
      const timerHtml = remaining ? `<span style="font-size:0.75em; color:var(--amber); margin-left:8px" title="До автоудаления">${remaining}</span>` : '';
      return `
        <div class="todo-item${item.done ? ' is-done' : ''}">
          <input type="checkbox" ${item.done ? 'checked' : ''} onchange="AsgardTasksPage.toggleTodo(${item.id})" style="cursor:pointer"/>
          <span ondblclick="AsgardTasksPage.editTodo(${item.id})" style="flex:1; cursor:pointer; ${item.done ? 'text-decoration:line-through; color:var(--dim)' : ''}">${escapeHtml(item.text)}${timerHtml}</span>
          <button class="btn ghost mini" type="button" onclick="AsgardTasksPage.deleteTodo(${item.id})" style="padding:2px 6px; opacity:0.5" title="Удалить">×</button>
        </div>
      `;
    }).join('');
  }

  async function addTodo() {
    const input = document.getElementById('todoInput');
    const text = input.value.trim();
    if (!text) return;

    try {
      const resp = await fetch('/api/tasks/todo', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ text })
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Ошибка');
      }
      input.value = '';
      await loadTodo();
    } catch (e) {
      AsgardUI.toast('Ошибка', e.message, 'err');
    }
  }

  async function toggleTodo(id) {
    try {
      const resp = await fetch(`/api/tasks/todo/${id}/toggle`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({})
      });
      if (!resp.ok) throw new Error('Ошибка');
      await loadTodo();
    } catch (e) {
      AsgardUI.toast('Ошибка', e.message, 'err');
    }
  }

  async function deleteTodo(id) {
    if (!confirm('Удалить пункт?')) return;
    try {
      const resp = await fetch(`/api/tasks/todo/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      if (!resp.ok) throw new Error('Ошибка');
      await loadTodo();
    } catch (e) {
      AsgardUI.toast('Ошибка', e.message, 'err');
    }
  }

  function editTodo(id) {
    const item = currentTodo.find(i => i.id === id);
    if (!item) return;

    const newText = prompt('Редактировать:', item.text);
    if (newText === null || newText.trim() === '') return;

    fetch(`/api/tasks/todo/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ text: newText.trim() })
    }).then(resp => {
      if (resp.ok) loadTodo();
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────
  return {
    render,
    toggleTask,
    filterTasks,
    acceptTask,
    startTask,
    // D-205: экспортируем рендеры для детерминированного гейта tools/verify_tasks_render.js
    // (проверка, что при отсутствующем контейнере функция выходит тихо, а не бросает TypeError).
    renderTasksList,
    renderTodoList,
    renderCreatedTasksList,
    showCompleteModal,
    closeCompleteModal,
    submitComplete,
    showCreateModal,
    closeCreateModal,
    submitCreateTask,
    addTodo,
    toggleTodo,
    deleteTodo,
    editTodo
  };
})();
