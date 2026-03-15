window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.equipment_alerts = {
  name: 'Оборудование • Алерты', icon: '🛠', size: 'normal', roles: ['ADMIN','CHIEF_ENGINEER','WAREHOUSE','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'list', count: 2 }));
    _load();
    function _load() {
      API.fetch('/equipment/maintenance/upcoming').then(function (data) {
        var items = (data && data.items) || (Array.isArray(data) ? data : []);
        if (!items.length) { container.replaceChildren(M.Empty({ text: 'Нет алертов', icon: '✅' })); return; }
        var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
        items.slice(0, 3).forEach(function (e) {
          var row = el('div', { style: { display: 'flex', gap: '10px', padding: '10px 14px', background: t.surface, borderRadius: '12px', border: '1px solid ' + t.border, alignItems: 'center' } });
          row.appendChild(el('div', { style: { fontSize: '18px', flexShrink: '0' } }, '⚠️'));
          var info = el('div', { style: { flex: '1' } });
          info.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { fontWeight: '600', color: t.text }) }, e.equipment_name || e.name || '—'));
          info.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.orange }) }, e.alert || e.description || 'Требуется ТО'));
          row.appendChild(info);
          list.appendChild(row);
        });
        container.replaceChildren(list);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/warehouse'); };
      }).catch(function () {
        container.replaceChildren(M.Empty({ text: 'Нет данных', icon: '🛠' }));
      });
    }
  }
};
