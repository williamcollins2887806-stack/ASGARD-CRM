/**
 * ASGARD CRM — Mobile v3 / Управление задачами (Admin)
 * Окно 3, Сессия 8 — 14.03.2026
 */
const TasksAdminPage = {
  async render() {
    const t = DS.t;
    const el = Utils.el;

    const STATUS_MAP = {
      new:         { label: 'Новая',      color: 'warning' },
      accepted:    { label: 'Принята',    color: 'info' },
      in_progress: { label: 'В работе',   color: 'info' },
      done:        { label: 'Выполнена',  color: 'success' },
      overdue:     { label: 'Просрочена', color: 'danger' },
    };

    let allTasks = [];
    let users = [];
    let stats = null;

    try {
      const [tasksResp, usersResp, statsResp] = await Promise.all([
        API.fetch('/tasks/all'),
        API.fetch('/users'),
        API.fetch('/tasks/stats').catch(() => null),
      ]);
      allTasks = Array.isArray(tasksResp) ? tasksResp : (tasksResp.tasks || tasksResp.items || []);
      users = Array.isArray(usersResp) ? usersResp : (usersResp.users || usersResp.items || []);
      stats = statsResp;
    } catch (e) { console.error('[TasksAdmin] load error', e); }

    const userMap = new Map(users.map(u => [u.id, u.name || u.fio || 'Без имени']));

    // Stats items
    const statsItems = [];
    if (stats) {
      if (stats.total != null) statsItems.push({ icon: '📋', value: stats.total, label: 'Всего', color: t.blue });
      if (stats.in_progress != null) statsItems.push({ icon: '⚡', value: stats.in_progress, label: 'В работе', color: t.orange });
      if (stats.done != null) statsItems.push({ icon: '✅', value: stats.done, label: 'Выполнено', color: t.green });
      if (stats.overdue != null) statsItems.push({ icon: '⚠️', value: stats.overdue, label: 'Просрочено', color: t.red });
    } else {
      const cnt = (s) => allTasks.filter(x => x.status === s).length;
      statsItems.push({ icon: '📋', value: allTasks.length, label: 'Всего', color: t.blue });
      statsItems.push({ icon: '⚡', value: cnt('in_progress'), label: 'В работе', color: t.orange });
      statsItems.push({ icon: '✅', value: cnt('done'), label: 'Выполнено', color: t.green });
      statsItems.push({ icon: '⚠️', value: allTasks.filter(x => x.status !== 'done' && x.deadline && new Date(x.deadline) < new Date()).length, label: 'Просрочено', color: t.red });
    }

    const filterPills = [
      { label: 'Все', value: 'all', active: true },
      { label: 'Новые', value: 'new' },
      { label: 'В работе', value: 'in_progress' },
      { label: 'Выполнено', value: 'done' },
      { label: 'Просрочено', value: 'overdue' },
    ];

    const page = M.TablePage({
      title: 'Управление задачами',
      subtitle: 'ВСЕ ЗАДАЧИ',
      back: true,
      backHref: '/home',
      items: allTasks,
      search: true,
      stats: statsItems,
      filter: {
        pills: filterPills,
        filterFn: (item, val) => {
          if (val === 'all') return true;
          if (val === 'overdue') return item.status !== 'done' && item.deadline && new Date(item.deadline) < new Date();
          return item.status === val;
        },
      },
      renderItem: (task) => {
        const st = STATUS_MAP[task.status] || STATUS_MAP.new;
        const isOverdue = task.status !== 'done' && task.deadline && new Date(task.deadline) < new Date();
        const assignee = task.assignee_id ? userMap.get(task.assignee_id) : (task.assignee_name || '—');
        const fields = [];
        if (assignee) fields.push({ label: 'Исполнитель', value: assignee });
        if (task.deadline) fields.push({ label: 'Дедлайн', value: Utils.formatDate(task.deadline) });
        if (task.creator_name) fields.push({ label: 'Автор', value: task.creator_name });

        return M.Card({
          title: task.title || task.text || 'Задача #' + task.id,
          badge: isOverdue ? 'Просрочена' : st.label,
          badgeColor: isOverdue ? 'danger' : st.color,
          fields,
          onClick: () => openDetail(task),
        });
      },
      empty: M.Empty({ text: 'Нет задач', icon: '📋' }),
      fab: { icon: '+', onClick: () => openCreateForm() },
      onRefresh: async () => {
        const resp = await API.fetch('/tasks/all', { noCache: true });
        return Array.isArray(resp) ? resp : (resp.tasks || resp.items || []);
      },
    });

    function openDetail(task) {
      const st = STATUS_MAP[task.status] || STATUS_MAP.new;
      const fields = [
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'Исполнитель', value: task.assignee_id ? userMap.get(task.assignee_id) : (task.assignee_name || '—') },
        { label: 'Автор', value: task.creator_name || '—' },
      ];
      if (task.deadline) fields.push({ label: 'Дедлайн', value: Utils.formatDate(task.deadline) });
      if (task.priority) fields.push({ label: 'Приоритет', value: task.priority });
      if (task.description) fields.push({ label: 'Описание', value: task.description });

      const content = el('div');
      content.appendChild(M.DetailFields({ fields }));

      if (task.status !== 'done') {
        const btns = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } });
        btns.appendChild(M.FullWidthBtn({
          label: '✓ Закрыть задачу',
          onClick: async () => {
            try {
              await API.fetch('/tasks/' + task.id, { method: 'PUT', body: { status: 'done' } });
              M.Toast({ message: 'Задача закрыта', type: 'success' });
            } catch (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); }
          },
        }));
        btns.appendChild(M.FullWidthBtn({
          label: '🗑 Удалить',
          variant: 'danger',
          onClick: async () => {
            const ok = await M.Confirm({ title: 'Удалить задачу?', message: task.title, danger: true });
            if (!ok) return;
            try {
              await API.fetch('/tasks/' + task.id, { method: 'DELETE' });
              M.Toast({ message: 'Удалено', type: 'success' });
            } catch (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); }
          },
        }));
        content.appendChild(btns);
      }

      M.BottomSheet({ title: task.title || 'Задача', content });
    }

    function openCreateForm() {
      const userOpts = users.filter(u => u.is_active !== false).map(u => ({ value: String(u.id), label: u.name || u.fio || 'ID:' + u.id }));

      const content = el('div');
      content.appendChild(M.Form({
        fields: [
          { id: 'title', label: 'Название задачи', required: true },
          { id: 'description', label: 'Описание', type: 'textarea' },
          { id: 'assignee_id', label: 'Исполнитель', type: 'select', options: userOpts, required: true },
          { id: 'deadline', label: 'Дедлайн', type: 'date' },
          { id: 'priority', label: 'Приоритет', type: 'select', options: [
            { value: 'normal', label: 'Обычный' },
            { value: 'high', label: 'Высокий' },
            { value: 'urgent', label: 'Срочный' },
            { value: 'low', label: 'Низкий' },
          ], value: 'normal' },
        ],
        submitLabel: 'Создать задачу',
        onSubmit: async (data) => {
          try {
            await API.fetch('/tasks', { method: 'POST', body: data });
            M.Toast({ message: 'Задача создана', type: 'success' });
          } catch (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); }
        },
      }));
      M.BottomSheet({ title: 'Новая задача', content, fullscreen: true });
    }

    return page;
  },
};

Router.register('/tasks-admin', TasksAdminPage);
if (typeof window !== 'undefined') window.TasksAdminPage = TasksAdminPage;
