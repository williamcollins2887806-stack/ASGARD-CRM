window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.my_works = {
  name: 'Мои работы', icon: '🔧', size: 'normal', roles: ['PM','HEAD_PM'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'card', count: 2 }));
    _load();
    function _fetch() {
      if (typeof AsgardDB !== 'undefined') {
        return AsgardDB.getAll('works').then(function (data) {
          if (data && data.length) return data;
          return _api();
        }).catch(function () { return _api(); });
      }
      return _api();
    }
    function _api() {
      return API.fetch('/works').then(function (d) { return Array.isArray(d) ? d : (d && d.items ? d.items : d && d.data ? d.data : []); });
    }
    function _load() {
      _fetch().then(function (all) {
        var works = (all || []).filter(function (w) {
          return w.pm_id === user.id && ['Завершена','Работы сдали','Закрыт'].indexOf(w.work_status) === -1;
        }).slice(0, 5);
        if (!works.length) { container.replaceChildren(M.Empty({ text: 'Нет активных работ', icon: '🔧' })); return; }
        var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
        works.forEach(function (w) {
          var statusMap = { 'В работе': 'info', 'Подготовка': 'warning', 'Согласование': 'gold' };
          var card = M.Card({ title: w.work_title || w.work_name || 'Работа #' + w.id, badge: w.work_status || '—', badgeColor: statusMap[w.work_status] || 'neutral', fields: w.customer_name ? [{ label: 'Объект', value: w.customer_name }] : [] });
          var pct = Number(w.progress) || 0;
          if (pct > 0) { var pb = el('div', { style: { padding: '8px 0 0' } }); pb.appendChild(M.ProgressBar({ value: pct, label: pct + '%' })); card.appendChild(pb); }
          list.appendChild(card);
        });
        container.replaceChildren(list);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/pm-works'); };
      }).catch(function (e) { console.error('[my_works]', e); container.replaceChildren(M.Empty({ text: 'Ошибка загрузки', icon: '⚠️' })); });
    }
  }
};
