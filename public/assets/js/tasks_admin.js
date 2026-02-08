/**
 * ═══════════════════════════════════════════════════════════════
 * M3: TASKS ADMIN — Управление задачами (для директоров)
 * ═══════════════════════════════════════════════════════════════
 */

window.AsgardTasksAdminPage = (function() {
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
    urgent: 'Срочно',
    high: 'Высокий',
    normal: 'Обычный',
    low: 'Низкий'
  };

  const PRIORITY_COLORS = {
    urgent: '#ef4444',
    high: '#f97316',
    normal: '#3b82f6',
    low: '#6b7280'
  };

  let allTasks = [];
  let users = [];
  let currentFilters = {
    status: '',
    assignee: '',
    creator: ''
  };

  /**
   * Рендер страницы
   */
  async function render(container) {
    container.innerHTML = `
      <div class="tasks-admin-page">
        <div class="page-header">
          <h1>Управление задачами</h1>
          <button class="btn btn-primary" onclick="AsgardTasksAdminPage.showCreateModal()">
            + Создать задачу
          </button>
        </div>

        <!-- KPI Cards -->
        <div class="kpi-row" id="tasksKpiRow">
          <div class="kpi-card loading">Загрузка...</div>
        </div>

        <!-- Filters -->
        <div class="filters-panel" id="tasksFiltersPanel">
          <div class="filter-group">
            <label>Статус:</label>
            <select id="filterStatus" onchange="AsgardTasksAdminPage.applyFilters()">
              <option value="">Все</option>
              <option value="new">Новые</option>
              <option value="accepted">Принятые</option>
              <option value="in_progress">В работе</option>
              <option value="done">Выполненные</option>
              <option value="overdue">Просроченные</option>
            </select>
          </div>
          <div class="filter-group">
            <label>Исполнитель:</label>
            <select id="filterAssignee" onchange="AsgardTasksAdminPage.applyFilters()">
              <option value="">Все</option>
            </select>
          </div>
          <div class="filter-group">
            <label>Создатель:</label>
            <select id="filterCreator" onchange="AsgardTasksAdminPage.applyFilters()">
              <option value="">Все</option>
            </select>
          </div>
          <button class="btn btn-secondary" onclick="AsgardTasksAdminPage.resetFilters()">
            Сбросить
          </button>
        </div>

        <!-- Tasks Table -->
        <div class="tasks-table-container" id="tasksTableContainer">
          <table class="tasks-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Задача</th>
                <th>Исполнитель</th>
                <th>Приоритет</th>
                <th>Дедлайн</th>
                <th>Статус</th>
                <th>Создатель</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody id="tasksTableBody">
              <tr><td colspan="8" class="loading">Загрузка задач...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Create/Edit Task Modal -->
      <div class="modal-overlay" id="taskModal" style="display:none;">
        <div class="modal-content modal-lg">
          <div class="modal-header">
            <h3 id="taskModalTitle">Создать задачу</h3>
            <button class="modal-close" onclick="AsgardTasksAdminPage.closeModal()">&times;</button>
          </div>
          <div class="modal-body">
            <form id="taskForm" onsubmit="return AsgardTasksAdminPage.submitTask(event)">
              <input type="hidden" id="taskId" value="">

              <div class="form-group">
                <label for="taskAssignee">Исполнитель *</label>
                <select id="taskAssignee" required>
                  <option value="">Выберите сотрудника</option>
                </select>
              </div>

              <div class="form-group">
                <label for="taskTitle">Заголовок *</label>
                <input type="text" id="taskTitle" required maxlength="255"
                       placeholder="Краткое описание задачи">
              </div>

              <div class="form-group">
                <label for="taskDescription">Описание</label>
                <textarea id="taskDescription" rows="4"
                          placeholder="Подробное описание задачи"></textarea>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label for="taskDeadline">Дедлайн</label>
                  <input type="datetime-local" id="taskDeadline">
                </div>
                <div class="form-group">
                  <label for="taskPriority">Приоритет</label>
                  <select id="taskPriority">
                    <option value="low">Низкий</option>
                    <option value="normal" selected>Обычный</option>
                    <option value="high">Высокий</option>
                    <option value="urgent">Срочно</option>
                  </select>
                </div>
              </div>

              <div class="form-group">
                <label for="taskComment">Комментарий (инструкции)</label>
                <textarea id="taskComment" rows="2"
                          placeholder="Дополнительные инструкции для исполнителя"></textarea>
              </div>

              <div class="form-group">
                <label for="taskFiles">Прикрепить файлы</label>
                <input type="file" id="taskFiles" multiple>
                <div id="existingFiles" class="existing-files"></div>
              </div>

              <div class="form-actions">
                <button type="button" class="btn btn-secondary"
                        onclick="AsgardTasksAdminPage.closeModal()">Отмена</button>
                <button type="submit" class="btn btn-primary" id="taskSubmitBtn">
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- View Task Modal -->
      <div class="modal-overlay" id="viewTaskModal" style="display:none;">
        <div class="modal-content modal-lg">
          <div class="modal-header">
            <h3 id="viewTaskTitle">Задача</h3>
            <button class="modal-close" onclick="AsgardTasksAdminPage.closeViewModal()">&times;</button>
          </div>
          <div class="modal-body" id="viewTaskBody">
          </div>
        </div>
      </div>
    `;

    addStyles();
    await loadData();
  }

  /**
   * Загрузка данных
   */
  async function loadData() {
    try {
      // Загружаем параллельно: все задачи, статистику, пользователей
      const [tasksRes, statsRes, usersRes] = await Promise.all([
        fetch('/api/tasks/all', {
          headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
        }),
        fetch('/api/tasks/stats', {
          headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
        }),
        fetch('/api/users', {
          headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
        })
      ]);

      if (!tasksRes.ok || !statsRes.ok) {
        throw new Error('Ошибка загрузки данных');
      }

      allTasks = await tasksRes.json();
      const stats = await statsRes.json();

      if (usersRes.ok) {
        users = await usersRes.json();
        populateUserSelects();
      }

      renderKpiCards(stats);
      renderTasksTable();

    } catch (err) {
      console.error('Ошибка загрузки:', err);
      document.getElementById('tasksTableBody').innerHTML =
        '<tr><td colspan="8" class="error">Ошибка загрузки данных</td></tr>';
    }
  }

  /**
   * Заполнение селектов пользователей
   */
  function populateUserSelects() {
    const assigneeFilter = document.getElementById('filterAssignee');
    const creatorFilter = document.getElementById('filterCreator');
    const taskAssignee = document.getElementById('taskAssignee');

    const activeUsers = users.filter(u => u.is_active);

    activeUsers.forEach(user => {
      const displayName = user.display_name || user.username;

      if (assigneeFilter) {
        const opt1 = document.createElement('option');
        opt1.value = user.id;
        opt1.textContent = displayName;
        assigneeFilter.appendChild(opt1);
      }

      if (creatorFilter) {
        const opt2 = document.createElement('option');
        opt2.value = user.id;
        opt2.textContent = displayName;
        creatorFilter.appendChild(opt2);
      }

      if (taskAssignee) {
        const opt3 = document.createElement('option');
        opt3.value = user.id;
        opt3.textContent = `${displayName} (${user.role})`;
        taskAssignee.appendChild(opt3);
      }
    });
  }

  /**
   * Рендер KPI-карточек
   */
  function renderKpiCards(stats) {
    const container = document.getElementById('tasksKpiRow');
    if (!container) return;

    const active = (stats.accepted || 0) + (stats.in_progress || 0);

    container.innerHTML = `
      <div class="kpi-card" style="border-left: 4px solid ${STATUS_COLORS.new}">
        <div class="kpi-value">${stats.new || 0}</div>
        <div class="kpi-label">Новых</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid ${STATUS_COLORS.in_progress}">
        <div class="kpi-value">${active}</div>
        <div class="kpi-label">В работе</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid ${STATUS_COLORS.done}">
        <div class="kpi-value">${stats.done || 0}</div>
        <div class="kpi-label">Выполнено</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid ${STATUS_COLORS.overdue}">
        <div class="kpi-value">${stats.overdue || 0}</div>
        <div class="kpi-label">Просрочено</div>
      </div>
    `;
  }

  /**
   * Рендер таблицы задач
   */
  function renderTasksTable() {
    const tbody = document.getElementById('tasksTableBody');
    if (!tbody) return;

    // Применяем фильтры
    let filtered = allTasks;

    if (currentFilters.status) {
      filtered = filtered.filter(t => t.status === currentFilters.status);
    }
    if (currentFilters.assignee) {
      filtered = filtered.filter(t => t.assignee_id == currentFilters.assignee);
    }
    if (currentFilters.creator) {
      filtered = filtered.filter(t => t.creator_id == currentFilters.creator);
    }

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="no-data">Нет задач</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(task => {
      const deadlineStr = task.deadline
        ? formatDateTime(task.deadline)
        : '—';

      const isOverdue = task.deadline &&
        new Date(task.deadline) < new Date() &&
        task.status !== 'done';

      return `
        <tr class="${isOverdue ? 'overdue-row' : ''}">
          <td>${task.id}</td>
          <td>
            <a href="#" onclick="AsgardTasksAdminPage.viewTask(${task.id}); return false;">
              ${escapeHtml(task.title)}
            </a>
          </td>
          <td>${escapeHtml(task.assignee_name || '—')}</td>
          <td>
            <span class="priority-badge" style="background: ${PRIORITY_COLORS[task.priority]}">
              ${PRIORITY_LABELS[task.priority] || task.priority}
            </span>
          </td>
          <td class="${isOverdue ? 'overdue-text' : ''}">${deadlineStr}</td>
          <td>
            <span class="status-badge" style="background: ${STATUS_COLORS[task.status]}">
              ${STATUS_LABELS[task.status] || task.status}
            </span>
          </td>
          <td>${escapeHtml(task.creator_name || '—')}</td>
          <td class="actions-cell">
            <button class="btn-icon" title="Редактировать"
                    onclick="AsgardTasksAdminPage.editTask(${task.id})">
              ✏️
            </button>
            ${task.status !== 'done' ? `
              <button class="btn-icon" title="Удалить"
                      onclick="AsgardTasksAdminPage.deleteTask(${task.id})">
                🗑️
              </button>
            ` : ''}
          </td>
        </tr>
      `;
    }).join('');
  }

  /**
   * Применение фильтров
   */
  function applyFilters() {
    currentFilters.status = document.getElementById('filterStatus')?.value || '';
    currentFilters.assignee = document.getElementById('filterAssignee')?.value || '';
    currentFilters.creator = document.getElementById('filterCreator')?.value || '';
    renderTasksTable();
  }

  /**
   * Сброс фильтров
   */
  function resetFilters() {
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterAssignee').value = '';
    document.getElementById('filterCreator').value = '';
    currentFilters = { status: '', assignee: '', creator: '' };
    renderTasksTable();
  }

  /**
   * Показать модальное окно создания
   */
  function showCreateModal() {
    document.getElementById('taskModalTitle').textContent = 'Создать задачу';
    document.getElementById('taskSubmitBtn').textContent = 'Создать';
    document.getElementById('taskId').value = '';
    document.getElementById('taskForm').reset();
    document.getElementById('existingFiles').innerHTML = '';
    document.getElementById('taskModal').style.display = 'flex';
  }

  /**
   * Редактирование задачи
   */
  async function editTask(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    document.getElementById('taskModalTitle').textContent = 'Редактировать задачу';
    document.getElementById('taskSubmitBtn').textContent = 'Сохранить';
    document.getElementById('taskId').value = taskId;

    document.getElementById('taskAssignee').value = task.assignee_id;
    document.getElementById('taskTitle').value = task.title || '';
    document.getElementById('taskDescription').value = task.description || '';
    document.getElementById('taskPriority').value = task.priority || 'normal';
    document.getElementById('taskComment').value = task.creator_comment || '';

    if (task.deadline) {
      const dt = new Date(task.deadline);
      const localStr = dt.toISOString().slice(0, 16);
      document.getElementById('taskDeadline').value = localStr;
    } else {
      document.getElementById('taskDeadline').value = '';
    }

    // Показать существующие файлы
    const filesDiv = document.getElementById('existingFiles');
    if (task.files && task.files.length > 0) {
      filesDiv.innerHTML = '<p>Прикрепленные файлы:</p>' + task.files.map(f =>
        `<span class="file-tag">${escapeHtml(f.original_name || f.filename)}</span>`
      ).join(' ');
    } else {
      filesDiv.innerHTML = '';
    }

    document.getElementById('taskModal').style.display = 'flex';
  }

  /**
   * Закрытие модального окна
   */
  function closeModal() {
    document.getElementById('taskModal').style.display = 'none';
  }

  /**
   * Отправка формы создания/редактирования
   */
  async function submitTask(event) {
    event.preventDefault();

    const taskId = document.getElementById('taskId').value;
    const isEdit = !!taskId;

    const data = {
      assignee_id: parseInt(document.getElementById('taskAssignee').value),
      title: document.getElementById('taskTitle').value.trim(),
      description: document.getElementById('taskDescription').value.trim(),
      priority: document.getElementById('taskPriority').value,
      creator_comment: document.getElementById('taskComment').value.trim()
    };

    const deadline = document.getElementById('taskDeadline').value;
    if (deadline) {
      data.deadline = new Date(deadline).toISOString();
    }

    try {
      const url = isEdit ? `/api/tasks/${taskId}` : '/api/tasks';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('token')
        },
        body: JSON.stringify(data)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Ошибка сохранения');
      }

      const savedTask = await res.json();

      // Загрузка файлов (если есть)
      const filesInput = document.getElementById('taskFiles');
      if (filesInput.files.length > 0) {
        await uploadFiles(savedTask.id || taskId, filesInput.files);
      }

      closeModal();
      await loadData();

      if (window.AsgardApp && window.AsgardApp.showNotification) {
        window.AsgardApp.showNotification(
          isEdit ? 'Задача обновлена' : 'Задача создана',
          'success'
        );
      }

    } catch (err) {
      console.error('Ошибка сохранения:', err);
      alert('Ошибка: ' + err.message);
    }
  }

  /**
   * Загрузка файлов
   */
  async function uploadFiles(taskId, files) {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    try {
      await fetch(`/api/tasks/${taskId}/files`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('token')
        },
        body: formData
      });
    } catch (err) {
      console.error('Ошибка загрузки файлов:', err);
    }
  }

  /**
   * Просмотр задачи
   */
  async function viewTask(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    const modal = document.getElementById('viewTaskModal');
    const title = document.getElementById('viewTaskTitle');
    const body = document.getElementById('viewTaskBody');

    title.textContent = `Задача #${task.id}`;

    const isOverdue = task.deadline &&
      new Date(task.deadline) < new Date() &&
      task.status !== 'done';

    body.innerHTML = `
      <div class="task-detail">
        <div class="task-detail-header">
          <h2>${escapeHtml(task.title)}</h2>
          <span class="status-badge" style="background: ${STATUS_COLORS[task.status]}">
            ${STATUS_LABELS[task.status]}
          </span>
        </div>

        <div class="task-meta">
          <div class="meta-item">
            <span class="meta-label">Исполнитель:</span>
            <span class="meta-value">${escapeHtml(task.assignee_name || '—')}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Создатель:</span>
            <span class="meta-value">${escapeHtml(task.creator_name || '—')}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Приоритет:</span>
            <span class="priority-badge" style="background: ${PRIORITY_COLORS[task.priority]}">
              ${PRIORITY_LABELS[task.priority]}
            </span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Дедлайн:</span>
            <span class="meta-value ${isOverdue ? 'overdue-text' : ''}">
              ${task.deadline ? formatDateTime(task.deadline) : '—'}
            </span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Создана:</span>
            <span class="meta-value">${formatDateTime(task.created_at)}</span>
          </div>
          ${task.accepted_at ? `
            <div class="meta-item">
              <span class="meta-label">Принята:</span>
              <span class="meta-value">${formatDateTime(task.accepted_at)}</span>
            </div>
          ` : ''}
          ${task.completed_at ? `
            <div class="meta-item">
              <span class="meta-label">Завершена:</span>
              <span class="meta-value">${formatDateTime(task.completed_at)}</span>
            </div>
          ` : ''}
        </div>

        ${task.description ? `
          <div class="task-section">
            <h4>Описание</h4>
            <p>${escapeHtml(task.description)}</p>
          </div>
        ` : ''}

        ${task.creator_comment ? `
          <div class="task-section">
            <h4>Инструкции от руководителя</h4>
            <p>${escapeHtml(task.creator_comment)}</p>
          </div>
        ` : ''}

        ${task.assignee_comment ? `
          <div class="task-section">
            <h4>Комментарий исполнителя</h4>
            <p>${escapeHtml(task.assignee_comment)}</p>
          </div>
        ` : ''}

        ${task.files && task.files.length > 0 ? `
          <div class="task-section">
            <h4>Файлы</h4>
            <div class="task-files">
              ${task.files.map(f => `
                <a href="/api/tasks/${task.id}/file/${f.filename}"
                   target="_blank" class="file-link">
                  ${escapeHtml(f.original_name || f.filename)}
                </a>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    modal.style.display = 'flex';
  }

  /**
   * Закрытие окна просмотра
   */
  function closeViewModal() {
    document.getElementById('viewTaskModal').style.display = 'none';
  }

  /**
   * Удаление задачи
   */
  async function deleteTask(taskId) {
    if (!confirm('Удалить задачу? Это действие нельзя отменить.')) {
      return;
    }

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('token')
        }
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Ошибка удаления');
      }

      await loadData();

      if (window.AsgardApp && window.AsgardApp.showNotification) {
        window.AsgardApp.showNotification('Задача удалена', 'success');
      }

    } catch (err) {
      console.error('Ошибка удаления:', err);
      alert('Ошибка: ' + err.message);
    }
  }

  /**
   * Вспомогательные функции
   */
  function formatDateTime(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Стили страницы
   */
  function addStyles() {
    if (document.getElementById('tasks-admin-styles')) return;

    const style = document.createElement('style');
    style.id = 'tasks-admin-styles';
    style.textContent = `
      .tasks-admin-page {
        padding: 20px;
        max-width: 1400px;
        margin: 0 auto;
      }

      .page-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
      }

      .page-header h1 {
        margin: 0;
        font-size: 24px;
      }

      /* KPI Row */
      .kpi-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 16px;
        margin-bottom: 20px;
      }

      .kpi-card {
        background: var(--card-bg, #fff);
        border-radius: 8px;
        padding: 16px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      .kpi-value {
        font-size: 32px;
        font-weight: bold;
        color: var(--text-primary, #333);
      }

      .kpi-label {
        font-size: 14px;
        color: var(--text-secondary, #666);
        margin-top: 4px;
      }

      /* Filters */
      .filters-panel {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        align-items: flex-end;
        margin-bottom: 20px;
        padding: 16px;
        background: var(--card-bg, #fff);
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      .filter-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .filter-group label {
        font-size: 12px;
        color: var(--text-secondary, #666);
      }

      .filter-group select {
        padding: 8px 12px;
        border: 1px solid var(--border-color, #ddd);
        border-radius: 4px;
        min-width: 150px;
      }

      /* Table */
      .tasks-table-container {
        background: var(--card-bg, #fff);
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        overflow-x: auto;
      }

      .tasks-table {
        width: 100%;
        border-collapse: collapse;
      }

      .tasks-table th,
      .tasks-table td {
        padding: 12px;
        text-align: left;
        border-bottom: 1px solid var(--border-color, #eee);
      }

      .tasks-table th {
        background: var(--bg-secondary, #f5f5f5);
        font-weight: 600;
        font-size: 13px;
        color: var(--text-secondary, #666);
      }

      .tasks-table tbody tr:hover {
        background: var(--bg-hover, #f9f9f9);
      }

      .tasks-table a {
        color: var(--link-color, #3b82f6);
        text-decoration: none;
      }

      .tasks-table a:hover {
        text-decoration: underline;
      }

      .status-badge,
      .priority-badge {
        display: inline-block;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        color: #fff;
        font-weight: 500;
      }

      .overdue-row {
        background: rgba(239, 68, 68, 0.1) !important;
      }

      .overdue-text {
        color: #ef4444 !important;
        font-weight: 600;
      }

      .actions-cell {
        white-space: nowrap;
      }

      .btn-icon {
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px 8px;
        font-size: 16px;
        opacity: 0.7;
        transition: opacity 0.2s;
      }

      .btn-icon:hover {
        opacity: 1;
      }

      .no-data,
      .loading,
      .error {
        text-align: center;
        padding: 40px !important;
        color: var(--text-secondary, #666);
      }

      .error {
        color: #ef4444;
      }

      /* Modal */
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .modal-content {
        background: var(--card-bg, #fff);
        border-radius: 12px;
        width: 90%;
        max-width: 500px;
        max-height: 90vh;
        overflow-y: auto;
      }

      .modal-lg {
        max-width: 700px;
      }

      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-color, #eee);
      }

      .modal-header h3 {
        margin: 0;
      }

      .modal-close {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: var(--text-secondary, #666);
      }

      .modal-body {
        padding: 20px;
      }

      /* Form */
      .form-group {
        margin-bottom: 16px;
      }

      .form-group label {
        display: block;
        margin-bottom: 4px;
        font-weight: 500;
        font-size: 14px;
      }

      .form-group input,
      .form-group select,
      .form-group textarea {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--border-color, #ddd);
        border-radius: 6px;
        font-size: 14px;
        box-sizing: border-box;
      }

      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }

      .form-actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 20px;
      }

      .existing-files {
        margin-top: 8px;
      }

      .file-tag {
        display: inline-block;
        background: var(--bg-secondary, #f0f0f0);
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        margin-right: 4px;
      }

      /* Task Detail */
      .task-detail-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 20px;
      }

      .task-detail-header h2 {
        margin: 0;
        font-size: 20px;
      }

      .task-meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
        margin-bottom: 20px;
        padding: 16px;
        background: var(--bg-secondary, #f5f5f5);
        border-radius: 8px;
      }

      .meta-item {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .meta-label {
        font-size: 12px;
        color: var(--text-secondary, #666);
      }

      .meta-value {
        font-weight: 500;
      }

      .task-section {
        margin-bottom: 16px;
      }

      .task-section h4 {
        margin: 0 0 8px 0;
        font-size: 14px;
        color: var(--text-secondary, #666);
      }

      .task-section p {
        margin: 0;
        white-space: pre-wrap;
      }

      .task-files {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .file-link {
        display: inline-block;
        background: var(--bg-secondary, #f0f0f0);
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 13px;
        color: var(--link-color, #3b82f6);
        text-decoration: none;
      }

      .file-link:hover {
        background: var(--bg-hover, #e5e5e5);
      }

      /* Buttons */
      .btn {
        padding: 10px 20px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
      }

      .btn-primary {
        background: #3b82f6;
        color: #fff;
      }

      .btn-primary:hover {
        background: #2563eb;
      }

      .btn-secondary {
        background: var(--bg-secondary, #e5e5e5);
        color: var(--text-primary, #333);
      }

      .btn-secondary:hover {
        background: var(--bg-hover, #d5d5d5);
      }

      @media (max-width: 768px) {
        .filters-panel {
          flex-direction: column;
          align-items: stretch;
        }

        .filter-group select {
          width: 100%;
        }

        .form-row {
          grid-template-columns: 1fr;
        }

        .tasks-table th:nth-child(7),
        .tasks-table td:nth-child(7) {
          display: none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Public API
  return {
    render,
    showCreateModal,
    editTask,
    deleteTask,
    viewTask,
    closeModal,
    closeViewModal,
    submitTask,
    applyFilters,
    resetFilters
  };
})();
