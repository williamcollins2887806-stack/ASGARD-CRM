window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.team_workload = {
  name: 'Загрузка РП', icon: '📊', size: 'wide', roles: ['ADMIN','HEAD_PM','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'stats', count: 1 }));
    _load();
    function _load() {
      Promise.all([
        API.fetchCached('works', '/works'),
        API.fetchCached('users', '/data/users')
      ]).then(function (res) {
        var active = (res[0] || []).filter(function (w) { return ['Завершена','Работы сдали','Закрыт'].indexOf(w.work_status) === -1; });
        var pmMap = {};
        active.forEach(function (w) { if (w.pm_id) pmMap[w.pm_id] = (pmMap[w.pm_id] || 0) + 1; });
        var userMap = {}; (res[1] || []).forEach(function (u) { userMap[u.id] = u.name || u.login || ''; });
        var stats = Object.keys(pmMap).map(function (id) { return { name: userMap[id] || 'PM #' + id, count: pmMap[id] }; })
          .sort(function (a, b) { return b.count - a.count; }).slice(0, 6);
        if (!stats.length) { container.replaceChildren(M.Empty({ text: 'Нет данных', icon: '📊' })); return; }
        var maxC = Math.max.apply(null, stats.map(function (s) { return s.count; }));
        var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
        stats.forEach(function (pm) {
          var row = el('div');
          var nameRow = el('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' } });
          nameRow.appendChild(el('span', { style: Object.assign({}, DS.font('sm'), { color: t.text }) }, pm.name.split(' ')[0]));
          nameRow.appendChild(el('span', { style: Object.assign({}, DS.font('sm'), { color: t.textSec }) }, pm.count + ' ' + Utils.plural(pm.count, 'работа', 'работы', 'работ')));
          row.appendChild(nameRow);
          row.appendChild(M.ProgressBar({ value: Math.round((pm.count / maxC) * 100), label: '' }));
          list.appendChild(row);
        });
        container.replaceChildren(list);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/pm-analytics'); };
      }).catch(function (e) { console.error('[team_workload]', e); container.replaceChildren(M.Empty({ text: 'Нет данных' })); });
    }
  }
};
