window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.money_summary = {
  name: 'Финансы', icon: '💰', size: 'normal', roles: ['ADMIN','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'hero', count: 1 }));
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
        _dbOrApi('works', '/works'),
        _dbOrApi('tenders', '/data/tenders')
      ]).then(function (res) {
        var works = res[0] || []; var tenders = res[1] || [];
        var y = new Date().getFullYear();
        var tIds = {}; tenders.filter(function (x) { return String(x.year) === String(y) || (x.period || '').indexOf(String(y)) === 0; }).forEach(function (x) { tIds[x.id] = true; });
        var yWorks = works.filter(function (x) { var d = x.start_fact || x.start_plan || x.created_at; if (d && new Date(d).getFullYear() === y) return true; if (x.tender_id && tIds[x.tender_id]) return true; return false; });
        var revenue = yWorks.reduce(function (s, x) { return s + (Number(x.contract_sum) || Number(x.contract_value) || 0); }, 0);
        var expenses = yWorks.reduce(function (s, x) { return s + (Number(x.total_cost) || Number(x.expenses) || 0); }, 0);
        var profit = revenue - expenses;
        var wrap = el('div');
        wrap.appendChild(M.HeroCard({ label: 'ФИНАНСЫ ' + y, value: Utils.formatMoney(revenue, { short: true }).replace(' ₽', ''), valueSuffix: ' ₽', details: [{ label: 'Расходы', value: Utils.formatMoney(expenses, { short: true }), color: t.orange }, { label: 'Прибыль', value: Utils.formatMoney(profit, { short: true }), color: profit >= 0 ? t.green : t.red }] }));
        container.replaceChildren(wrap);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/finances'); };
      }).catch(function (e) { console.error('[money_summary]', e); container.replaceChildren(M.Empty({ text: 'Нет данных' })); });
    }
  }
};
