/**
 * ASGARD CRM — Mobile v3 / Заявки HR
 * Окно 3, Сессия 9 — FIX: async skeleton
 */
var HrRequestsPage = {
  render: function () {
    var t = DS.t;
    var el = Utils.el;
    var STATUS_MAP = {
      draft: { label: 'Черновик', color: 'neutral' }, pending: { label: 'На рассмотрении', color: 'info' },
      approved: { label: 'Одобрена', color: 'success' }, rejected: { label: 'Отклонена', color: 'danger' },
      in_progress: { label: 'В работе', color: 'info' }, completed: { label: 'Завершена', color: 'success' },
      cancelled: { label: 'Отменена', color: 'neutral' },
    };
    var TYPE_MAP = {
      hire: 'Найм', dismiss: 'Увольнение', transfer: 'Перевод', vacation: 'Отпуск',
      sick: 'Больничный', document: 'Документ', other: 'Прочее',
    };
    var users = [];
    var userMap = new Map();

    var page = M.TablePage({
      title: 'Заявки HR', subtitle: 'КАДРЫ', back: true, backHref: '/home',
      items: [], search: true,
      filter: {
        pills: [
          { label: 'Все', value: 'all', active: true }, { label: 'На рассмотрении', value: 'pending' },
          { label: 'Одобрена', value: 'approved' }, { label: 'В работе', value: 'in_progress' }, { label: 'Отклонена', value: 'rejected' },
        ],
        filterFn: function (item, val) { return val === 'all' || item.status === val; },
      },
      renderItem: function (item) {
        var st = STATUS_MAP[item.status] || STATUS_MAP.draft;
        var typeName = TYPE_MAP[item.type] || item.type_name || item.type || '—';
        var fields = [];
        if (typeName) fields.push({ label: 'Тип', value: typeName });
        if (item.employee_name || item.employee_fio) fields.push({ label: 'Сотрудник', value: item.employee_name || item.employee_fio });
        if (item.requester_id) fields.push({ label: 'Заявитель', value: userMap.get(item.requester_id) || '—' });
        if (item.position) fields.push({ label: 'Должность', value: item.position });
        return M.Card({
          title: item.title || typeName + (item.employee_name ? ' — ' + item.employee_name : ''),
          badge: st.label, badgeColor: st.color, fields: fields,
          time: item.created_at ? Utils.relativeTime(item.created_at) : undefined,
          onClick: function () { openDetail(item); },
        });
      },
      empty: M.Empty({ text: 'Нет заявок HR', icon: '📋' }),
      fab: { icon: '+', onClick: function () { openCreateForm(); } },
      onRefresh: function () {
        return Promise.all([
          API.fetch('/hr-requests', { noCache: true }).catch(function () { return API.fetch('/staff/requests', { noCache: true }).catch(function () { return { items: [] }; }); }),
          API.fetch('/users').catch(function () { return []; }),
        ]).then(function (results) {
          var resp = results[0];
          var items = resp.items || resp.data || (Array.isArray(resp) ? resp : []);
          users = Array.isArray(results[1]) ? results[1] : (results[1].users || []);
          userMap = new Map(users.map(function (u) { return [u.id, u.name || u.fio || '—']; }));
          return items;
        }).catch(function (e) { M.Toast({ message: 'Ошибка загрузки', type: 'error' }); return []; });
      },
    });
    var listEl = page.querySelector('.asgard-table-page__list');
    if (listEl) listEl.replaceChildren(M.Skeleton({ type: 'card', count: 5 }));
    setTimeout(function () { window.dispatchEvent(new Event('asgard:refresh')); }, 0);

    function openDetail(item) {
      var st = STATUS_MAP[item.status] || STATUS_MAP.draft;
      var fields = [
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'Тип', value: TYPE_MAP[item.type] || item.type_name || item.type || '—' },
        { label: 'Сотрудник', value: item.employee_name || item.employee_fio || '—' },
        { label: 'Заявитель', value: item.requester_id ? userMap.get(item.requester_id) : '—' },
      ];
      if (item.position) fields.push({ label: 'Должность', value: item.position });
      if (item.department) fields.push({ label: 'Отдел', value: item.department });
      if (item.date_from) fields.push({ label: 'Дата с', value: Utils.formatDate(item.date_from) });
      if (item.date_to) fields.push({ label: 'Дата по', value: Utils.formatDate(item.date_to) });
      if (item.comment) fields.push({ label: 'Комментарий', value: item.comment });
      if (item.reason) fields.push({ label: 'Причина', value: item.reason });
      var content = el('div');
      content.appendChild(M.DetailFields({ fields: fields }));
      var user = Store.get('user');
      var canApprove = user && (user.role === 'ADMIN' || user.role === 'HR' || (user.role || '').startsWith('DIRECTOR'));
      if (canApprove && item.status === 'pending') {
        var btns = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } });
        btns.appendChild(M.FullWidthBtn({ label: '✓ Одобрить', onClick: function () {
          API.fetch('/hr-requests/' + item.id, { method: 'PUT', body: { status: 'approved' } })
            .then(function () { M.Toast({ message: 'Одобрено', type: 'success' }); })
            .catch(function () { M.Toast({ message: 'Ошибка', type: 'error' }); });
        } }));
        btns.appendChild(M.FullWidthBtn({ label: '✕ Отклонить', variant: 'danger', onClick: function () {
          M.Confirm({ title: 'Отклонить заявку?', danger: true }).then(function (ok) {
            if (!ok) return;
            API.fetch('/hr-requests/' + item.id, { method: 'PUT', body: { status: 'rejected' } })
              .then(function () { M.Toast({ message: 'Отклонено', type: 'success' }); })
              .catch(function () { M.Toast({ message: 'Ошибка', type: 'error' }); });
          });
        } }));
        content.appendChild(btns);
      }
      M.BottomSheet({ title: item.title || 'Заявка HR', content: content, fullscreen: true });
    }

    function openCreateForm() {
      var content = el('div');
      content.appendChild(M.Form({
        fields: [
          { id: 'type', label: 'Тип заявки', type: 'select', options: Object.entries(TYPE_MAP).map(function (e) { return { value: e[0], label: e[1] }; }), required: true },
          { id: 'employee_name', label: 'ФИО сотрудника', required: true },
          { id: 'position', label: 'Должность' },
          { id: 'date_from', label: 'Дата с', type: 'date' },
          { id: 'date_to', label: 'Дата по', type: 'date' },
          { id: 'comment', label: 'Комментарий', type: 'textarea' },
        ],
        submitLabel: 'Создать заявку',
        onSubmit: function (data) {
          API.fetch('/hr-requests', { method: 'POST', body: data })
            .then(function () { M.Toast({ message: 'Заявка создана', type: 'success' }); })
            .catch(function (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); });
        },
      }));
      M.BottomSheet({ title: 'Новая заявка HR', content: content, fullscreen: true });
    }
    return page;
  },
};
Router.register('/hr-requests', HrRequestsPage);
if (typeof window !== 'undefined') window.HrRequestsPage = HrRequestsPage;
