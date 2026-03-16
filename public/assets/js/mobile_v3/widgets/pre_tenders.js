window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.pre_tenders = {
  name: 'Заявки', icon: '🤖', size: 'normal', roles: ['ADMIN','HEAD_TO','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'card', count: 2 }));
    _load();
    function _fetch() {
      if (typeof AsgardDB !== 'undefined') {
        return AsgardDB.getAll('pre_tender_requests').then(function (data) {
          if (data && data.length) return data;
          return _api();
        }).catch(function () { return _api(); });
      }
      return _api();
    }
    function _api() {
      return API.fetch('/data/pre-tenders').then(function (d) { return Array.isArray(d) ? d : (d && d.items ? d.items : d && d.data ? d.data : []); });
    }
    function _load() {
      _fetch().then(function (all) {
        var items = (all || []).filter(function (x) { return x.status === 'new' || x.status === 'in_review'; }).slice(0, 3);
        if (!items.length) { container.replaceChildren(M.Empty({ text: 'Нет новых заявок', icon: '📨' })); return; }
        var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
        items.forEach(function (r) {
          var aiColor = 'neutral';
          if (r.ai_score >= 70) aiColor = 'success';
          else if (r.ai_score >= 40) aiColor = 'warning';
          else if (r.ai_score > 0) aiColor = 'danger';
          var aiLabel = r.ai_score >= 70 ? 'Высокий шанс' : r.ai_score >= 40 ? 'Средний шанс' : r.ai_score > 0 ? 'Низкий шанс' : r.status;
          list.appendChild(M.Card({ title: r.customer_name || r.title || 'Заявка #' + r.id, badge: aiLabel, badgeColor: aiColor, fields: r.nmck ? [{ label: 'НМЦК', value: Utils.formatMoney(r.nmck, { short: true }) }] : [] }));
        });
        container.replaceChildren(list);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/pre-tenders'); };
      }).catch(function (e) { console.error('[pre_tenders]', e); container.replaceChildren(M.Empty({ text: 'Нет данных' })); });
    }
  }
};
