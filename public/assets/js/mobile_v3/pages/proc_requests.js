/**
 * ASGARD CRM — Mobile v3 / Заявки закупок
 * Окно 3, Сессия 8 — FIX: async skeleton
 */
var ProcRequestsPage = {
  render: function () {
    var t = DS.t;
    var el = Utils.el;
    var STATUS_MAP = {
      sent: { label: 'Отправлена', color: 'info' }, answered: { label: 'Ответ', color: 'gold' },
      approved: { label: 'Одобрена', color: 'success' }, rework: { label: 'Доработка', color: 'warning' },
      draft: { label: 'Черновик', color: 'neutral' }, ordered: { label: 'Заказано', color: 'info' },
      closed: { label: 'Закрыта', color: 'neutral' },
    };
    var items = [];
    var users = [];
    var userMap = new Map();

    var page = M.TablePage({
      title: 'Закупки', subtitle: 'СКЛАД ЩИТОВ', back: true, backHref: '/home',
      items: [], search: true,
      filter: {
        pills: [
          { label: 'Все', value: 'all', active: true }, { label: 'Отправлена', value: 'sent' },
          { label: 'Ответ', value: 'answered' }, { label: 'Одобрена', value: 'approved' }, { label: 'Доработка', value: 'rework' },
        ],
        filterFn: function (item, val) { return val === 'all' || item.status === val; },
      },
      renderItem: function (item) {
        var st = STATUS_MAP[item.status] || STATUS_MAP.draft;
        var fields = [];
        if (item.pm_id) fields.push({ label: 'РП', value: userMap.get(item.pm_id) || '—' });
        if (item.work_title) fields.push({ label: 'Работа', value: item.work_title });
        if (item.total_sum) fields.push({ label: 'Сумма', value: Utils.formatMoney(item.total_sum) });
        var composition = [];
        try { var parsed = typeof item.items_json === 'string' ? JSON.parse(item.items_json) : item.items_json; if (Array.isArray(parsed)) composition = parsed; } catch (_) {}
        return M.Card({
          title: item.work_title || item.title || 'Заявка #' + item.id,
          subtitle: composition.length ? composition.length + ' позиций' : undefined,
          badge: st.label, badgeColor: st.color, fields: fields,
          time: item.created_at ? Utils.relativeTime(item.created_at) : undefined,
          onClick: function () { openDetail(item); },
        });
      },
      empty: M.Empty({ text: 'Нет заявок на закупку', icon: '🛒' }),
      fab: { icon: '+', onClick: function () { M.Toast({ message: 'Создание закупок — с десктопа', type: 'info' }); } },
      onRefresh: function () {
        return Promise.all([
          API.fetch('/procurement-requests', { noCache: true }).catch(function () { return API.fetch('/proc-requests', { noCache: true }).catch(function () { return { items: [] }; }); }),
          API.fetch('/users').catch(function () { return []; }),
        ]).then(function (results) {
          var resp = results[0];
          items = resp.items || resp.data || (Array.isArray(resp) ? resp : []);
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
        { label: 'РП', value: item.pm_id ? userMap.get(item.pm_id) : '—' },
        { label: 'Работа', value: item.work_title || '—' },
      ];
      if (item.total_sum) fields.push({ label: 'Сумма', value: Utils.formatMoney(item.total_sum) });
      if (item.comment) fields.push({ label: 'Комментарий', value: item.comment });
      var composition = [];
      try { var parsed = typeof item.items_json === 'string' ? JSON.parse(item.items_json) : item.items_json; if (Array.isArray(parsed)) composition = parsed; } catch (_) {}
      var content = el('div');
      content.appendChild(M.DetailFields({ fields: fields }));
      if (composition.length) {
        content.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.textSec, marginTop: '16px', marginBottom: '8px' }) }, 'Состав (' + composition.length + ')'));
        composition.forEach(function (row) {
          var r = el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid ' + t.border } });
          r.appendChild(el('span', { style: Object.assign({}, DS.font('sm'), { color: t.text, flex: 1 }) }, row.name || row.title || '—'));
          r.appendChild(el('span', { style: Object.assign({}, DS.font('sm'), { color: t.textSec, flexShrink: 0 }) }, (row.quantity || '') + ' ' + (row.unit || '')));
          content.appendChild(r);
        });
      }
      M.BottomSheet({ title: 'Закупка #' + item.id, content: content, fullscreen: true });
    }
    return page;
  },
};
Router.register('/proc-requests', ProcRequestsPage);
if (typeof window !== 'undefined') window.ProcRequestsPage = ProcRequestsPage;
