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
        var tenders = (all || []).filter(function (x) {
          if (x.year) return String(x.year) === String(y);
          if (x.period) return (x.period || '').indexOf(String(y)) === 0;
          var d = x.created_at ? new Date(x.created_at) : null;
          return d ? d.getFullYear() === y : true;
        });
        var stages = [
          { l: 'Новый', keys: ['Новый','Черновик','Получен'], cl: t.blue },
          { l: 'Просчёт', keys: ['В просчёте','На просчёте','КП отправлено','Согласование ТКП'], cl: t.gold },
          { l: 'Подано', keys: ['ТКП согласовано','ТКП отправлено','Переговоры','На согласовании'], cl: t.orange },
          { l: 'В работе', keys: ['В работе','Выполняется','Мобилизация'], cl: '#4dabf7' },
          { l: 'Выиграно', keys: ['Выиграли','Клиент согласился','Контракт'], cl: t.green },
          { l: 'Отказ', keys: ['Отказ','Проиграли','Клиент отказался','Отменён','Отклонено'], cl: t.red }
        ];
        var counts = stages.map(function (s) { var c = tenders.filter(function (x) { return s.keys.indexOf(x.tender_status) !== -1; }).length; return { l: s.l, c: c, cl: s.cl }; });
        var maxC = Math.max.apply(null, counts.map(function (s) { return s.c; }).concat([1]));
        var wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
        counts.forEach(function (s, i) {
          var pct = Math.max(Math.round((s.c / maxC) * 100), 8);
          var row = el('div', { style: {
            display: 'flex', alignItems: 'center', gap: '10px',
            opacity: '0', transform: 'translateX(-8px)',
            transition: 'all 0.3s ease ' + (i * 0.06) + 's',
          } });

          /* badge count */
          var badge = el('div', { style: {
            width: '26px', height: '26px', borderRadius: '5px',
            background: s.cl + '22', color: s.cl,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '11px', fontWeight: '700', flexShrink: '0',
          } });
          badge.textContent = s.c;
          row.appendChild(badge);

          /* bar */
          var barOuter = el('div', { style: { flex: '1', height: '24px', borderRadius: '6px', background: t.surfaceAlt, overflow: 'hidden' } });
          var barInner = el('div', { style: {
            height: '100%', borderRadius: '6px', width: '0%',
            background: s.cl, opacity: '0.8',
            transition: 'width 0.6s cubic-bezier(0.25,0.46,0.45,0.94) ' + (i * 0.08 + 0.2) + 's',
          } });
          barOuter.appendChild(barInner);
          row.appendChild(barOuter);

          /* label */
          row.appendChild(el('span', { style: Object.assign({}, DS.font('xs'), { color: t.textTer, fontSize: '10px', minWidth: '48px' }) }, s.l));
          wrap.appendChild(row);

          /* animate entry */
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              row.style.opacity = '1';
              row.style.transform = 'translateX(0)';
              barInner.style.width = pct + '%';
            });
          });
        });
        container.replaceChildren(wrap);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/funnel'); };
      }).catch(function (e) { console.error('[tenders_funnel]', e); container.replaceChildren(M.Empty({ text: 'Нет данных' })); });
    }
  }
};
