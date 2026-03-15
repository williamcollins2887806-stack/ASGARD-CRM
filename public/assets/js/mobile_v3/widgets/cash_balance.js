window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.cash_balance = {
  name: 'Баланс КАССА', icon: '💵', size: 'normal', roles: ['ADMIN','BUH','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'card', count: 1 }));
    _load();
    function _fetch() {
      if (typeof AsgardDB !== 'undefined') {
        return AsgardDB.getAll('cash_requests').then(function (data) {
          if (data && data.length) return data;
          return _apiRaw();
        }).catch(function () { return _apiRaw(); });
      }
      return _apiRaw();
    }
    function _apiRaw() {
      return API.fetch('/cash/balance').then(function (d) {
        if (d && typeof d.total !== 'undefined') return d;
        return { items: Array.isArray(d) ? d : (d && d.items ? d.items : []) };
      });
    }
    function _load() {
      _fetch().then(function (result) {
        var total, activeCount;
        if (Array.isArray(result)) {
          var active = result.filter(function (x) { return x.status !== 'closed' && x.status !== 'returned'; });
          total = active.reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0);
          activeCount = active.length;
        } else {
          total = Number(result.total) || 0;
          activeCount = (result.items || []).length || result.count || 0;
        }
        var wrap = el('div');
        wrap.appendChild(M.BigNumber({ value: total, suffix: ' ₽', label: 'Выдано из кассы', icon: '💵' }));
        if (activeCount) {
          wrap.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.textSec, marginTop: '8px', textAlign: 'center' }) }, activeCount + ' ' + Utils.plural(activeCount, 'заявка', 'заявки', 'заявок') + ' в обработке'));
        }
        container.replaceChildren(wrap);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/cash-admin'); };
      }).catch(function (e) { console.error('[cash_balance]', e); container.replaceChildren(M.Empty({ text: 'Ошибка загрузки', icon: '⚠️' })); });
    }
  }
};
