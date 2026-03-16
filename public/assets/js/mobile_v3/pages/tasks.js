/**
 * ASGARD CRM — Mobile v3 / Мои задачи
 * Окно 3, Сессия 8 — 14.03.2026
 * FIX: async skeleton, replaceChildren, DS tokens
 */
var TasksPage = {
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

    var PRIORITY_MAP = {
      urgent: { label: 'Срочный', color: 'danger' },
      high:   { label: 'Высокий', color: 'warning' },
      normal: { label: 'Обычный', color: 'info' },
      low:    { label: 'Низкий',  color: 'neutral' },
    };

    var tasks = [];
    var todo = [];

    // ── Build page shell synchronously ──
    var page = el('div', { style: { background: t.bg, paddingBottom: '100px' } });

    page.appendChild(M.Header({ title: 'Мои задачи', subtitle: 'ЗАДАЧИ', back: true, backHref: '/home', actions: [
      { icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>', onClick: function () { openSearch(); } },
    ] }));

    var activeTab = 'tasks';
    var contentWrap = el('div');

    var segment = M.SegmentControl({
      items: [
        { label: 'От руководства', value: 'tasks' },
        { label: 'Мой Todo', value: 'todo' },
      ],
      active: 'tasks',
      onChange: function (v) { activeTab = v; renderContent(); },
    });
    page.appendChild(el('div', { style: { padding: '12px 20px 0' } }, segment));
    page.appendChild(contentWrap);

    // Show skeleton immediately — visible while data loads
    contentWrap.replaceChildren(M.Skeleton({ type: 'card', count: 5 }));

    page.appendChild(M.FAB({ icon: '+', onClick: function () { openCreateForm(); } }));

    // ── Load data AFTER page is returned to DOM ──
    setTimeout(function () {
      Promise.all([
        API.fetch('/tasks/my'),
        API.fetch('/tasks/todo'),
      ]).then(function (results) {
        tasks = API.extractRows(results[0]);
        todo = API.extractRows(results[1]);
        renderContent();
      }).catch(function (e) {
        M.Toast({ message: 'Ошибка загрузки задач', type: 'error' });
        renderContent();
      });
    }, 0);

    function renderContent() {
      contentWrap.replaceChildren();
      if (activeTab === 'tasks') {
        renderTasksList(contentWrap);
      } else {
        renderTodoList(contentWrap);
      }
    }

    function renderTasksList(container) {
      if (!tasks.length) {
        container.appendChild(M.Empty({ text: 'Нет задач от руководства', icon: '📋' }));
        return;
      }
      var wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 20px' } });
      tasks.forEach(function (task) {
        var st = STATUS_MAP[task.status] || STATUS_MAP.new;
        var pr = PRIORITY_MAP[task.priority] || PRIORITY_MAP.normal;
        var isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== 'done';

        var card = M.SwipeCard({
          title: task.title || task.text || 'Задача #' + task.id,
          subtitle: task.description ? task.description.slice(0, 60) : undefined,
          rightActions: [].concat(
            task.status !== 'done' ? [{ label: '✓', color: t.green, onClick: function () { completeTask(task.id); } }] : [],
            task.status === 'new' ? [{ label: '▶', color: t.blue, onClick: function () { acceptTask(task.id); } }] : []
          ),
        });

        var badgeWrap = el('div', { style: { display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' } });
        badgeWrap.appendChild(M.Badge({ text: isOverdue ? 'Просрочена' : st.label, color: isOverdue ? 'danger' : st.color }));
        if (task.priority === 'urgent' || task.priority === 'high') {
          badgeWrap.appendChild(M.Badge({ text: pr.label, color: pr.color }));
        }
        if (task.files_count > 0) {
          badgeWrap.appendChild(M.Badge({ text: '📎 ' + task.files_count, color: 'neutral' }));
        }
        var inner = card.querySelector('.asgard-swipe-card__content') || card.querySelector('div');
        if (inner) inner.appendChild(badgeWrap);

        card.addEventListener('click', function (e) {
          if (e.target.closest('button')) return;
          openTaskDetail(task);
        });
        wrap.appendChild(card);
      });
      container.appendChild(wrap);
    }

    function renderTodoList(container) {
      if (!todo.length) {
        container.appendChild(M.Empty({ text: 'Список дел пуст', icon: '✅' }));
        return;
      }
      var wrap = el('div', { style: { padding: '12px 20px' } });
      var listEl = el('div', { style: { background: t.surface, borderRadius: '16px', border: '1px solid ' + t.border, overflow: 'hidden' } });
      todo.forEach(function (item, i) {
        var row = el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', borderBottom: i < todo.length - 1 ? '1px solid ' + t.border : 'none', cursor: 'pointer' } });
        var ck = el('div', { style: {
          width: '22px', height: '22px', borderRadius: '6px', flexShrink: 0,
          border: item.is_done ? 'none' : '2px solid ' + t.border,
          background: item.is_done ? t.green : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: '13px', fontWeight: 700,
        } }, item.is_done ? '✓' : '');
        row.appendChild(ck);
        row.appendChild(el('span', { style: Object.assign({}, DS.font('base'), {
          color: item.is_done ? t.textTer : t.text,
          textDecoration: item.is_done ? 'line-through' : 'none',
          flex: 1,
        }) }, item.text || item.title || ''));
        if (item.deadline) {
          row.appendChild(el('span', { style: Object.assign({}, DS.font('xs'), { color: t.textTer, flexShrink: 0 }) }, Utils.formatDate(item.deadline)));
        }
        row.addEventListener('click', function () { toggleTodo(item, ck, row); });
        listEl.appendChild(row);
      });
      wrap.appendChild(listEl);
      container.appendChild(wrap);
    }

    // ── Actions ──
    function completeTask(id) {
      API.fetch('/tasks/' + id + '/complete', { method: 'POST' }).then(function () {
        M.Toast({ message: 'Задача выполнена', type: 'success' });
        return API.fetch('/tasks/my', { noCache: true });
      }).then(function (d) {
        tasks = Array.isArray(d) ? d : (d.tasks || d.items || []);
        renderContent();
      }).catch(function (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); });
    }

    function acceptTask(id) {
      API.fetch('/tasks/' + id + '/accept', { method: 'POST' }).then(function () {
        M.Toast({ message: 'Задача принята', type: 'success' });
        return API.fetch('/tasks/my', { noCache: true });
      }).then(function (d) {
        tasks = Array.isArray(d) ? d : (d.tasks || d.items || []);
        renderContent();
      }).catch(function (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); });
    }

    function toggleTodo(item, ckEl, rowEl) {
      item.is_done = !item.is_done;
      ckEl.style.background = item.is_done ? t.green : 'transparent';
      ckEl.style.border = item.is_done ? 'none' : '2px solid ' + t.border;
      ckEl.textContent = item.is_done ? '✓' : '';
      rowEl.children[1].style.textDecoration = item.is_done ? 'line-through' : 'none';
      rowEl.children[1].style.color = item.is_done ? t.textTer : t.text;
      try { navigator.vibrate(10); } catch (_) {}
      API.fetch('/tasks/todo', { method: 'PUT', body: { id: item.id, is_done: item.is_done } }).catch(function () {});
    }

    function openTaskDetail(task) {
      var st = STATUS_MAP[task.status] || STATUS_MAP.new;
      var fields = [
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'От', value: task.creator_name || '—' },
      ];
      if (task.deadline) fields.push({ label: 'Дедлайн', value: Utils.formatDate(task.deadline) });
      if (task.priority) fields.push({ label: 'Приоритет', value: (PRIORITY_MAP[task.priority] || {}).label || task.priority });
      if (task.description) fields.push({ label: 'Описание', value: task.description });
      var content = el('div');
      content.appendChild(M.DetailFields({ fields: fields }));
      if (task.status !== 'done') {
        var btns = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } });
        if (task.status === 'new') {
          btns.appendChild(M.FullWidthBtn({ label: '▶ Принять', variant: 'secondary', onClick: function () { acceptTask(task.id); } }));
        }
        btns.appendChild(M.FullWidthBtn({ label: '✓ Выполнить', onClick: function () { completeTask(task.id); } }));
        content.appendChild(btns);
      }
      M.BottomSheet({ title: task.title || 'Задача', content: content });
    }

    function openCreateForm() {
      if (activeTab === 'todo') { openCreateTodo(); }
      else { M.Toast({ message: 'Создание задач — только с десктопа', type: 'info' }); }
    }

    function openCreateTodo() {
      var content = el('div');
      content.appendChild(M.Form({
        fields: [
          { id: 'text', label: 'Что нужно сделать?', required: true },
          { id: 'deadline', label: 'Дедлайн', type: 'date' },
        ],
        submitLabel: 'Добавить',
        onSubmit: function (data) {
          API.fetch('/tasks/todo', { method: 'POST', body: data }).then(function () {
            M.Toast({ message: 'Добавлено', type: 'success' });
            return API.fetch('/tasks/todo', { noCache: true });
          }).then(function (d) {
            todo = Array.isArray(d) ? d : (d.items || []);
            renderContent();
          }).catch(function (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); });
        },
      }));
      M.BottomSheet({ title: 'Новое дело', content: content });
    }

    function openSearch() {
      var savedTasks = tasks.slice();
      var savedTodo = todo.slice();
      var content = el('div');
      content.appendChild(M.SearchBar({
        placeholder: 'Поиск задач...',
        autoFocus: true,
        onSearch: function (q) {
          var query = q.toLowerCase();
          if (!query) { tasks = savedTasks; todo = savedTodo; renderContent(); return; }
          if (activeTab === 'tasks') {
            tasks = savedTasks.filter(function (item) { return JSON.stringify(item).toLowerCase().includes(query); });
          } else {
            todo = savedTodo.filter(function (item) { return JSON.stringify(item).toLowerCase().includes(query); });
          }
          renderContent();
        },
      }));
      M.BottomSheet({ title: 'Поиск', content: content });
    }

    // Theme reactivity
    window.addEventListener('asgard:theme', function () {
      var cz = document.getElementById('asgard-content');
      if (!cz) return;
      var pg = cz.querySelector('.asgard-page');
      if (pg) { pg.replaceChildren(); var fresh = TasksPage.render(); while (fresh.firstChild) pg.appendChild(fresh.firstChild); }
    }, { once: true });

    return page;
  },
};

Router.register('/tasks', TasksPage);
if (typeof window !== 'undefined') window.TasksPage = TasksPage;
