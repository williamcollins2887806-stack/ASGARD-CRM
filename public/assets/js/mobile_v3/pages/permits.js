/**
 * ASGARD CRM — Mobile v3 / Допуски и удостоверения
 * Окно 3, Сессия 8 — FIX: async skeleton, Toast in catch
 */
var PermitsPage = {
  render: function () {
    var t = DS.t;
    var el = Utils.el;
    var empMap = new Map();

    function getPermitStatus(item) {
      if (!item.valid_to) return { label: 'Без срока', color: 'neutral' };
      var daysLeft = Math.ceil((new Date(item.valid_to) - new Date()) / 86400000);
      if (daysLeft < 0) return { label: 'Просрочен', color: 'danger' };
      if (daysLeft <= 30) return { label: 'Истекает (' + daysLeft + ' дн)', color: 'warning' };
      return { label: 'Действует', color: 'success' };
    }

    var page = M.TablePage({
      title: 'Допуски', subtitle: 'УДОСТОВЕРЕНИЯ', back: true, backHref: '/home',
      items: [], search: true,
      filter: {
        pills: [
          { label: 'Все', value: 'all', active: true }, { label: 'Действует', value: 'valid' },
          { label: 'Истекает', value: 'expiring' }, { label: 'Просрочен', value: 'expired' },
        ],
        filterFn: function (item, val) {
          if (val === 'all') return true;
          var st = getPermitStatus(item);
          if (val === 'valid') return st.color === 'success';
          if (val === 'expiring') return st.color === 'warning';
          if (val === 'expired') return st.color === 'danger';
          return true;
        },
      },
      renderItem: function (permit) {
        var st = getPermitStatus(permit);
        var fields = [];
        if (permit.employee_id) fields.push({ label: 'Сотрудник', value: empMap.get(permit.employee_id) || '—' });
        if (permit.valid_from) fields.push({ label: 'С', value: Utils.formatDate(permit.valid_from) });
        if (permit.valid_to) fields.push({ label: 'До', value: Utils.formatDate(permit.valid_to) });
        if (permit.number) fields.push({ label: '№', value: permit.number });
        return M.Card({
          title: permit.permit_type || permit.type_name || permit.title || 'Допуск #' + permit.id,
          subtitle: permit.employee_id ? empMap.get(permit.employee_id) : undefined,
          badge: st.label, badgeColor: st.color, fields: fields,
          onClick: function () { openDetail(permit); },
        });
      },
      empty: M.Empty({ text: 'Нет допусков', icon: '🛡' }),
      onRefresh: function () {
        return Promise.all([
          API.fetch('/permits', { noCache: true }),
          API.fetch('/staff/employees?limit=1000').catch(function () { return []; }),
        ]).then(function (results) {
          var permits = API.extractRows(results[0]);
          var employees = API.extractRows(results[1]);
          empMap = new Map(employees.map(function (e) { return [e.id, e.fio || e.name || '—']; }));
          return permits;
        }).catch(function (e) { M.Toast({ message: 'Ошибка загрузки допусков', type: 'error' }); return []; });
      },
    });
    var listEl = page.querySelector('.asgard-table-page__list');
    if (listEl) listEl.replaceChildren(M.Skeleton({ type: 'card', count: 5 }));
    setTimeout(function () { window.dispatchEvent(new Event('asgard:refresh')); }, 0);

    function openDetail(permit) {
      var st = getPermitStatus(permit);
      var fields = [
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'Тип', value: permit.permit_type || permit.type_name || '—' },
        { label: 'Сотрудник', value: permit.employee_id ? empMap.get(permit.employee_id) : '—' },
        { label: 'Номер', value: permit.number || '—', copy: true },
      ];
      if (permit.valid_from) fields.push({ label: 'Действует с', value: Utils.formatDate(permit.valid_from) });
      if (permit.valid_to) fields.push({ label: 'Действует до', value: Utils.formatDate(permit.valid_to) });
      if (permit.issuing_authority) fields.push({ label: 'Выдано', value: permit.issuing_authority });
      if (permit.work_title) fields.push({ label: 'Работа', value: permit.work_title });
      var content = el('div');
      content.appendChild(M.DetailFields({ fields: fields }));
      if (permit.scan_file) {
        var btns = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } });
        btns.appendChild(M.FullWidthBtn({ label: '📎 Скачать скан', variant: 'secondary', onClick: function () { window.open(API.BASE + '/files/download/' + permit.scan_file, '_blank'); } }));
        content.appendChild(btns);
      }
      if (permit.valid_to) {
        var start = permit.valid_from ? new Date(permit.valid_from) : new Date(new Date(permit.valid_to).getTime() - 365 * 86400000);
        var total = new Date(permit.valid_to) - start;
        var elapsed = new Date() - start;
        var pct = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
        var progWrap = el('div', { style: { marginTop: '16px' } });
        progWrap.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.textSec, marginBottom: '4px' }) }, 'Срок действия'));
        progWrap.appendChild(M.ProgressBar({ value: pct, label: pct + '%' }));
        content.appendChild(progWrap);
      }
      M.BottomSheet({ title: permit.permit_type || 'Допуск', content: content, fullscreen: true });
    }
    return page;
  },
};
Router.register('/permits', PermitsPage);
if (typeof window !== 'undefined') window.PermitsPage = PermitsPage;
