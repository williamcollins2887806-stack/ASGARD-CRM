/**
 * ASGARD CRM — Mobile Widget: Уведомления
 */
window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.notifications = {
  name: 'Уведомления', icon: '🔔', size: 'normal', roles: ['*'],
  render: function (container, user) {
    var el = Utils.el;
    var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'list', count: 3 }));
    _load();
    function _load() {
      API.fetchCached('notifications', '/notifications').then(function (all) {
        var items = (all || []).filter(function (x) { return !x.is_read; })
          .sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); })
          .slice(0, 5);
        if (!items.length) { container.replaceChildren(M.Empty({ text: 'Нет уведомлений', icon: '✅' })); return; }
        var wrap = el('div');
        var badge = el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' } });
        badge.appendChild(el('div', { style: { fontSize: '32px', fontWeight: '900', color: t.red } }, '' + items.length));
        badge.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.textSec }) }, 'непрочитанных'));
        wrap.appendChild(badge);
        var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
        items.forEach(function (n) {
          list.appendChild(M.NotificationCard({ title: n.title || 'Уведомление', text: (n.message || '').slice(0, 80), time: Utils.relativeTime(new Date(n.created_at || Date.now())), type: 'info' }));
        });
        wrap.appendChild(list);
        container.replaceChildren(wrap);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/alerts'); };
      }).catch(function (e) {
        console.error('[notifications]', e);
        container.replaceChildren(M.Empty({ text: 'Нет данных' }));
      });
    }
  }
};
