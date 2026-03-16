window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.bank_summary = {
  name: 'Банковская сводка', icon: '🏦', size: 'normal', roles: ['ADMIN','BUH','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'card', count: 1 }));
    _load();
    function _load() {
      API.fetch('/integrations/bank/stats').then(function (data) {
        var wrap = el('div');
        var balance = (data && data.balance) || 0;
        wrap.appendChild(M.BigNumber({ value: balance, suffix: ' ₽', label: 'Расчётный счёт', icon: '🏦' }));
        // Show income/expense summary
        var income = (data && data.total_income) || 0;
        var expense = (data && data.total_expense) || 0;
        var unclass = (data && data.unclassified_count) || 0;
        if (income || expense) {
          var stats = el('div', { style: { display: 'flex', gap: '12px', marginTop: '10px' } });
          if (income) {
            stats.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.green }) }, '↑ ' + Utils.formatMoney(income, { short: true })));
          }
          if (expense) {
            stats.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.red }) }, '↓ ' + Utils.formatMoney(expense, { short: true })));
          }
          if (unclass > 0) {
            stats.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.orange }) }, unclass + ' не разнесено'));
          }
          wrap.appendChild(stats);
        }
        container.replaceChildren(wrap);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/integrations'); };
      }).catch(function () {
        container.replaceChildren(M.BigNumber({ value: 0, suffix: ' ₽', label: 'Расчётный счёт', icon: '🏦' }));
      });
    }
  }
};
