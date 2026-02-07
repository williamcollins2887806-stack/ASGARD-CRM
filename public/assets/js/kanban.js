/**
 * ASGARD CRM — Канбан-доска задач (M4)
 *
 * Функционал:
 * - Drag & Drop между колонками
 * - Фильтрация по приоритету, исполнителю
 * - Просмотр деталей задачи
 * - Комментарии и наблюдатели
 */
window.AsgardKanban = (function(){
  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;

  const COLUMNS = [
    { id: 'new', label: 'Новые', icon: '📥', color: 'var(--blue)' },
    { id: 'in_progress', label: 'В работе', icon: '🔄', color: 'var(--orange)' },
    { id: 'review', label: 'На проверке', icon: '👁️', color: 'var(--purple)' },
    { id: 'done', label: 'Готово', icon: '✅', color: 'var(--green)' }
  ];

  const PRIORITIES = {
    low: { label: 'Низкий', color: 'var(--green)', icon: '🟢' },
    normal: { label: 'Обычный', color: 'var(--blue)', icon: '🔵' },
    high: { label: 'Высокий', color: 'var(--orange)', icon: '🟠' },
    urgent: { label: 'Срочный', color: 'var(--red)', icon: '🔴' }
  };

  let currentFilters = {};
  let draggedCard = null;

  // ═══════════════════════════════════════════════════════════════
  // API
  // ═══════════════════════════════════════════════════════════════

  async function fetchKanban(filters = {}) {
    const params = new URLSearchParams(filters);
    const res = await fetch('/api/tasks/kanban?' + params, {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('jwt') }
    });
    if (!res.ok) throw new Error('Ошибка загрузки');
    return res.json();
  }

  async function moveTask(taskId, column, position = 0) {
    const res = await fetch(`/api/tasks/${taskId}/move`, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + localStorage.getItem('jwt'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ column, position })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Ошибка перемещения');
    }
    return res.json();
  }

  async function acknowledgeTask(taskId) {
    const res = await fetch(`/api/tasks/${taskId}/acknowledge`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('jwt') }
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Ошибка');
    }
    return res.json();
  }

  async function fetchComments(taskId) {
    const res = await fetch(`/api/tasks/${taskId}/comments`, {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('jwt') }
    });
    return res.json();
  }

  async function addComment(taskId, text) {
    const res = await fetch(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + localStorage.getItem('jwt'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    });
    return res.json();
  }

  async function watchTask(taskId, watch = true) {
    const res = await fetch(`/api/tasks/${taskId}/watch`, {
      method: watch ? 'POST' : 'DELETE',
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('jwt') }
    });
    return res.json();
  }

  // ═══════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════

  async function render({ layout }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user;

    let data;
    try {
      data = await fetchKanban(currentFilters);
    } catch (e) {
      await layout(`<div class="card"><p class="text-red">${esc(e.message)}</p></div>`, {
        title: 'Канбан-доска'
      });
      return;
    }

    const users = await AsgardDB.getAll('users') || [];
    const usersById = new Map(users.map(u => [u.id, u]));

    const filtersHtml = renderFilters(users, user);
    const boardHtml = renderBoard(data.columns, usersById);

    const html = `
      <div class="kanban-page">
        <div class="page-head row between mb-4">
          <div>
            <h1>📋 Канбан-доска задач</h1>
            <p class="desc">Drag & Drop для перемещения задач между колонками</p>
          </div>
          <div class="row">
            <button class="btn" onclick="AsgardKanban.refresh()">🔄 Обновить</button>
          </div>
        </div>

        ${filtersHtml}
        ${boardHtml}
      </div>
    `;

    await layout(html, { title: 'Канбан-доска', motto: 'Визуальное управление задачами' });
    initDragDrop();
  }

  function renderFilters(users, currentUser) {
    const activeUsers = users.filter(u => u.is_active);

    return `
      <div class="kanban-filters">
        <div class="form-group">
          <label>Приоритет</label>
          <select id="filter-priority" onchange="AsgardKanban.applyFilters()">
            <option value="">Все</option>
            ${Object.entries(PRIORITIES).map(([k, v]) => `
              <option value="${k}" ${currentFilters.priority === k ? 'selected' : ''}>${v.icon} ${v.label}</option>
            `).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Исполнитель</label>
          <select id="filter-assignee" onchange="AsgardKanban.applyFilters()">
            <option value="">Все</option>
            <option value="${currentUser.id}" ${currentFilters.assignee_id == currentUser.id ? 'selected' : ''}>👤 Мои задачи</option>
            ${activeUsers.map(u => `
              <option value="${u.id}" ${currentFilters.assignee_id == u.id ? 'selected' : ''}>${esc(u.name)}</option>
            `).join('')}
          </select>
        </div>
        <button class="btn" onclick="AsgardKanban.clearFilters()">✕ Сбросить</button>
      </div>
    `;
  }

  function renderBoard(columns, usersById) {
    const columnsHtml = COLUMNS.map(col => {
      const tasks = columns[col.id] || [];
      const cardsHtml = tasks.map(t => renderCard(t, usersById)).join('');

      return `
        <div class="kanban-column" data-column="${col.id}">
          <div class="kanban-column-header">
            <span class="kanban-column-title">
              <span>${col.icon}</span>
              <span>${col.label}</span>
            </span>
            <span class="kanban-column-count">${tasks.length}</span>
          </div>
          <div class="kanban-column-body" data-column="${col.id}">
            ${cardsHtml || '<div class="widget-empty"><span class="widget-empty-text">Нет задач</span></div>'}
          </div>
        </div>
      `;
    }).join('');

    return `<div class="kanban-board">${columnsHtml}</div>`;
  }

  function renderCard(task, usersById) {
    const priority = PRIORITIES[task.priority] || PRIORITIES.normal;
    const assignee = usersById.get(task.assignee_id);
    const initials = assignee?.name?.split(' ').map(n => n[0]).join('').substring(0, 2) || '??';

    const deadline = task.deadline ? new Date(task.deadline) : null;
    const isOverdue = deadline && deadline < new Date() && task.status !== 'done';
    const isSoon = deadline && !isOverdue && (deadline - new Date()) < 24 * 60 * 60 * 1000;
    const deadlineClass = isOverdue ? 'overdue' : (isSoon ? 'soon' : '');

    const tags = (task.tags && Array.isArray(task.tags) ? task.tags : []).slice(0, 3);

    return `
      <div class="kanban-card" data-id="${task.id}" draggable="true" onclick="AsgardKanban.openTask(${task.id})">
        <div class="kanban-card-priority ${task.priority}"></div>
        <div class="kanban-card-title">${esc(task.title)}</div>
        <div class="kanban-card-meta">
          <div class="kanban-card-avatar" title="${esc(assignee?.name || 'Неизвестно')}">${initials}</div>
          ${deadline ? `
            <div class="kanban-card-deadline ${deadlineClass}">
              📅 ${deadline.toLocaleDateString('ru-RU')}
            </div>
          ` : ''}
          ${task.comment_count > 0 ? `<span>💬 ${task.comment_count}</span>` : ''}
        </div>
        ${tags.length > 0 ? `
          <div class="kanban-card-tags">
            ${tags.map(t => `<span class="kanban-tag">${esc(t)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════════════
  // Drag & Drop
  // ═══════════════════════════════════════════════════════════════

  function initDragDrop() {
    const cards = $$('.kanban-card');
    const bodies = $$('.kanban-column-body');

    cards.forEach(card => {
      card.addEventListener('dragstart', handleDragStart);
      card.addEventListener('dragend', handleDragEnd);
    });

    bodies.forEach(body => {
      body.addEventListener('dragover', handleDragOver);
      body.addEventListener('dragleave', handleDragLeave);
      body.addEventListener('drop', handleDrop);
    });
  }

  function handleDragStart(e) {
    draggedCard = e.target;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', e.target.dataset.id);
  }

  function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    $$('.kanban-column-body').forEach(b => b.classList.remove('drag-over'));
    draggedCard = null;
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
  }

  function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
  }

  async function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');

    const taskId = e.dataTransfer.getData('text/plain');
    const column = e.currentTarget.dataset.column;

    if (!taskId || !column) return;

    try {
      await moveTask(taskId, column);
      toast('Задача перемещена', 'success');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Task Details Modal
  // ═══════════════════════════════════════════════════════════════

  async function openTask(taskId) {
    const res = await fetch(`/api/tasks/${taskId}`, {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('jwt') }
    });
    if (!res.ok) {
      toast('Ошибка загрузки задачи', 'error');
      return;
    }
    const { task } = await res.json();
    const { comments } = await fetchComments(taskId);

    const priority = PRIORITIES[task.priority] || PRIORITIES.normal;
    const deadline = task.deadline ? new Date(task.deadline).toLocaleString('ru-RU') : 'Не указан';

    const commentsHtml = comments.map(c => `
      <div class="chat-message ${c.is_system ? 'system' : ''}">
        <div class="chat-message-bubble">
          <div class="chat-message-sender">${esc(c.user_name)}</div>
          <div class="chat-message-text">${esc(c.text)}</div>
          <div class="chat-message-time">${new Date(c.created_at).toLocaleString('ru-RU')}</div>
        </div>
      </div>
    `).join('') || '<p class="text-muted">Нет комментариев</p>';

    const html = `
      <div style="max-width: 600px;">
        <div class="row between mb-3">
          <span class="badge" style="background: ${priority.color}">${priority.icon} ${priority.label}</span>
          <span class="text-muted">Создано: ${new Date(task.created_at).toLocaleDateString('ru-RU')}</span>
        </div>

        <h3 class="mb-2">${esc(task.title)}</h3>
        ${task.description ? `<p class="mb-3">${esc(task.description)}</p>` : ''}

        <div class="info-row">
          <span>📅 Дедлайн</span>
          <span>${deadline}</span>
        </div>
        <div class="info-row">
          <span>👤 Исполнитель</span>
          <span>${esc(task.assignee_name)}</span>
        </div>
        <div class="info-row">
          <span>👤 Создатель</span>
          <span>${esc(task.creator_name)}</span>
        </div>
        ${task.acknowledged_at ? `
          <div class="info-row">
            <span>👁️ Ознакомлен</span>
            <span>${new Date(task.acknowledged_at).toLocaleString('ru-RU')}</span>
          </div>
        ` : `
          <div class="info-row">
            <span>👁️ Ознакомление</span>
            <button class="btn btn-sm" onclick="AsgardKanban.acknowledge(${task.id})">Подтвердить</button>
          </div>
        `}

        <h4 class="mt-4 mb-2">💬 Комментарии</h4>
        <div class="chat-messages" style="max-height: 200px; overflow-y: auto;">
          ${commentsHtml}
        </div>

        <div class="chat-input-area mt-3">
          <textarea id="task-comment-input" class="chat-input" placeholder="Написать комментарий..." rows="2"></textarea>
          <button class="btn primary" onclick="AsgardKanban.submitComment(${task.id})">Отправить</button>
        </div>

        <div class="row between mt-4">
          <button class="btn" onclick="AsgardKanban.toggleWatch(${task.id})">👁️ Подписаться</button>
          <button class="btn secondary" onclick="AsgardUI.closeModal()">Закрыть</button>
        </div>
      </div>
    `;

    showModal(html, { title: `Задача #${task.id}` });
  }

  async function submitComment(taskId) {
    const input = $('#task-comment-input');
    const text = input?.value?.trim();
    if (!text) return;

    try {
      await addComment(taskId, text);
      toast('Комментарий добавлен', 'success');
      closeModal();
      await openTask(taskId);
    } catch (e) {
      toast('Ошибка отправки', 'error');
    }
  }

  async function acknowledge(taskId) {
    try {
      await acknowledgeTask(taskId);
      toast('Ознакомление подтверждено', 'success');
      closeModal();
      await refresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function toggleWatch(taskId) {
    try {
      await watchTask(taskId, true);
      toast('Вы подписаны на задачу', 'success');
    } catch (e) {
      toast('Ошибка', 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Filters
  // ═══════════════════════════════════════════════════════════════

  function applyFilters() {
    const priority = $('#filter-priority')?.value || '';
    const assignee = $('#filter-assignee')?.value || '';

    currentFilters = {};
    if (priority) currentFilters.priority = priority;
    if (assignee) currentFilters.assignee_id = assignee;

    refresh();
  }

  function clearFilters() {
    currentFilters = {};
    refresh();
  }

  async function refresh() {
    const ctx = AsgardRouter.getContext?.() || {};
    await render(ctx);
  }

  // ═══════════════════════════════════════════════════════════════
  // Export
  // ═══════════════════════════════════════════════════════════════

  return {
    render,
    refresh,
    openTask,
    submitComment,
    acknowledge,
    toggleWatch,
    applyFilters,
    clearFilters
  };
})();
