/**
 * ASGARD CRM — Mobile v3 / Управление задачами (Admin)
 * Окно 3, Сессия 8 — 14.03.2026
 * FIX: async skeleton, no await before TablePage
 */
var TasksAdminPage = {
  render: function () {
    var t = DS.t;
    var el = Utils.el;

    var STATUS_MAP = {
      new:         { label: 'Новая',      color: 'warning' },
      accepted:    { label: 'Принята',    color: 'info' },
      in_progress: { label: 'В работе',   color: 'info' },
      done:        { label: 'Выполнена',  color: 'success' },
      overdue:     { label: 'Просрочена', color: 'danger' },
    };

    var allTasks = [];
    var users = [];
    var userMap = new Map();

    var filterPills = [
      { label: 'Все', value: 'all', active: true },
      { label: 'Новые', value: 'new' },
      { label: 'В работе', value: 'in_progress' },
      { label: 'Выполнено', value: 'done' },
      { label: 'Просрочено', value: 'overdue' },
    ];

    var page = M.TablePage({
      title: 'Управление задачами',
      subtitle: 'ВСЕ ЗАДАЧИ',
      back: true,
      backHref: '/home',
      items: [],
      search: true,
      filter: {
        pills: filterPills,
        filterFn: function (item, val) {
          if (val === 'all') return true;
          if (val === 'overdue') return item.status !== 'done' && item.deadline && new Date(item.deadline) < new Date();
          return item.status === val;
        },
      },
      renderItem: function (task) {
        var st = STATUS_MAP[task.status] || STATUS_MAP.new;
        var isOverdue = task.status !== 'done' && task.deadline && new Date(task.deadline) < new Date();
        var assignee = task.assignee_id ? userMap.get(task.assignee_id) : (task.assignee_name || '—');
        var fields = [];
        if (assignee) fields.push({ label: 'Исполнитель', value: assignee });
        if (task.deadline) fields.push({ label: 'Дедлайн', value: Utils.formatDate(task.deadline) });
        if (task.creator_name) fields.push({ label: 'Автор', value: task.creator_name });
        return M.Card({
          title: task.title || task.text || 'Задача #' + task.id,
          badge: isOverdue ? 'Просрочена' : st.label,
          badgeColor: isOverdue ? 'danger' : st.color,
          fields: fields,
          onClick: function () { openDetail(task); },
        });
      },
      empty: M.Empty({ text: 'Нет задач', icon: '📋' }),
      fab: { icon: '+', onClick: function () { openCreateForm(); } },
      onRefresh: function () {
        return Promise.all([
          API.fetch('/tasks/all', { noCache: true }),
          API.fetch('/users').catch(function () { return []; }),
        ]).then(function (results) {
          allTasks = API.extractRows(results[0]);
          users = API.extractRows(results[1]);
          userMap = new Map(users.map(function (u) { return [u.id, u.name || u.fio || 'Без имени']; }));
          return allTasks;
        }).catch(function (e) {
          M.Toast({ message: 'Ошибка загрузки', type: 'error' });
          return [];
        });
      },
    });

    // Skeleton → trigger load
    var listEl = page.querySelector('.asgard-table-page__list');
    if (listEl) listEl.replaceChildren(M.Skeleton({ type: 'card', count: 5 }));
    setTimeout(function () { window.dispatchEvent(new Event('asgard:refresh')); }, 0);

    function openDetail(task) {
      var st = STATUS_MAP[task.status] || STATUS_MAP.new;
      var fields = [
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'Исполнитель', value: task.assignee_id ? userMap.get(task.assignee_id) : (task.assignee_name || '—') },
        { label: 'Автор', value: task.creator_name || '—' },
      ];
      if (task.deadline) fields.push({ label: 'Дедлайн', value: Utils.formatDate(task.deadline) });
      if (task.priority) fields.push({ label: 'Приоритет', value: task.priority });
      if (task.description) fields.push({ label: 'Описание', value: task.description });
      var content = el('div');
      content.appendChild(M.DetailFields({ fields: fields }));
      if (task.status !== 'done') {
        var btns = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } });
        btns.appendChild(M.FullWidthBtn({
          label: '✓ Закрыть задачу',
          onClick: function () {
            API.fetch('/tasks/' + task.id + '/complete', { method: 'PUT' })
              .then(function () { M.Toast({ message: 'Задача закрыта', type: 'success' }); window.dispatchEvent(new Event('asgard:refresh')); })
              .catch(function (e) { M.Toast({ message: 'Ошибка: ' + (e.message || 'сервер недоступен'), type: 'error' }); });
          },
        }));
        btns.appendChild(M.FullWidthBtn({
          label: '🗑 Удалить',
          variant: 'danger',
          onClick: function () {
            M.Confirm({ title: 'Удалить задачу?', message: task.title, danger: true }).then(function (ok) {
              if (!ok) return;
              API.fetch('/tasks/' + task.id, { method: 'DELETE' })
                .then(function () { M.Toast({ message: 'Удалено', type: 'success' }); })
                .catch(function (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); });
            });
          },
        }));
        content.appendChild(btns);
      }
      M.BottomSheet({ title: task.title || 'Задача', content: content });
    }

    function openCreateForm() {
      var userOpts = users.filter(function (u) { return u.is_active !== false; }).map(function (u) { return { value: String(u.id), label: u.name || u.fio || 'ID:' + u.id }; });
      var content = el('div');
      content.appendChild(M.Form({
        fields: [
          { id: 'title', label: 'Название задачи', required: true },
          { id: 'description', label: 'Описание', type: 'textarea' },
          { id: 'assignee_id', label: 'Исполнитель', type: 'select', options: userOpts, required: true },
          { id: 'deadline', label: 'Дедлайн', type: 'date' },
          { id: 'priority', label: 'Приоритет', type: 'select', options: [
            { value: 'normal', label: 'Обычный' }, { value: 'high', label: 'Высокий' },
            { value: 'urgent', label: 'Срочный' }, { value: 'low', label: 'Низкий' },
          ], value: 'normal' },
        ],
        submitLabel: 'Создать задачу',
        onSubmit: function (data) {
          API.fetch('/tasks', { method: 'POST', body: data })
            .then(function () { M.Toast({ message: 'Задача создана', type: 'success' }); })
            .catch(function (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); });
        },
      }));
      M.BottomSheet({ title: 'Новая задача', content: content, fullscreen: true });
    }

    return page;
  },
};

Router.register('/tasks-admin', TasksAdminPage);
if (typeof window !== 'undefined') window.TasksAdminPage = TasksAdminPage;
