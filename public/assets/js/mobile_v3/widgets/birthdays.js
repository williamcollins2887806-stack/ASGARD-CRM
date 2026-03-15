window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.birthdays = {
  name: 'Дни рождения', icon: '🎂', size: 'normal', roles: ['*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'list', count: 2 }));
    _load();
    function _load() {
      var p = (typeof AsgardDB !== 'undefined') ? AsgardDB.getAll('employees') : Promise.resolve([]);
      p.then(function (emps) {
        var today = new Date();
        var upcoming = (emps || []).filter(function (e) { return !!e.birth_date; }).map(function (e) {
          var bd = new Date(e.birth_date); var ty = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
          if (ty < today) ty.setFullYear(today.getFullYear() + 1);
          return { name: e.fio || e.full_name || e.name || '?', days: Math.ceil((ty - today) / 86400000), date: bd };
        }).filter(function (e) { return e.days <= 30; }).sort(function (a, b) { return a.days - b.days; }).slice(0, 3);
        if (!upcoming.length) { container.replaceChildren(M.Empty({ text: 'Нет ДР в ближайшие 30 дней', icon: '🎂' })); return; }
        var scroll = el('div', { className: 'asgard-no-scrollbar', style: { display: 'flex', gap: '12px', overflowX: 'auto' } });
        upcoming.forEach(function (b) {
          var dateStr = b.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
          var card = el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '14px 16px', background: t.surface, borderRadius: '16px', border: '1px solid ' + t.border, minWidth: '100px', textAlign: 'center' } });
          card.appendChild(M.Avatar({ name: b.name, size: 40 }));
          card.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.text, fontWeight: '600' }) }, b.name.split(' ')[0]));
          card.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.textSec }) }, dateStr));
          card.appendChild(el('div', { style: { fontSize: '18px' } }, b.days === 0 ? '🎉' : '🎂'));
          scroll.appendChild(card);
        });
        container.replaceChildren(scroll);
      }).catch(function (e) { console.error('[birthdays]', e); container.replaceChildren(M.Empty({ text: 'Ошибка', icon: '⚠️' })); });
    }
  }
};
