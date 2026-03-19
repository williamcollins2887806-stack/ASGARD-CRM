window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.overdue_works = {
  name: 'Просроченные работы', icon: '⚠️', size: 'wide', roles: ['ADMIN','PM','HEAD_PM','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'card', count: 2 }));
    _load();
    function _load() {
      API.fetchCached('works', '/works').then(function (all) {
        var now = new Date();
        var overdue = (all || []).filter(function (w) {
          if (!w.end_plan) return false;
          if (['Работы сдали','Завершена','Закрыт'].indexOf(w.work_status) !== -1) return false;
          return new Date(w.end_plan) < now;
        }).sort(function (a, b) { return new Date(a.end_plan) - new Date(b.end_plan); }).slice(0, 3);
        if (!overdue.length) {
          var ok = el('div', { style: { textAlign: 'center', padding: '8px 0' } });
          ok.appendChild(el('div', { style: { fontSize: '28px', marginBottom: '4px' } }, '✅'));
          ok.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.green, fontWeight: '600' }) }, 'Всё в срок'));
          container.replaceChildren(ok); return;
        }
        var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
        overdue.forEach(function (w) {
          var days = Math.round((now - new Date(w.end_plan)) / 86400000);
          list.appendChild(M.Card({ title: w.work_title || 'Работа #' + w.id, badge: 'Просрочено ' + days + ' дн', badgeColor: 'danger', fields: w.customer_name ? [{ label: 'Объект', value: w.customer_name }] : [] }));
        });
        container.replaceChildren(list);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/all-works'); };
      }).catch(function (e) { console.error('[overdue_works]', e); container.replaceChildren(M.Empty({ text: 'Нет данных' })); });
    }
  }
};
