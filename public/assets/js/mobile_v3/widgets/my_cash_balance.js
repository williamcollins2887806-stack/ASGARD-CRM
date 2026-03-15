window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.my_cash_balance = {
  name: 'Мои подотчётные', icon: '💼', size: 'normal', roles: ['*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'card', count: 1 }));
    _load();
    function _load() {
      API.fetch('/cash/my-balance').then(function (data) {
        var onHand = (data && data.on_hand) || 0;
        var spent = (data && data.spent) || 0;
        var activeCount = (data && data.active_count) || 0;
        var grid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', textAlign: 'center' } });
        [{ val: Utils.formatMoney(onHand, { short: true }).replace(' ₽', ''), lbl: 'На руках', cl: t.blue },
         { val: Utils.formatMoney(spent, { short: true }).replace(' ₽', ''), lbl: 'Потрачено', cl: t.orange },
         { val: '' + activeCount, lbl: 'Активных', cl: t.green }
        ].forEach(function (a) {
          var cell = el('div');
          cell.appendChild(el('div', { style: Object.assign({}, DS.font('md'), { color: a.cl, fontWeight: '700' }) }, a.val));
          cell.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.textSec, marginTop: '2px' }) }, a.lbl));
          grid.appendChild(cell);
        });
        container.replaceChildren(grid);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/cash'); };
      }).catch(function () {
        container.replaceChildren(M.Empty({ text: 'Нет данных', icon: '💼' }));
      });
    }
  }
};
