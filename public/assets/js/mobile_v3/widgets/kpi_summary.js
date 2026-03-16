window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.kpi_summary = {
  name: 'KPI сводка', icon: '🎯', size: 'wide', roles: ['ADMIN','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'stats', count: 1 }));
    _load();
    function _load() {
      Promise.all([
        API.fetchCached('tenders', '/data/tenders'),
        API.fetchCached('works', '/works'),
        API.fetchCached('estimates', '/data/estimates')
      ]).then(function (res) {
        var y = new Date().getFullYear();
        var tenders = (res[0] || []).filter(function (x) { return String(x.year) === String(y) || (x.period || '').indexOf(String(y)) === 0; });
        var works = (res[1] || []).filter(function (w) { return ['Завершена','Работы сдали','Закрыт'].indexOf(w.work_status) === -1; });
        var margins = (res[2] || []).filter(function (e) { return e.margin_percent; }).map(function (e) { return Number(e.margin_percent) || 0; });
        var avgMargin = margins.length ? Math.round(margins.reduce(function (a, b) { return a + b; }, 0) / margins.length) : 0;
        container.replaceChildren(M.Stats({ items: [
          { svgIcon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/></svg>', value: tenders.length, label: 'Тендеров', color: t.blue },
          { svgIcon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>', value: works.length, label: 'В работе', color: t.green },
          { svgIcon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>', value: avgMargin + '%', label: 'Ср. маржа', color: t.gold },
          { svgIcon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', value: (res[2] || []).length, label: 'Просчётов', color: t.orange }
        ] }));
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/tenders'); };
      }).catch(function (e) { console.error('[kpi_summary]', e); container.replaceChildren(M.Empty({ text: 'Нет данных' })); });
    }
  }
};
