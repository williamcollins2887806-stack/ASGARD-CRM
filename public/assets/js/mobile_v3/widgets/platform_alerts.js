window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.platform_alerts = {
  name: 'Тендерные площадки', icon: '🏗', size: 'normal', roles: ['ADMIN','TO','HEAD_TO','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'card', count: 2 }));
    _load();
    function _load() {
      API.fetch('/integrations/platforms?limit=5').then(function (data) {
        var items = (data && data.items) || (Array.isArray(data) ? data : []);
        if (!items.length) { container.replaceChildren(M.Empty({ text: 'Нет новых тендеров' })); return; }
        var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
        items.slice(0, 3).forEach(function (tp) {
          var deadline = tp.submission_deadline ? new Date(tp.submission_deadline) : null;
          var daysLeft = deadline ? Math.max(0, Math.ceil((deadline - new Date()) / 86400000)) : 0;
          list.appendChild(M.Card({ title: tp.customer_name || tp.object_description || '—', subtitle: tp.platform_code || '', badge: deadline ? daysLeft + ' дн' : '', badgeColor: daysLeft <= 3 ? 'danger' : 'warning', fields: tp.nmck ? [{ label: 'НМЦК', value: Utils.formatMoney(tp.nmck, { short: true }) }] : [] }));
        });
        container.replaceChildren(list);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/integrations'); };
      }).catch(function () {
        container.replaceChildren(M.Empty({ text: 'Нет данных', icon: '🏗' }));
      });
    }
  }
};
