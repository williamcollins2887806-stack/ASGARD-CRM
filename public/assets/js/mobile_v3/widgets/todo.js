window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.todo = {
  name: 'Мои задачи', icon: '✅', size: 'normal', roles: ['*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'list', count: 3 }));
    _load();
    function _load() {
      API.fetch('/tasks/todo').then(function (data) {
        var items = Array.isArray(data) ? data : (data && data.items) || [];
        items = items.slice(0, 5);
        if (!items.length) { container.replaceChildren(M.Empty({ text: 'Нет задач', icon: '✅' })); return; }
        var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '0', borderRadius: '14px', border: '1px solid ' + t.border, overflow: 'hidden', background: t.surface } });
        items.forEach(function (tk, i) {
          var done = !!tk.done;
          var row = el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', borderBottom: i < items.length - 1 ? '1px solid ' + t.border : 'none', cursor: 'pointer' } });
          var ck = el('div', { style: { width: '22px', height: '22px', borderRadius: '6px', flexShrink: '0', border: done ? 'none' : '2px solid ' + t.border, background: done ? t.green : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '13px', fontWeight: '700', transition: 'all 0.2s ease' } }, done ? '✓' : '');
          row.appendChild(ck);
          var txt = el('span', { style: Object.assign({}, DS.font('base'), { color: done ? t.textTer : t.text, textDecoration: done ? 'line-through' : 'none', flex: '1' }) }, tk.text || tk.title || '');
          row.appendChild(txt);
          row.addEventListener('click', function () {
            done = !done; tk.done = done;
            ck.style.background = done ? t.green : 'transparent';
            ck.style.border = done ? 'none' : '2px solid ' + t.border;
            ck.textContent = done ? '✓' : '';
            txt.style.textDecoration = done ? 'line-through' : 'none';
            txt.style.color = done ? t.textTer : t.text;
            try { navigator.vibrate(10); } catch (ex) { /* */ }
            API.fetch('/tasks/todo/' + tk.id, { method: 'PATCH', body: { done: done } }).catch(function () {});
          });
          list.appendChild(row);
        });
        container.replaceChildren(list);
      }).catch(function (e) { console.error('[todo]', e); container.replaceChildren(M.Empty({ text: 'Ошибка загрузки', icon: '⚠️' })); });
    }
  }
};
