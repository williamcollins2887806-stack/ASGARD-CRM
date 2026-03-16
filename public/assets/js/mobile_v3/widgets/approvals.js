window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.approvals = {
  name: 'Согласования', icon: '✍️', size: 'normal', roles: ['ADMIN','HEAD_PM','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'card', count: 1 }));
    _load();
    function _dbOrApi(table, apiPath) {
      if (typeof AsgardDB !== 'undefined') {
        return AsgardDB.getAll(table).then(function (data) {
          if (data && data.length) return data;
          return API.fetch(apiPath).then(function (d) { return Array.isArray(d) ? d : (d && d.items ? d.items : d && d.data ? d.data : []); });
        }).catch(function () {
          return API.fetch(apiPath).then(function (d) { return Array.isArray(d) ? d : (d && d.items ? d.items : d && d.data ? d.data : []); });
        });
      }
      return API.fetch(apiPath).then(function (d) { return Array.isArray(d) ? d : (d && d.items ? d.items : d && d.data ? d.data : []); });
    }
    function _load() {
      Promise.all([
        _dbOrApi('bonus_requests', '/data/bonus-requests'),
        _dbOrApi('estimates', '/data/estimates')
      ]).then(function (res) {
        var bonus = (res[0] || []).filter(function (x) { return x.status === 'pending'; });
        var ests = (res[1] || []).filter(function (x) { return x.status === 'sent' || x.status === 'pending'; });
        var pending = bonus.concat(ests).slice(0, 3);
        var wrap = el('div');
        var badge = el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: pending.length ? '10px' : '0' } });
        badge.appendChild(el('div', { style: { fontSize: '36px', fontWeight: '900', color: pending.length ? t.orange : t.green } }, '' + pending.length));
        badge.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.textSec }) }, pending.length ? 'Ожидают решения' : 'Всё согласовано'));
        wrap.appendChild(badge);
        if (pending.length) {
          var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
          pending.forEach(function (p) { list.appendChild(M.Card({ title: p.title || p.name || 'Заявка #' + p.id, badge: 'Ожидает', badgeColor: 'warning', fields: p.amount ? [{ label: 'Сумма', value: Utils.formatMoney(p.amount) }] : [] })); });
          wrap.appendChild(list);
        }
        container.replaceChildren(wrap);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/approvals'); };
      }).catch(function (e) { console.error('[approvals]', e); container.replaceChildren(M.Empty({ text: 'Нет данных' })); });
    }
  }
};
