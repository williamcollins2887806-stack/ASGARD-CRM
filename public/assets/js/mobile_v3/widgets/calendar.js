window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.calendar = {
  name: 'Календарь', icon: '📅', size: 'normal', roles: ['*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    var now = new Date();
    var dayNames = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    var dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
    var monday = new Date(now); monday.setDate(now.getDate() - dow);
    var strip = el('div', { style: { display: 'flex', gap: '4px', justifyContent: 'space-between' } });
    for (var i = 0; i < 7; i++) {
      var d = new Date(monday); d.setDate(monday.getDate() + i);
      var isToday = d.toDateString() === now.toDateString();
      var cell = el('div', { style: { flex: '1', textAlign: 'center', padding: '8px 2px', borderRadius: '12px', background: isToday ? t.red : 'transparent', cursor: 'pointer' } });
      cell.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: isToday ? '#fff' : t.textTer, fontWeight: '600', marginBottom: '4px' }) }, dayNames[i]));
      cell.appendChild(el('div', { style: Object.assign({}, DS.font('base'), { color: isToday ? '#fff' : t.text, fontWeight: isToday ? '700' : '400' }) }, '' + d.getDate()));
      strip.appendChild(cell);
    }
    container.replaceChildren(strip);
    container.style.cursor = 'pointer';
    container.onclick = function () { Router.navigate('/meetings'); };
  }
};
