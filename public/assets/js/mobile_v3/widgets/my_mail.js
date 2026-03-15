window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.my_mail = {
  name: 'Моя почта', icon: '📧', size: 'normal', roles: ['*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'list', count: 3 }));
    _load();
    function _load() {
      API.fetch('/my-mail/inbox?limit=5').then(function (data) {
        var emails = (data && data.emails) || (data && data.items) || (Array.isArray(data) ? data : []);
        if (!emails.length) { container.replaceChildren(M.Empty({ text: 'Нет писем', icon: '📧' })); return; }
        var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '0', borderRadius: '14px', border: '1px solid ' + t.border, overflow: 'hidden', background: t.surface } });
        emails.slice(0, 5).forEach(function (m, i) {
          var row = el('div', { style: { display: 'flex', gap: '10px', padding: '12px 14px', borderBottom: i < Math.min(emails.length, 5) - 1 ? '1px solid ' + t.border : 'none', alignItems: 'center' } });
          row.appendChild(el('div', { style: { width: '8px', height: '8px', borderRadius: '50%', background: m.is_read ? 'transparent' : t.blue, flexShrink: '0' } }));
          var body = el('div', { style: { flex: '1', minWidth: '0' } });
          body.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { fontWeight: m.is_read ? '400' : '600', color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }) }, m.from || m.sender || '—'));
          body.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.textSec, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }) }, m.subject || ''));
          row.appendChild(body);
          row.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.textTer, flexShrink: '0' }) }, m.time || Utils.formatDate(m.date || m.received_at, 'short')));
          list.appendChild(row);
        });
        container.replaceChildren(list);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/my-mail'); };
      }).catch(function (e) { console.error('[my_mail]', e); container.replaceChildren(M.Empty({ text: 'Ошибка загрузки', icon: '⚠️' })); });
    }
  }
};
