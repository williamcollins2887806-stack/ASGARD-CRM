/**
 * ASGARD CRM — Mobile v3 / Заявки на пропуски
 * Окно 3, Сессия 8 — FIX: async skeleton
 */
var PassRequestsPage = {
  render: function () {
    var t = DS.t;
    var el = Utils.el;
    var STATUS_MAP = {
      draft: { label: 'Черновик', color: 'neutral' }, submitted: { label: 'Подана', color: 'info' },
      approved: { label: 'Одобрена', color: 'success' }, rejected: { label: 'Отклонена', color: 'danger' },
      issued: { label: 'Выдан', color: 'success' }, expired: { label: 'Просрочен', color: 'warning' },
    };
    var items = [];

    var page = M.TablePage({
      title: 'Пропуска', subtitle: 'ЗАЯВКИ', back: true, backHref: '/home',
      items: [], search: true,
      filter: {
        pills: [
          { label: 'Все', value: 'all', active: true }, { label: 'Подана', value: 'submitted' },
          { label: 'Одобрена', value: 'approved' }, { label: 'Отклонена', value: 'rejected' }, { label: 'Выдан', value: 'issued' },
        ],
        filterFn: function (item, val) { return val === 'all' || item.status === val; },
      },
      renderItem: function (item) {
        var st = STATUS_MAP[item.status] || STATUS_MAP.draft;
        var emps = Array.isArray(item.employees_json) ? item.employees_json : [];
        var fields = [];
        if (item.object_name) fields.push({ label: 'Объект', value: item.object_name });
        if (emps.length) fields.push({ label: 'Сотрудники', value: emps.length + ' чел.' });
        if (item.pass_date_from && item.pass_date_to) fields.push({ label: 'Период', value: Utils.formatDate(item.pass_date_from) + ' — ' + Utils.formatDate(item.pass_date_to) });
        return M.Card({
          title: item.object_name || 'Заявка #' + item.id,
          badge: st.label, badgeColor: st.color, fields: fields,
          time: item.created_at ? Utils.relativeTime(item.created_at) : undefined,
          onClick: function () { openDetail(item); },
        });
      },
      empty: M.Empty({ text: 'Нет заявок на пропуски', icon: '🪪' }),
      fab: { icon: '+', onClick: function () { openCreateForm(); } },
      onRefresh: function () {
        return API.fetch('/pass-requests', { noCache: true }).then(function (resp) {
          items = resp.items || resp.data || (Array.isArray(resp) ? resp : []);
          return items;
        }).catch(function (e) { M.Toast({ message: 'Ошибка загрузки', type: 'error' }); return []; });
      },
    });
    var listEl = page.querySelector('.asgard-table-page__list');
    if (listEl) listEl.replaceChildren(M.Skeleton({ type: 'card', count: 5 }));
    setTimeout(function () { window.dispatchEvent(new Event('asgard:refresh')); }, 0);

    function openDetail(item) {
      var st = STATUS_MAP[item.status] || STATUS_MAP.draft;
      var emps = Array.isArray(item.employees_json) ? item.employees_json : [];
      var fields = [
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'Объект', value: item.object_name || '—' },
        { label: 'Период', value: (item.pass_date_from ? Utils.formatDate(item.pass_date_from) : '?') + ' — ' + (item.pass_date_to ? Utils.formatDate(item.pass_date_to) : '?') },
        { label: 'Сотрудники', value: emps.length ? emps.map(function (e) { return e.fio || e.name || e; }).join(', ') : '—' },
      ];
      if (item.comment) fields.push({ label: 'Комментарий', value: item.comment });
      var content = el('div');
      content.appendChild(M.DetailFields({ fields: fields }));
      var btns = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } });
      btns.appendChild(M.FullWidthBtn({ label: '📄 PDF', variant: 'secondary', onClick: function () { window.open(API.BASE + '/pass-requests/' + item.id + '/pdf?token=' + API.getToken(), '_blank'); } }));
      if (item.status === 'draft') {
        btns.appendChild(M.FullWidthBtn({ label: 'Подать', onClick: function () {
          API.fetch('/pass-requests/' + item.id, { method: 'PUT', body: { status: 'submitted' } })
            .then(function () { M.Toast({ message: 'Заявка подана', type: 'success' }); })
            .catch(function () { M.Toast({ message: 'Ошибка', type: 'error' }); });
        } }));
      }
      content.appendChild(btns);
      M.BottomSheet({ title: 'Заявка #' + item.id, content: content });
    }

    function openCreateForm() {
      var content = el('div');
      content.appendChild(M.Form({
        fields: [
          { id: 'object_name', label: 'Объект', required: true },
          { id: 'pass_date_from', label: 'Дата с', type: 'date', required: true },
          { id: 'pass_date_to', label: 'Дата по', type: 'date', required: true },
          { id: 'comment', label: 'Комментарий', type: 'textarea' },
        ],
        submitLabel: 'Создать заявку',
        onSubmit: function (data) {
          API.fetch('/pass-requests', { method: 'POST', body: data })
            .then(function () { M.Toast({ message: 'Заявка создана', type: 'success' }); })
            .catch(function (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); });
        },
      }));
      M.BottomSheet({ title: 'Новая заявка на пропуск', content: content, fullscreen: true });
    }
    return page;
  },
};
Router.register('/pass-requests', PassRequestsPage);
if (typeof window !== 'undefined') window.PassRequestsPage = PassRequestsPage;
