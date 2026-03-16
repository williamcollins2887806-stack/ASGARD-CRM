window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.gantt_mini = {
  name: 'Ближайшие дедлайны', icon: '⏰', size: 'normal', roles: ['ADMIN','PM','HEAD_PM','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'list', count: 3 }));
    _load();
    function _load() {
      API.fetchCached('works', '/works').then(function (all) {
        var now = new Date();
        var upcoming = (all || []).filter(function (w) {
          if (!w.end_plan) return false;
          if (['Работы сдали','Завершена','Закрыт'].indexOf(w.work_status) !== -1) return false;
          return new Date(w.end_plan) >= now;
        }).sort(function (a, b) { return new Date(a.end_plan) - new Date(b.end_plan); }).slice(0, 5);
        if (!upcoming.length) { container.replaceChildren(M.Empty({ text: 'Нет дедлайнов', icon: '✅' })); return; }
        var list = el('div');
        upcoming.forEach(function (w, i) {
          var days = Math.ceil((new Date(w.end_plan) - now) / 86400000);
          var color = days <= 3 ? t.red : days <= 7 ? t.orange : t.blue;
          var row = el('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', padding: '10px 0', borderBottom: i < upcoming.length - 1 ? '1px solid ' + t.border : 'none' } });
          var db = el('div', { style: { width: '50px', padding: '6px 4px', borderRadius: '8px', textAlign: 'center', background: color + '15', flexShrink: '0' } });
          db.appendChild(el('div', { style: { fontSize: '11px', fontWeight: '700', color: color } }, Utils.formatDate(w.end_plan, 'short')));
          row.appendChild(db);
          row.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.text, flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }) }, w.work_title || w.work_name || '#' + w.id));
          list.appendChild(row);
        });
        container.replaceChildren(list);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/gantt'); };
      }).catch(function (e) { console.error('[gantt_mini]', e); container.replaceChildren(M.Empty({ text: 'Нет данных' })); });
    }
  }
};
