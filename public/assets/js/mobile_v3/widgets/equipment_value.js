window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.equipment_value = {
  name: 'Стоимость ТМЦ', icon: '📦', size: 'normal', roles: ['ADMIN','CHIEF_ENGINEER','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'card', count: 1 }));
    _load();
    function _load() {
      API.fetch('/equipment/balance-value').then(function (data) {
        var wrap = el('div');
        wrap.appendChild(M.BigNumber({ value: Number((data && data.total_book_value) || 0), suffix: ' ₽', label: 'ТМЦ на балансе компании', icon: '📦' }));
        if (data && data.total_items) {
          var row = el('div', { style: { display: 'flex', gap: '10px', marginTop: '10px' } });
          row.appendChild(M.Badge({ text: data.total_items + ' ед.', color: 'info' }));
          if (data.expiring_soon && data.expiring_soon.count > 0) row.appendChild(M.Badge({ text: data.expiring_soon.count + ' истекает', color: 'warning' }));
          wrap.appendChild(row);
        }
        container.replaceChildren(wrap);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/warehouse'); };
      }).catch(function (e) { console.error('[equipment_value]', e); container.replaceChildren(M.Empty({ text: 'Нет данных', icon: '📦' })); });
    }
  }
};
