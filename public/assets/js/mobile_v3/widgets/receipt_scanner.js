window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.receipt_scanner = {
  name: 'Сканер чеков', icon: '📷', size: 'normal', roles: ['PM','HEAD_PM'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    var row = el('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', cursor: 'pointer' } });
    row.appendChild(el('div', { style: { width: '48px', height: '48px', borderRadius: '14px', background: t.redBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', flexShrink: '0' } }, '📷'));
    var info = el('div', { style: { flex: '1' } });
    info.appendChild(el('div', { style: Object.assign({}, DS.font('md'), { color: t.text }) }, 'Сканер чеков'));
    info.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.textSec }) }, 'Нажмите для сканирования'));
    row.appendChild(info);
    row.addEventListener('click', function () {
      if (window.AsgardReceiptScanner) window.AsgardReceiptScanner.openScanner();
      else M.Toast({ message: 'Камера недоступна', type: 'info' });
    });
    container.replaceChildren(row);
  }
};
