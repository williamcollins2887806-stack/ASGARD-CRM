window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.payroll_pending = {
  name: 'Ведомости (ожидание)', icon: '📋', size: 'normal', roles: ['ADMIN','BUH','PM','HEAD_PM','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'card', count: 1 }));
    _load();
    function _load() {
      Promise.all([
        API.fetchCached('payroll_sheets', '/payroll/sheets'),
        API.fetchCached('one_time_payments', '/data/users')
      ]).then(function (res) {
        var sheets = (res[0] || []).filter(function (x) { return x.status === 'pending'; });
        var payments = (res[1] || []).filter(function (x) { return x.status === 'pending'; });
        var count = sheets.length + payments.length;
        var totalSum = sheets.concat(payments).reduce(function (s, x) { return s + (Number(x.total) || Number(x.amount) || 0); }, 0);
        var wrap = el('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } });
        wrap.appendChild(el('div', { style: { fontSize: '36px', fontWeight: '900', color: count ? t.orange : t.green } }, '' + count));
        var info = el('div', { style: { flex: '1' } });
        info.appendChild(el('div', { style: Object.assign({}, DS.font('md'), { color: t.text }) }, count ? 'На согласовании' : 'Нет ожидающих'));
        if (totalSum > 0) info.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.textSec }) }, 'Сумма: ' + Utils.formatMoney(totalSum)));
        wrap.appendChild(info);
        container.replaceChildren(wrap);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/payroll'); };
      }).catch(function (e) { console.error('[payroll_pending]', e); container.replaceChildren(M.Empty({ text: 'Нет данных' })); });
    }
  }
};
