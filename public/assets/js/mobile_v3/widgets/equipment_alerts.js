window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.equipment_alerts = {
  name: 'Оборудование • Алерты', icon: '🛠', size: 'normal', roles: ['ADMIN','CHIEF_ENGINEER','WAREHOUSE','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'list', count: 2 }));
    _load();
    function _load() {
      API.fetch('/equipment/maintenance/upcoming').then(function (data) {
        var items = API.extractRows(data);
        if (!items.length) { container.replaceChildren(M.Empty({ text: 'Нет алертов' })); return; }
        var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
        items.slice(0, 3).forEach(function (e) {
          var row = el('div', { style: { display: 'flex', gap: '10px', padding: '10px 14px', background: 'var(--bg3, ' + t.surfaceAlt + ')', borderRadius: '10px', alignItems: 'center' } });
          var alertIcon = el('div', { style: { width: '24px', height: '24px', color: t.orange, flexShrink: '0' } });
          alertIcon.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
          row.appendChild(alertIcon);
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
