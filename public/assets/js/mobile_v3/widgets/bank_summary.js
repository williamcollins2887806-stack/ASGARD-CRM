window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.bank_summary = {
  name: 'Банковская сводка', icon: '🏦', size: 'normal', roles: ['ADMIN','BUH','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'card', count: 1 }));
    _load();
    function _load() {
      API.fetch('/integrations/bank/summary').then(function (data) {
        var wrap = el('div');
        wrap.appendChild(M.BigNumber({ value: (data && data.balance) || 0, suffix: ' ₽', label: 'Расчётный счёт', icon: '🏦' }));
        var ops = (data && data.recent_operations) || [];
        if (ops.length) {
          var list = el('div', { style: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' } });
          ops.slice(0, 3).forEach(function (op) {
            var row = el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '4px 0' } });
            row.appendChild(el('span', { style: Object.assign({}, DS.font('xs'), { color: t.textSec, flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }) }, op.description || op.counterparty || '—'));
            var isIncome = Number(op.amount) > 0;
            row.appendChild(el('span', { style: Object.assign({}, DS.font('xs'), { color: isIncome ? t.green : t.red, fontWeight: '600', flexShrink: '0', marginLeft: '8px' }) }, (isIncome ? '+' : '') + Utils.formatMoney(op.amount, { short: true })));
            list.appendChild(row);
          });
          wrap.appendChild(list);
        }
        container.replaceChildren(wrap);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/buh-registry'); };
      }).catch(function () {
        container.replaceChildren(M.BigNumber({ value: 0, suffix: ' ₽', label: 'Расчётный счёт', icon: '🏦' }));
      });
    }
  }
};
