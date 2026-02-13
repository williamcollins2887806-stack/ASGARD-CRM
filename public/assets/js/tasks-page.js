/**
 * ASGARD CRM — Задачи (tasks) CRUD
 * Статусы: Новая → В работе → Выполнена → Закрыта
 */
window.AsgardTasksPage = (function(){
  const { $, $$, esc, toast, showModal, hideModal } = AsgardUI;

  const STATUSES = ['Новая', 'В работе', 'Выполнена', 'Закрыта'];
  const STATUS_COLORS = {
    'Новая': '#3b82f6',
    'В работе': '#f59e0b',
    'Выполнена': '#22c55e',
    'Закрыта': '#64748b'
  };
  const PRIORITIES = { high: '🔴 Высокий', medium: '🟡 Средний', low: '🟢 Низкий' };

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('ru-RU');
  }

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user;
    const users = await AsgardDB.all('users') || [];
    const usersMap = new Map(users.map(u => [u.id, u]));

    let filterStatus = '';
    let tasks = [];

    async function loadTasks() {
      try {
        const token = localStorage.getItem('asgard_token');
        let url = '/api/tasks?limit=500';
        if (filterStatus) url += '&status=' + encodeURIComponent(filterStatus);
        const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
        if (!resp.ok) { tasks = []; return; }
        const data = await resp.json();
        tasks = data.tasks || [];
      } catch (e) {
        tasks = [];
      }
    }

    function taskRow(t) {
      const assignee = usersMap.get(t.assigned_to);
      const author = usersMap.get(t.created_by);
      const color = STATUS_COLORS[t.status] || '#64748b';
      const prioLabel = PRIORITIES[t.priority] || '🟡 Средний';
      const overdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'Закрыта' && t.status !== 'Выполнена';

      return `<tr data-id="${t.id}" style="${overdue ? 'background:rgba(239,68,68,.08)' : ''}">
        <td><span class="dot" style="background:${color}"></span> ${esc(t.status)}</td>
        <td><a href="#" class="task-link" data-id="${t.id}">${esc(t.title || 'Без названия')}</a></td>
        <td>${esc(assignee?.name || '—')}</td>
        <td>${esc(author?.name || '—')}</td>
        <td>${prioLabel}</td>
        <td>${fmtDate(t.due_date)}${overdue ? ' ⚠️' : ''}</td>
        <td>
          ${t.status === 'Новая' ? `<button class="btn mini" data-action="В работе" data-tid="${t.id}">▶ В работу</button>` : ''}
          ${t.status === 'В работе' ? `<button class="btn mini" data-action="Выполнена" data-tid="${t.id}">✓ Выполнена</button>` : ''}
          ${t.status === 'Выполнена' ? `<button class="btn mini" data-action="Закрыта" data-tid="${t.id}">🔒 Закрыть</button>` : ''}
        </td>
      </tr>`;
    }

    function renderTaskForm(task) {
      const isEdit = !!task;
      const t = task || {};
      const userOpts = users.filter(u => u.is_active !== false).map(u =>
        `<option value="${u.id}" ${u.id === t.assigned_to ? 'selected' : ''}>${esc(u.name || u.login)}</option>`
      ).join('');

      return `
        <div style="display:flex; flex-direction:column; gap:14px;">
          <div>
            <label>Название задачи</label>
            <input id="tf_title" class="inp" value="${esc(t.title || '')}" placeholder="Что нужно сделать?"/>
          </div>
          <div>
            <label>Описание</label>
            <textarea id="tf_desc" class="inp" rows="3" placeholder="Подробности...">${esc(t.description || '')}</textarea>
          </div>
          <div class="row" style="gap:12px">
            <div style="flex:1">
              <label>Исполнитель</label>
              <select id="tf_assignee" class="inp"><option value="">— Не назначен —</option>${userOpts}</select>
            </div>
            <div style="flex:1">
              <label>Приоритет</label>
              <select id="tf_priority" class="inp">
                <option value="low" ${t.priority === 'low' ? 'selected' : ''}>🟢 Низкий</option>
                <option value="medium" ${t.priority !== 'low' && t.priority !== 'high' ? 'selected' : ''}>🟡 Средний</option>
                <option value="high" ${t.priority === 'high' ? 'selected' : ''}>🔴 Высокий</option>
              </select>
            </div>
            <div style="flex:1">
              <label>Дедлайн</label>
              <input id="tf_due" type="date" class="inp" value="${t.due_date ? t.due_date.slice(0, 10) : ''}"/>
            </div>
          </div>
          <div class="row" style="gap:10px; justify-content:flex-end">
            <button class="btn ghost" id="tf_cancel">Отмена</button>
            <button class="btn primary" id="tf_save">${isEdit ? 'Сохранить' : 'Создать задачу'}</button>
          </div>
        </div>
      `;
    }

    async function openTaskModal(taskId) {
      let task = null;
      if (taskId) {
        task = tasks.find(t => t.id === taskId);
      }

      showModal({
        title: task ? 'Редактировать задачу' : 'Новая задача',
        html: renderTaskForm(task),
        onMount: function() {
          $('#tf_cancel').addEventListener('click', hideModal);
          $('#tf_save').addEventListener('click', async () => {
            const ttl = $('#tf_title').value.trim();
            if (!ttl) { toast('Ошибка', 'Введите название', 'err'); return; }

            const body = {
              title: ttl,
              description: $('#tf_desc').value.trim(),
              assigned_to: $('#tf_assignee').value ? parseInt($('#tf_assignee').value) : null,
              priority: $('#tf_priority').value,
              due_date: $('#tf_due').value || null
            };

            const token = localStorage.getItem('asgard_token');
            const url = task ? '/api/tasks/' + task.id : '/api/tasks';
            const method = task ? 'PUT' : 'POST';

            try {
              const resp = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify(body)
              });
              const data = await resp.json();
              if (!resp.ok) throw new Error(data.error || 'Ошибка');
              toast('Готово', task ? 'Задача обновлена' : 'Задача создана');
              hideModal();
              await renderContent();
            } catch (e) {
              toast('Ошибка', e.message, 'err');
            }
          });
        }
      });
    }

    async function changeStatus(taskId, newStatus) {
      const token = localStorage.getItem('asgard_token');
      try {
        const resp = await fetch('/api/tasks/' + taskId + '/status', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ status: newStatus })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Ошибка');
        toast('Готово', 'Статус: ' + newStatus);
        await renderContent();
      } catch (e) {
        toast('Ошибка', e.message, 'err');
      }
    }

    async function renderContent() {
      await loadTasks();

      const counts = {};
      STATUSES.forEach(s => { counts[s] = 0; });
      tasks.forEach(t => { if (counts[t.status] !== undefined) counts[t.status]++; });

      const html = `
        <div class="card">
          <div class="row" style="justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px">
            <div>
              <div class="kpi"><span class="dot" style="background:#3b82f6"></span> Задачи</div>
              <div class="help">Создавайте, назначайте и отслеживайте задачи.</div>
            </div>
            <button class="btn primary" id="btnNewTask">+ Новая задача</button>
          </div>
          <hr class="hr"/>
          <div class="row" style="gap:8px; flex-wrap:wrap; margin-bottom:12px">
            <button class="btn ${!filterStatus ? 'primary' : 'ghost'}" data-flt="">Все (${tasks.length})</button>
            ${STATUSES.map(s => '<button class="btn ' + (filterStatus === s ? 'primary' : 'ghost') + '" data-flt="' + s + '">' + s + ' (' + counts[s] + ')</button>').join('')}
          </div>
          <table class="tbl">
            <thead><tr>
              <th>Статус</th><th>Задача</th><th>Исполнитель</th><th>Автор</th><th>Приоритет</th><th>Дедлайн</th><th>Действия</th>
            </tr></thead>
            <tbody>${tasks.length ? tasks.map(taskRow).join('') : '<tr><td colspan="7" class="help" style="text-align:center;padding:30px">Задач пока нет</td></tr>'}</tbody>
          </table>
        </div>
      `;

      await layout(html, { title: title || 'Задачи' });

      // Event handlers
      $('#btnNewTask')?.addEventListener('click', function() { openTaskModal(); });

      $$('[data-flt]').forEach(function(btn) { btn.addEventListener('click', function() {
        filterStatus = btn.dataset.flt;
        renderContent();
      }); });

      $$('.task-link').forEach(function(a) { a.addEventListener('click', function(e) {
        e.preventDefault();
        openTaskModal(parseInt(a.dataset.id));
      }); });

      $$('[data-action]').forEach(function(btn) { btn.addEventListener('click', function() {
        changeStatus(parseInt(btn.dataset.tid), btn.dataset.action);
      }); });
    }

    await renderContent();
  }

  return { render: render };
})();
