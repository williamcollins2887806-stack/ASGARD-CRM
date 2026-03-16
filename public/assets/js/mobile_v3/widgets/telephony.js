window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.telephony_status = {
  name: 'Телефония', icon: '📞', size: 'normal', roles: ['ADMIN','DIRECTOR_*','PM','HEAD_PM','TO','HEAD_TO','BUH'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'list', count: 1 }));
    function _render(data) {
      var row = el('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } });
      var iconWrap = el('div', { style: { width: '40px', height: '40px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0', color: t.green } });
      iconWrap.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
      iconWrap.style.background = 'color-mix(in srgb, ' + t.green + ' 12%, transparent)';
      row.appendChild(iconWrap);
      var info = el('div', { style: { flex: '1' } });
      var total = (data && data.total) || 0;
      var missed = (data && data.missed) || 0;
      var isOnline = !!data;
      info.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { fontWeight: '600', color: t.text }) }, 'Телефония'));
      info.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: isOnline ? t.green : t.textTer }) }, isOnline ? '● Подключена · ' + total + ' звонков' : '○ Нет данных'));
      row.appendChild(info);
      if (missed > 0) {
        row.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { padding: '4px 10px', borderRadius: '8px', background: 'color-mix(in srgb, ' + t.red + ' 12%, transparent)', color: t.red, fontWeight: '700', flexShrink: '0' }) }, '' + missed));
      }
      container.replaceChildren(row);
      container.style.cursor = 'pointer';
      container.onclick = function () { Router.navigate('/telephony'); };
    }
    API.fetch('/telephony/stats').then(function (data) {
      _render(data);
    }).catch(function () {
      _render(null);
    });
  }
};
