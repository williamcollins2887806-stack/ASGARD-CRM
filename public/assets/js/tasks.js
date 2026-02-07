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
    new: '#eab308',
    accepted: '#3b82f6',
    in_progress: '#f97316',
    done: '#22c55e',
    overdue: '#ef4444'
  };

  const PRIORITY_LABELS = {
    low: 'Низкий',
    normal: 'Обычный',
    high: 'Высокий',
    urgent: 'Срочный'
  };

  const PRIORITY_COLORS = {
    urgent: '#ef4444',
    high: '#f97316',
    normal: '#3b82f6',
    low: '#6b7280'
  };

  let currentTasks = [];
  let currentTodo = [];
  let users = [];
  let expandedTaskId = null;
  let currentFilter = '';
  let isDirector = false;

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
  async function render(opts) {
    const { layout, title } = opts;
    const auth = AsgardAuth.getAuth();
    const role = auth?.user?.role || '';
    isDirector = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role);

    const body = `
      <div class="tasks-page" style="display:grid; grid-template-columns:1fr 350px; gap:20px; min-height:60vh">
        <!-- Левая панель: Задачи от руководства -->
        <div>
          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:15px">
              <h3 style="margin:0">📋 Задачи от руководства</h3>
              <div style="display:flex; gap:10px; align-items:center">
                <select id="taskFilter" class="inp" style="width:auto" onchange="AsgardTasksPage.filterTasks(this.value)">
                  <option value="">Все задачи</option>
                  <option value="new">Новые</option>
                  <option value="accepted">Принятые</option>
                  <option value="in_progress">В работе</option>
                  <option value="done">Выполненные</option>
                  <option value="overdue">Просроченные</option>
                </select>
                ${isDirector ? '<button class="btn" onclick="AsgardTasksPage.showCreateModal()">📋 Создать задачу</button>' : ''}
              </div>
            </div>
            <div id="tasksList">
              <div style="text-align:center; padding:20px"><div class="spinner-border"></div></div>
            </div>
          </div>

          ${isDirector ? `
          <div class="card" style="margin-top:20px">
            <h3>📤 Мои поручения</h3>
            <div id="createdTasksList">
              <div style="text-align:center; padding:20px"><div class="spinner-border"></div></div>
            </div>
          </div>
          ` : ''}
        </div>

        <!-- Правая панель: Todo-список -->
        <div>
          <div class="card" style="position:sticky; top:20px">
            <h3 style="margin-bottom:15px">📝 Мои дела <span id="todoCounter" style="font-size:0.8em; color:var(--dim)"></span></h3>
            <div style="display:flex; gap:8px; margin-bottom:15px">
              <input type="text" id="todoInput" class="inp" placeholder="Что нужно сделать..." style="flex:1"
                onkeydown="if(event.key==='Enter') AsgardTasksPage.addTodo()"/>
              <button class="btn" onclick="AsgardTasksPage.addTodo()">+</button>
            </div>
            <div id="todoList" style="max-height:60vh; overflow-y:auto">
              <div style="text-align:center; padding:20px"><div class="spinner-border"></div></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Модалка создания задачи -->
      <div class="modal-overlay" id="createTaskModal" style="display:none">
        <div class="modal" style="max-width:500px">
          <div class="modal-header">
            <h3>Создать задачу</h3>
            <button class="btn ghost" onclick="AsgardTasksPage.closeCreateModal()">&times;</button>
          </div>
          <div class="modal-body">
            <form id="createTaskForm">
              <div class="field" style="margin-bottom:12px">
                <label>Исполнитель *</label>
                <select id="taskAssignee" class="inp" required>
                  <option value="">Выберите...</option>
                </select>
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
                  <select id="taskPriority" class="inp">
                    <option value="low">Низкий</option>
                    <option value="normal" selected>Обычный</option>
                    <option value="high">Высокий</option>
                    <option value="urgent">Срочный</option>
                  </select>
                </div>
              </div>
              <div class="field" style="margin-bottom:12px">
                <label>Комментарий</label>
                <textarea id="taskComment" class="inp" rows="2" placeholder="Дополнительные инструкции..."></textarea>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button class="btn ghost" onclick="AsgardTasksPage.closeCreateModal()">Отмена</button>
            <button class="btn" onclick="AsgardTasksPage.submitCreateTask()">Создать</button>
          </div>
        </div>
      </div>

      <!-- Модалка завершения задачи -->
      <div class="modal-overlay" id="completeTaskModal" style="display:none">
        <div class="modal" style="max-width:400px">
          <div class="modal-header">
            <h3>Завершить задачу</h3>
            <button class="btn ghost" onclick="AsgardTasksPage.closeCompleteModal()">&times;</button>
          </div>
          <div class="modal-body">
            <div class="field">
              <label>Комментарий о выполнении</label>
              <textarea id="completeComment" class="inp" rows="3" placeholder="Что было сделано..."></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn ghost" onclick="AsgardTasksPage.closeCompleteModal()">Отмена</button>
            <button class="btn" onclick="AsgardTasksPage.submitComplete()">✅ Завершить</button>
          </div>
        </div>
      </div>
    `;

    await layout(body, { title });

    // Загружаем данные
    await Promise.all([loadTasks(), loadTodo(), loadUsers()]);
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
      document.getElementById('tasksList').innerHTML = '<div style="color:var(--red); padding:10px">Ошибка загрузки задач</div>';
    }
  }

  function renderTasksList() {
    const container = document.getElementById('tasksList');
    if (!currentTasks.length) {
      container.innerHTML = '<div style="color:var(--dim); padding:20px; text-align:center">Нет задач</div>';
      return;
    }

    container.innerHTML = currentTasks.map(t => renderTaskCard(t)).join('');
  }

  function renderTaskCard(t) {
    const priorityColor = PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.normal;
    const statusColor = STATUS_COLORS[t.status] || '#6b7280';
    const statusLabel = STATUS_LABELS[t.status] || t.status;
    const deadlineOverdue = t.status !== 'done' && isOverdue(t.deadline);
    const isExpanded = expandedTaskId === t.id;

    let actionsHtml = '';
    if (t.status === 'new') {
      actionsHtml = `
        <button class="btn btn-sm" onclick="AsgardTasksPage.acceptTask(${t.id})">👍 Принять</button>
        <button class="btn btn-sm ghost" onclick="AsgardTasksPage.startTask(${t.id})">▶ Начать</button>
      `;
    } else if (t.status === 'accepted') {
      actionsHtml = `<button class="btn btn-sm" onclick="AsgardTasksPage.startTask(${t.id})">▶ Начать работу</button>`;
    } else if (t.status === 'in_progress' || t.status === 'overdue') {
      actionsHtml = `<button class="btn btn-sm" onclick="AsgardTasksPage.showCompleteModal(${t.id})">✅ Завершить</button>`;
    } else if (t.status === 'done') {
      actionsHtml = `<div style="color:var(--green)">✅ Выполнено ${formatDateTime(t.completed_at)}</div>`;
      if (t.assignee_comment) {
        actionsHtml += `<div style="margin-top:6px; font-style:italic; color:var(--dim)">"${escapeHtml(t.assignee_comment)}"</div>`;
      }
    }

    const filesHtml = (Array.isArray(t.files) && t.files.length > 0) ?
      `<div style="margin-top:8px"><strong>Файлы:</strong> ${t.files.map(f =>
        `<a href="/api/tasks/${t.id}/file/${f.filename}" target="_blank" style="margin-left:6px">${escapeHtml(f.original_name)}</a>`
      ).join('')}</div>` : '';

    return `
      <div class="task-card" style="border-left:4px solid ${priorityColor}; background:var(--card-bg); padding:12px 15px; border-radius:8px; margin-bottom:10px; cursor:pointer"
           onclick="AsgardTasksPage.toggleTask(${t.id})">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px">
          <div style="flex:1">
            <div style="font-weight:600; font-size:1em">${escapeHtml(t.title)}</div>
            <div style="font-size:0.85em; color:var(--dim); margin-top:4px">
              От: ${escapeHtml(t.creator_name || '?')}
              ${t.deadline ? ` · Срок: <span style="color:${deadlineOverdue ? 'var(--red)' : 'inherit'}">${formatDate(t.deadline)}${deadlineOverdue ? ' ⚠️' : ''}</span>` : ''}
            </div>
          </div>
          <div>
            <span style="background:${statusColor}; color:#fff; padding:2px 8px; border-radius:4px; font-size:0.8em">${statusLabel}</span>
          </div>
        </div>
        ${isExpanded ? `
          <div style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border)" onclick="event.stopPropagation()">
            ${t.description ? `<div style="margin-bottom:10px; white-space:pre-wrap">${escapeHtml(t.description)}</div>` : ''}
            ${t.creator_comment ? `<div style="margin-bottom:10px; font-style:italic; color:var(--dim)">💬 ${escapeHtml(t.creator_comment)}</div>` : ''}
            ${filesHtml}
            <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap">
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
          const statusColor = STATUS_COLORS[t.status] || '#6b7280';
          const statusLabel = STATUS_LABELS[t.status] || t.status;
          return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border)">
              <div>
                <div style="font-weight:500">${escapeHtml(t.title)}</div>
                <div style="font-size:0.85em; color:var(--dim)">${escapeHtml(t.assignee_name)}</div>
              </div>
              <span style="background:${statusColor}; color:#fff; padding:2px 8px; border-radius:4px; font-size:0.75em">${statusLabel}</span>
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
      AsgardUI.toast(e.message, 'danger');
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
      AsgardUI.toast(e.message, 'danger');
    }
  }

  let completeTaskId = null;

  function showCompleteModal(id) {
    completeTaskId = id;
    document.getElementById('completeComment').value = '';
    document.getElementById('completeTaskModal').style.display = 'flex';
  }

  function closeCompleteModal() {
    completeTaskId = null;
    document.getElementById('completeTaskModal').style.display = 'none';
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
      AsgardUI.toast(e.message, 'danger');
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
    const select = document.getElementById('taskAssignee');
    if (!select) return;
    select.innerHTML = '<option value="">Выберите исполнителя...</option>' +
      users.map(u => `<option value="${u.id}">${escapeHtml(u.name)} (${u.role})</option>`).join('');
  }

  function showCreateModal() {
    document.getElementById('createTaskForm').reset();
    document.getElementById('createTaskModal').style.display = 'flex';
  }

  function closeCreateModal() {
    document.getElementById('createTaskModal').style.display = 'none';
  }

  async function submitCreateTask() {
    const assignee_id = document.getElementById('taskAssignee').value;
    const title = document.getElementById('taskTitle').value.trim();
    const description = document.getElementById('taskDescription').value.trim();
    const deadline = document.getElementById('taskDeadline').value;
    const priority = document.getElementById('taskPriority').value;
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
      AsgardUI.toast(e.message, 'danger');
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
      document.getElementById('todoList').innerHTML = '<div style="color:var(--red)">Ошибка загрузки</div>';
    }
  }

  function renderTodoList() {
    const container = document.getElementById('todoList');
    const counter = document.getElementById('todoCounter');
    const doneCount = currentTodo.filter(i => i.done).length;

    if (counter) {
      counter.textContent = `${doneCount}/${currentTodo.length}`;
    }

    if (!currentTodo.length) {
      container.innerHTML = '<div style="color:var(--dim); text-align:center; padding:20px">Список пуст</div>';
      return;
    }

    container.innerHTML = currentTodo.map(item => `
      <div class="todo-item" style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border); ${item.done ? 'opacity:0.5' : ''}">
        <input type="checkbox" ${item.done ? 'checked' : ''} onchange="AsgardTasksPage.toggleTodo(${item.id})" style="cursor:pointer"/>
        <span ondblclick="AsgardTasksPage.editTodo(${item.id})" style="flex:1; cursor:pointer; ${item.done ? 'text-decoration:line-through; color:var(--dim)' : ''}">${escapeHtml(item.text)}</span>
        <button class="btn ghost btn-sm" onclick="AsgardTasksPage.deleteTodo(${item.id})" style="padding:2px 6px; opacity:0.5" title="Удалить">×</button>
      </div>
    `).join('');
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
      AsgardUI.toast(e.message, 'danger');
    }
  }

  async function toggleTodo(id) {
    try {
      const resp = await fetch(`/api/tasks/todo/${id}/toggle`, {
        method: 'PUT',
        headers: getHeaders()
      });
      if (!resp.ok) throw new Error('Ошибка');
      await loadTodo();
    } catch (e) {
      AsgardUI.toast(e.message, 'danger');
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
      AsgardUI.toast(e.message, 'danger');
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
