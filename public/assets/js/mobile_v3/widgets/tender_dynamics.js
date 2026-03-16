window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.tender_dynamics = {
  name: 'Динамика тендеров', icon: '📈', size: 'wide', roles: ['ADMIN','TO','HEAD_TO','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'stats', count: 1 }));
    _load();
    function _fetch() {
      if (typeof AsgardDB !== 'undefined') {
        return AsgardDB.getAll('tenders').then(function (data) {
          if (data && data.length) return data;
          return _api();
        }).catch(function () { return _api(); });
      }
      return _api();
    }
    function _api() {
      return API.fetch('/data/tenders').then(function (d) { return Array.isArray(d) ? d : (d && d.items ? d.items : d && d.data ? d.data : []); });
    }
    function _load() {
      _fetch().then(function (all) {
        var y = new Date().getFullYear();
        var months = [0,0,0,0,0,0,0,0,0,0,0,0];
        (all || []).forEach(function (x) {
          var d = x.created_at ? new Date(x.created_at) : null;
          if (d && d.getFullYear() === y) months[d.getMonth()]++;
        });
        var wrap = el('div');
        wrap.appendChild(M.MiniChart({ data: months }));
        var labels = el('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '4px' } });
        ['Я','Ф','М','А','М','И','И','А','С','О','Н','Д'].forEach(function (m) { labels.appendChild(el('span', { style: Object.assign({}, DS.font('xs'), { color: t.textTer }) }, m)); });
        wrap.appendChild(labels);
        container.replaceChildren(wrap);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/to-analytics'); };
      }).catch(function (e) { console.error('[tender_dynamics]', e); container.replaceChildren(M.Empty({ text: 'Нет данных' })); });
    }
  }
};
