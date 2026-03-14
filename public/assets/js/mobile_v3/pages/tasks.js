/**
 * ASGARD CRM — Mobile v3 / Мои задачи
 * Окно 3, Сессия 8 — 14.03.2026
 */
const TasksPage = {
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

    const PRIORITY_MAP = {
      urgent: { label: 'Срочный', color: 'danger' },
      high:   { label: 'Высокий', color: 'warning' },
      normal: { label: 'Обычный', color: 'info' },
      low:    { label: 'Низкий',  color: 'neutral' },
    };

    let tasks = [];
    let todo = [];

    // ── Load data ──
    async function loadData() {
      try {
        const [tasksResp, todoResp] = await Promise.all([
          API.fetch('/tasks/my'),
          API.fetch('/tasks/todo'),
        ]);
        tasks = Array.isArray(tasksResp) ? tasksResp : (tasksResp.tasks || tasksResp.items || []);
        todo = Array.isArray(todoResp) ? todoResp : (todoResp.items || []);
      } catch (e) {
        console.error('[TasksPage] load error', e);
      }
    }

    await loadData();

    // ── Render ──
    const page = el('div', { style: { background: t.bg, paddingBottom: '100px' } });

    // Header
    page.appendChild(M.Header({ title: 'Мои задачи', subtitle: 'ЗАДАЧИ', back: true, backHref: '/home', actions: [
      { icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>', onClick: () => openSearch() },
    ] }));

    // Segment: Задачи / Todo
    let activeTab = 'tasks';
    const contentWrap = el('div');

    const segment = M.SegmentControl({
      items: [
        { label: 'От руководства', value: 'tasks' },
        { label: 'Мой Todo', value: 'todo' },
      ],
      active: 'tasks',
      onChange: (v) => { activeTab = v; renderContent(); },
    });
    page.appendChild(el('div', { style: { padding: '12px 20px 0' } }, segment));
    page.appendChild(contentWrap);

    function renderContent() {
      contentWrap.innerHTML = '';
      if (activeTab === 'tasks') {
        renderTasksList(contentWrap);
      } else {
        renderTodoList(contentWrap);
      }
    }

    // ── Tasks from management ──
    function renderTasksList(container) {
      if (!tasks.length) {
        container.appendChild(M.Empty({ text: 'Нет задач от руководства', icon: '📋' }));
        return;
      }

      const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 20px' } });
      tasks.forEach((task) => {
        const st = STATUS_MAP[task.status] || STATUS_MAP.new;
        const pr = PRIORITY_MAP[task.priority] || PRIORITY_MAP.normal;
        const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== 'done';
        const fields = [];
        if (task.creator_name) fields.push({ label: 'От', value: task.creator_name });
        if (task.deadline) fields.push({ label: 'Дедлайн', value: Utils.formatDate(task.deadline) });
        if (task.priority && task.priority !== 'normal') fields.push({ label: 'Приоритет', value: pr.label });

        const card = M.SwipeCard({
          title: task.title || task.text || 'Задача #' + task.id,
          subtitle: task.description ? task.description.slice(0, 60) : undefined,
          rightActions: [
            ...(task.status !== 'done' ? [{ label: '✓', color: '#34C759', onClick: () => completeTask(task.id) }] : []),
            ...(task.status === 'new' ? [{ label: '▶', color: '#4A90D9', onClick: () => acceptTask(task.id) }] : []),
          ],
        });

        // Badge overlay
        const badgeWrap = el('div', { style: { display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' } });
        badgeWrap.appendChild(M.Badge({ text: isOverdue ? 'Просрочена' : st.label, color: isOverdue ? 'danger' : st.color }));
        if (task.priority === 'urgent' || task.priority === 'high') {
          badgeWrap.appendChild(M.Badge({ text: pr.label, color: pr.color }));
        }
        if (task.files_count > 0) {
          badgeWrap.appendChild(M.Badge({ text: '📎 ' + task.files_count, color: 'neutral' }));
        }
        card.querySelector('.asgard-swipe-card__content, div')?.appendChild(badgeWrap);

        card.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          openTaskDetail(task);
        });

        wrap.appendChild(card);
      });
      container.appendChild(wrap);
    }

    // ── Todo list ──
    function renderTodoList(container) {
      const wrap = el('div', { style: { padding: '12px 20px' } });
      const listEl = el('div', { style: { background: t.surface, borderRadius: '16px', border: '1px solid ' + t.border, overflow: 'hidden' } });

      if (!todo.length) {
        container.appendChild(M.Empty({ text: 'Список дел пуст', icon: '✅' }));
        return;
      }

      todo.forEach((item, i) => {
        const row = el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', borderBottom: i < todo.length - 1 ? '1px solid ' + t.border : 'none', cursor: 'pointer' } });

        const ck = el('div', { style: {
          width: '22px', height: '22px', borderRadius: '6px', flexShrink: 0,
          border: item.is_done ? 'none' : '2px solid ' + t.border,
          background: item.is_done ? t.green : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: '13px', fontWeight: 700,
        } }, item.is_done ? '✓' : '');

        row.appendChild(ck);
        row.appendChild(el('span', { style: {
          ...DS.font('base'),
          color: item.is_done ? t.textTer : t.text,
          textDecoration: item.is_done ? 'line-through' : 'none',
          flex: 1,
        } }, item.text || item.title || ''));

        if (item.deadline) {
          row.appendChild(el('span', { style: { ...DS.font('xs'), color: t.textTer, flexShrink: 0 } }, Utils.formatDate(item.deadline)));
        }

        row.addEventListener('click', () => toggleTodo(item, ck, row));
        listEl.appendChild(row);
      });

      wrap.appendChild(listEl);
      container.appendChild(wrap);
    }

    renderContent();

    // ── FAB ──
    page.appendChild(M.FAB({ icon: '+', onClick: () => openCreateForm() }));

    // ── Actions ──
    async function completeTask(id) {
      try {
        await API.fetch('/tasks/' + id + '/complete', { method: 'POST' });
        M.Toast({ message: 'Задача выполнена', type: 'success' });
        const newData = await API.fetch('/tasks/my', { noCache: true });
        tasks = Array.isArray(newData) ? newData : (newData.tasks || newData.items || []);
        renderContent();
      } catch (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); }
    }

    async function acceptTask(id) {
      try {
        await API.fetch('/tasks/' + id + '/accept', { method: 'POST' });
        M.Toast({ message: 'Задача принята', type: 'success' });
        const newData = await API.fetch('/tasks/my', { noCache: true });
        tasks = Array.isArray(newData) ? newData : (newData.tasks || newData.items || []);
        renderContent();
      } catch (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); }
    }

    async function toggleTodo(item, ckEl, rowEl) {
      item.is_done = !item.is_done;
      ckEl.style.background = item.is_done ? t.green : 'transparent';
      ckEl.style.border = item.is_done ? 'none' : '2px solid ' + t.border;
      ckEl.textContent = item.is_done ? '✓' : '';
      rowEl.children[1].style.textDecoration = item.is_done ? 'line-through' : 'none';
      rowEl.children[1].style.color = item.is_done ? t.textTer : t.text;
      try { navigator.vibrate(10); } catch (_) {}
      try {
        await API.fetch('/tasks/todo', { method: 'PUT', body: { id: item.id, is_done: item.is_done } });
      } catch (_) {}
    }

    function openTaskDetail(task) {
      const st = STATUS_MAP[task.status] || STATUS_MAP.new;
      const fields = [
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'От', value: task.creator_name || '—' },
      ];
      if (task.deadline) fields.push({ label: 'Дедлайн', value: Utils.formatDate(task.deadline) });
      if (task.priority) fields.push({ label: 'Приоритет', value: (PRIORITY_MAP[task.priority] || {}).label || task.priority });
      if (task.description) fields.push({ label: 'Описание', value: task.description });

      const content = el('div');
      content.appendChild(M.DetailFields({ fields }));

      if (task.status !== 'done') {
        const btns = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } });
        if (task.status === 'new') {
          btns.appendChild(M.FullWidthBtn({ label: '▶ Принять', variant: 'secondary', onClick: () => acceptTask(task.id) }));
        }
        btns.appendChild(M.FullWidthBtn({ label: '✓ Выполнить', onClick: () => completeTask(task.id) }));
        content.appendChild(btns);
      }

      M.BottomSheet({ title: task.title || 'Задача', content });
    }

    function openCreateForm() {
      if (activeTab === 'todo') {
        openCreateTodo();
      } else {
        openCreateTask();
      }
    }

    function openCreateTodo() {
      const content = el('div');
      content.appendChild(M.Form({
        fields: [
          { id: 'text', label: 'Что нужно сделать?', required: true },
          { id: 'deadline', label: 'Дедлайн', type: 'date' },
        ],
        submitLabel: 'Добавить',
        onSubmit: async (data) => {
          try {
            await API.fetch('/tasks/todo', { method: 'POST', body: data });
            M.Toast({ message: 'Добавлено', type: 'success' });
            const newData = await API.fetch('/tasks/todo', { noCache: true });
            todo = Array.isArray(newData) ? newData : (newData.items || []);
            renderContent();
          } catch (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); }
        },
      }));
      M.BottomSheet({ title: 'Новое дело', content });
    }

    function openCreateTask() {
      M.Toast({ message: 'Создание задач — только с десктопа', type: 'info' });
    }

    function openSearch() {
      const content = el('div');
      content.appendChild(M.SearchBar({
        placeholder: 'Поиск задач...',
        autoFocus: true,
        onSearch: (q) => {
          const query = q.toLowerCase();
          const all = activeTab === 'tasks' ? tasks : todo;
          const filtered = all.filter(item => {
            const text = JSON.stringify(item).toLowerCase();
            return text.includes(query);
          });
          contentWrap.innerHTML = '';
          if (activeTab === 'tasks') {
            tasks = filtered;
            renderTasksList(contentWrap);
          } else {
            todo = filtered;
            renderTodoList(contentWrap);
          }
        },
      }));
      M.BottomSheet({ title: 'Поиск', content });
    }

    // Theme reactivity
    window.addEventListener('asgard:theme', () => {
      const content = document.getElementById('asgard-content');
      if (content) {
        const pg = content.querySelector('.asgard-page');
        if (pg) { pg.innerHTML = ''; TasksPage.render().then(fresh => { while (fresh.firstChild) pg.appendChild(fresh.firstChild); }); }
      }
    }, { once: true });

    return page;
  },
};

Router.register('/tasks', TasksPage);
if (typeof window !== 'undefined') window.TasksPage = TasksPage;
