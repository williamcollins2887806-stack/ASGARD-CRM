window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.tenders_funnel = {
  name: 'Воронка', icon: '📊', size: 'normal', roles: ['ADMIN','TO','HEAD_TO','PM','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'stats', count: 1 }));
    _load();
    function _load() {
      API.fetchCached('tenders', '/data/tenders').then(function (all) {
        var y = new Date().getFullYear();
        var tenders = (all || []).filter(function (x) { return String(x.year) === String(y) || (x.period || '').indexOf(String(y)) === 0; });
        var stages = [
          { l: 'Новый', keys: ['Новый'], cl: t.blue },
          { l: 'Просчёт', keys: ['Просчёт','Согласование ТКП'], cl: t.gold },
          { l: 'Подано', keys: ['ТКП согласовано','Подано','Ожидание'], cl: t.orange },
          { l: 'Выиграно', keys: ['Выиграли','Клиент согласился','Контракт'], cl: t.green },
          { l: 'Отказ', keys: ['Проиграли','Клиент отказался','Отклонено'], cl: t.red }
        ];
        var counts = stages.map(function (s) { var c = tenders.filter(function (x) { return s.keys.indexOf(x.tender_status) !== -1; }).length; return { l: s.l, c: c, cl: s.cl }; });
        var maxC = Math.max.apply(null, counts.map(function (s) { return s.c; }).concat([1]));
        var wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
        counts.forEach(function (s, i) {
          var pct = Math.max(Math.round((s.c / maxC) * 100), 8);
          var row = el('div', { style: Object.assign({ display: 'flex', alignItems: 'center', gap: '10px' }, DS.anim(i * 0.05)) });
          var bar = el('div', { style: { height: '28px', borderRadius: '8px', width: pct + '%', background: s.cl, opacity: '0.85', display: 'flex', alignItems: 'center', padding: '0 10px', minWidth: '40px', transition: 'width 0.5s ease' } });
          bar.appendChild(el('span', { style: { fontSize: '11px', fontWeight: '700', color: '#fff' } }, '' + s.c));
          row.appendChild(bar);
          row.appendChild(el('span', { style: Object.assign({}, DS.font('xs'), { color: t.textSec }) }, s.l));
          wrap.appendChild(row);
        });
        container.replaceChildren(wrap);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/funnel'); };
      }).catch(function (e) { console.error('[tenders_funnel]', e); container.replaceChildren(M.Empty({ text: 'Нет данных' })); });
    }
  }
};
