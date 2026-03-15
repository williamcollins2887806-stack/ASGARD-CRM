window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.telephony_status = {
  name: 'Телефония', icon: '📞', size: 'normal', roles: ['ADMIN','DIRECTOR_*','PM','HEAD_PM','TO','HEAD_TO','BUH'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'list', count: 1 }));
    _load();
    function _load() {
      API.fetch('/telephony/status').then(function (data) {
        var row = el('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } });
        row.appendChild(el('div', { style: { width: '48px', height: '48px', borderRadius: '14px', background: t.greenBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', flexShrink: '0' } }, '📞'));
        var info = el('div', { style: { flex: '1' } });
        info.appendChild(el('div', { style: Object.assign({}, DS.font('md'), { color: t.text }) }, 'Телефония'));
        var isOnline = data && data.online;
        info.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { fontWeight: '600', color: isOnline ? t.green : t.textTer }) }, isOnline ? '● Онлайн' : '○ Оффлайн'));
        row.appendChild(info);
        var missed = (data && data.missed_count) || 0;
        if (missed > 0) {
          row.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { padding: '4px 10px', borderRadius: '12px', background: t.redBg, color: t.red, fontWeight: '700', flexShrink: '0' }) }, '' + missed));
        }
        container.replaceChildren(row);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/telephony'); };
      }).catch(function () {
        var row = el('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } });
        row.appendChild(el('div', { style: { width: '48px', height: '48px', borderRadius: '14px', background: t.greenBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' } }, '📞'));
        var info = el('div', { style: { flex: '1' } }); info.appendChild(el('div', { style: Object.assign({}, DS.font('md'), { color: t.text }) }, 'Телефония'));
        info.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.textTer }) }, '○ Оффлайн'));
        row.appendChild(info);
        container.replaceChildren(row);
      });
    }
  }
};
