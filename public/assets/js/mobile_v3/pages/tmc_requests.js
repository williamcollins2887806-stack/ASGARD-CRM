/**
 * ASGARD CRM — Mobile v3 / Заявки на ТМЦ
 * Окно 3, Сессия 8 — FIX: async skeleton
 */
var TmcRequestsPage = {
  render: function () {
    var t = DS.t;
    var el = Utils.el;
    var STATUS_MAP = {
      draft: { label: 'Черновик', color: 'neutral' }, submitted: { label: 'Подана', color: 'info' },
      approved: { label: 'Одобрена', color: 'success' }, rejected: { label: 'Отклонена', color: 'danger' },
      ordered: { label: 'Заказано', color: 'info' }, delivered: { label: 'Доставлено', color: 'success' },
      closed: { label: 'Закрыта', color: 'neutral' },
    };
    var PRIORITY_MAP = {
      low: { label: 'Низкий', color: 'neutral' }, normal: { label: 'Обычный', color: 'info' },
      high: { label: 'Высокий', color: 'warning' }, urgent: { label: 'Срочный', color: 'danger' },
    };
    var items = [];

    var page = M.TablePage({
      title: 'Заявки ТМЦ', subtitle: 'СКЛАД ЩИТОВ', back: true, backHref: '/home',
      items: [], search: true,
      filter: {
        pills: [
          { label: 'Все', value: 'all', active: true }, { label: 'Подана', value: 'submitted' },
          { label: 'Одобрена', value: 'approved' }, { label: 'Заказано', value: 'ordered' }, { label: 'Доставлено', value: 'delivered' },
        ],
        filterFn: function (item, val) { return val === 'all' || item.status === val; },
      },
      renderItem: function (item) {
        var st = STATUS_MAP[item.status] || STATUS_MAP.draft;
        var pr = PRIORITY_MAP[item.priority] || PRIORITY_MAP.normal;
        var fields = [];
        if (item.work_title) fields.push({ label: 'Проект', value: item.work_title });
        if (item.total_sum) fields.push({ label: 'Сумма', value: Utils.formatMoney(item.total_sum) });
        if (item.priority && item.priority !== 'normal') fields.push({ label: 'Приоритет', value: pr.label });
        return M.Card({
          title: item.title || 'Заявка #' + item.id, badge: st.label, badgeColor: st.color, fields: fields,
          time: item.created_at ? Utils.relativeTime(item.created_at) : undefined,
          onClick: function () { openDetail(item); },
        });
      },
      empty: M.Empty({ text: 'Нет заявок на ТМЦ', icon: '📦' }),
      fab: { icon: '+', onClick: function () { openCreateForm(); } },
      onRefresh: function () {
        return API.fetch('/tmc-requests', { noCache: true }).then(function (resp) {
          items = API.extractRows(resp);
          return items;
        }).catch(function (e) { M.Toast({ message: 'Ошибка загрузки', type: 'error' }); return []; });
      },
    });
    var listEl = page.querySelector('.asgard-table-page__list');
    if (listEl) listEl.replaceChildren(M.Skeleton({ type: 'card', count: 5 }));
    setTimeout(function () { window.dispatchEvent(new Event('asgard:refresh')); }, 0);

    function openDetail(item) {
      var st = STATUS_MAP[item.status] || STATUS_MAP.draft;
      var pr = PRIORITY_MAP[item.priority] || PRIORITY_MAP.normal;
      var itemsList = Array.isArray(item.items_json) ? item.items_json : [];
      var fields = [
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'Проект', value: item.work_title || '—' },
        { label: 'Приоритет', value: pr.label },
      ];
      if (item.total_sum) fields.push({ label: 'Сумма', value: Utils.formatMoney(item.total_sum) });
      if (item.comment) fields.push({ label: 'Комментарий', value: item.comment });
      var content = el('div');
      content.appendChild(M.DetailFields({ fields: fields }));
      if (itemsList.length) {
        content.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.textSec, marginTop: '16px', marginBottom: '8px' }) }, 'Состав заявки (' + itemsList.length + ')'));
        itemsList.forEach(function (row) {
          var r = el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid ' + t.border } });
          r.appendChild(el('span', { style: Object.assign({}, DS.font('sm'), { color: t.text, flex: 1 }) }, row.name || row.title || '—'));
          r.appendChild(el('span', { style: Object.assign({}, DS.font('sm'), { color: t.textSec, flexShrink: 0 }) }, (row.quantity || '—') + ' ' + (row.unit || 'шт')));
          content.appendChild(r);
        });
      }
      var btns = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } });
      btns.appendChild(M.FullWidthBtn({ label: '📥 Excel', variant: 'secondary', onClick: function () { window.open(API.BASE + '/tmc-requests/export?id=' + item.id + '&token=' + API.getToken(), '_blank'); } }));
      content.appendChild(btns);
      M.BottomSheet({ title: item.title || 'Заявка ТМЦ', content: content, fullscreen: true });
    }

    function openCreateForm() {
      var content = el('div');
      content.appendChild(M.Form({
        fields: [
          { id: 'title', label: 'Название', required: true },
          { id: 'work_title', label: 'Проект / Работа' },
          { id: 'priority', label: 'Приоритет', type: 'select', options: [
            { value: 'normal', label: 'Обычный' }, { value: 'high', label: 'Высокий' },
            { value: 'urgent', label: 'Срочный' }, { value: 'low', label: 'Низкий' },
          ], value: 'normal' },
          { id: 'comment', label: 'Комментарий', type: 'textarea' },
        ],
        submitLabel: 'Создать заявку',
        onSubmit: function (data) {
          API.fetch('/tmc-requests', { method: 'POST', body: data })
            .then(function () { M.Toast({ message: 'Заявка создана', type: 'success' }); })
            .catch(function (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); });
        },
      }));
      M.BottomSheet({ title: 'Новая заявка ТМЦ', content: content, fullscreen: true });
    }
    return page;
  },
};
Router.register('/tmc-requests', TmcRequestsPage);
if (typeof window !== 'undefined') window.TmcRequestsPage = TmcRequestsPage;
