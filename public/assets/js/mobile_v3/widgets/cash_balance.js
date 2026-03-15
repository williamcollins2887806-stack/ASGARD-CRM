window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.cash_balance = {
  name: 'Баланс КАССА', icon: '💵', size: 'normal', roles: ['ADMIN','BUH','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'card', count: 1 }));
    _load();
    function _load() {
      var p = (typeof AsgardDB !== 'undefined') ? AsgardDB.getAll('cash_requests') : Promise.resolve([]);
      p.then(function (all) {
        var active = (all || []).filter(function (x) { return x.status !== 'closed' && x.status !== 'returned'; });
        var total = active.reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0);
        var wrap = el('div');
        wrap.appendChild(M.BigNumber({ value: total, suffix: ' ₽', label: 'Выдано из кассы', icon: '💵' }));
        if (active.length) {
          wrap.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.textSec, marginTop: '8px', textAlign: 'center' }) }, active.length + ' ' + Utils.plural(active.length, 'заявка', 'заявки', 'заявок') + ' в обработке'));
        }
        container.replaceChildren(wrap);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/cash-admin'); };
      }).catch(function (e) { console.error('[cash_balance]', e); container.replaceChildren(M.Empty({ text: 'Ошибка', icon: '⚠️' })); });
    }
  }
};
