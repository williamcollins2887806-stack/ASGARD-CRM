window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.kpi_summary = {
  name: 'KPI сводка', icon: '🎯', size: 'wide', roles: ['ADMIN','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'stats', count: 1 }));
    _load();
    function _load() {
      Promise.all([
        (typeof AsgardDB !== 'undefined') ? AsgardDB.getAll('tenders') : Promise.resolve([]),
        (typeof AsgardDB !== 'undefined') ? AsgardDB.getAll('works') : Promise.resolve([]),
        (typeof AsgardDB !== 'undefined') ? AsgardDB.getAll('estimates') : Promise.resolve([])
      ]).then(function (res) {
        var y = new Date().getFullYear();
        var tenders = (res[0] || []).filter(function (x) { return String(x.year) === String(y) || (x.period || '').indexOf(String(y)) === 0; });
        var works = (res[1] || []).filter(function (w) { return ['Завершена','Работы сдали','Закрыт'].indexOf(w.work_status) === -1; });
        var margins = (res[2] || []).filter(function (e) { return e.margin_percent; }).map(function (e) { return Number(e.margin_percent) || 0; });
        var avgMargin = margins.length ? Math.round(margins.reduce(function (a, b) { return a + b; }, 0) / margins.length) : 0;
        container.replaceChildren(M.Stats({ items: [
          { icon: '🎯', value: tenders.length, label: 'Тендеров', color: t.blue },
          { icon: '🏗', value: works.length, label: 'В работе', color: t.green },
          { icon: '💹', value: avgMargin + '%', label: 'Ср. маржа', color: t.gold },
          { icon: '⏱', value: (res[2] || []).length, label: 'Просчётов', color: t.orange }
        ] }));
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/analytics'); };
      }).catch(function (e) { console.error('[kpi_summary]', e); container.replaceChildren(M.Empty({ text: 'Ошибка', icon: '⚠️' })); });
    }
  }
};
