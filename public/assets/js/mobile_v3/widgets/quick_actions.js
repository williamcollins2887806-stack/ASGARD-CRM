window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.quick_actions = {
  name: 'Быстрые действия', icon: '⚡', size: 'normal', roles: ['*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;

    var actions = [
      { icon: '📝', label: 'Тендер', onClick: function () { Router.navigate('/tenders'); } },
      { icon: '✅', label: 'Задача', onClick: function () { Router.navigate('/tasks'); } },
      { icon: '💰', label: 'Аванс', onClick: function () { Router.navigate('/cash'); } },
      { icon: '📎', label: 'Пропуск', onClick: function () { Router.navigate('/pass-requests'); } },
    ];

    var grid = el('div', { style: {
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px',
    } });

    actions.forEach(function (item) {
      var tile = el('div', { style: {
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
        padding: '12px 4px', background: t.surfaceAlt, borderRadius: '14px',
        border: '1px solid ' + t.border, cursor: 'pointer',
        transition: 'transform 0.15s ease',
      } });
      tile.appendChild(el('div', { style: { fontSize: '22px', lineHeight: '1' } }, item.icon));
      tile.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.textSec, fontWeight: '500', textAlign: 'center' }) }, item.label));

      tile.addEventListener('click', function () { item.onClick(); });
      tile.addEventListener('touchstart', function () { tile.style.transform = 'scale(0.95)'; }, { passive: true });
      tile.addEventListener('touchend', function () { tile.style.transform = ''; }, { passive: true });
      grid.appendChild(tile);
    });

    container.replaceChildren(grid);
  }
};
