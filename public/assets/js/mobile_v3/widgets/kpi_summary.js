window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.kpi_summary = {
  name: 'KPI сводка', icon: '🎯', size: 'wide', roles: ['ADMIN','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'stats', count: 1 }));
    _load();
    function _load() {
      Promise.all([
        API.fetchCached('tenders', '/data/tenders'),
        API.fetchCached('works', '/works'),
        API.fetchCached('estimates', '/data/estimates')
      ]).then(function (res) {
        var y = new Date().getFullYear();
        var allTenders = res[0] || [];
        var tenders = allTenders.filter(function (x) {
          if (x.year) return String(x.year) === String(y);
          if (x.period) return (x.period || '').indexOf(String(y)) === 0;
          var d = x.created_at ? new Date(x.created_at) : null;
          return d ? d.getFullYear() === y : true;
        });
        var allWorks = res[1] || [];
        var works = allWorks.filter(function (w) { return ['Завершена','Работы сдали','Закрыт'].indexOf(w.work_status) === -1; });
        var allEstimates = res[2] || [];
        var margins = allEstimates.filter(function (e) { return e.margin_percent; }).map(function (e) { return Number(e.margin_percent) || 0; });
        var avgMargin = margins.length ? Math.round(margins.reduce(function (a, b) { return a + b; }, 0) / margins.length) : 0;

        /* Build real monthly sparkline data */
        function monthlyCount(arr, dateField) {
          var counts = [0,0,0,0,0,0,0,0,0,0,0,0];
          arr.forEach(function (item) {
            var d = item[dateField] || item.created_at;
            if (d) { var m = new Date(d).getMonth(); counts[m]++; }
          });
          return counts;
        }
        var tendersByMonth = monthlyCount(tenders, 'created_at');
        var worksByMonth = monthlyCount(allWorks, 'start_fact');
        var estByMonth = monthlyCount(allEstimates, 'created_at');
        /* margin by month — average per-month from estimates with margin */
        var marginByMonth = [];
        for (var mi = 0; mi < 12; mi++) {
          var mMargins = allEstimates.filter(function (e) {
            var d = e.created_at; return d && new Date(d).getMonth() === mi && e.margin_percent;
          }).map(function (e) { return Number(e.margin_percent) || 0; });
          marginByMonth.push(mMargins.length ? Math.round(mMargins.reduce(function (a, b) { return a + b; }, 0) / mMargins.length) : 0);
        }

        var items = [
          { value: tenders.length, label: 'Тендеров', color: t.blue, data: tendersByMonth },
          { value: works.length, label: 'В работе', color: t.green, data: worksByMonth },
          { value: avgMargin + '%', label: 'Ср. маржа', color: t.gold, data: marginByMonth },
          { value: allEstimates.length, label: 'Просчётов', color: t.orange, data: estByMonth },
        ];

        /* carousel container */
        var scroll = el('div', { className: 'asgard-no-scrollbar', style: {
          display: 'flex', gap: '8px', overflowX: 'auto',
          scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch',
          padding: '0 2px', touchAction: 'pan-x',
        } });

        items.forEach(function (item) {
          var card = el('div', { style: {
            minWidth: '140px', flex: '0 0 auto', padding: '12px 14px',
            background: t.surfaceAlt, borderRadius: '14px',
            border: '1px solid ' + t.border,
            scrollSnapAlign: 'start',
            display: 'flex', flexDirection: 'column', gap: '4px',
          } });

          var top = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } });
          top.appendChild(el('div', { style: Object.assign({}, DS.font('xl'), { color: item.color, fontWeight: '800' }) }, '' + item.value));
          if (typeof M.Sparkline === 'function') {
            top.appendChild(M.Sparkline({ data: item.data, color: item.color, width: 48, height: 20 }));
          }
          card.appendChild(top);
          card.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.textSec }) }, item.label));
          scroll.appendChild(card);
        });

        /* scroll indicators */
        var wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
        wrap.appendChild(scroll);

        var dotsWrap = el('div', { style: { display: 'flex', justifyContent: 'center', gap: '4px' } });
        items.forEach(function (_, idx) {
          var dot = el('div', { style: {
            width: idx === 0 ? '16px' : '4px', height: '4px', borderRadius: '2px',
            background: idx === 0 ? t.blue : (t.textTer + '44'),
            transition: 'all 0.2s ease',
          } });
          dotsWrap.appendChild(dot);
        });
        wrap.appendChild(dotsWrap);

        /* update dots on scroll */
        scroll.addEventListener('scroll', function () {
          var idx = Math.round(scroll.scrollLeft / 148);
          var allDots = dotsWrap.children;
          for (var i = 0; i < allDots.length; i++) {
            allDots[i].style.width = i === idx ? '16px' : '4px';
            allDots[i].style.background = i === idx ? t.blue : (t.textTer + '44');
          }
        }, { passive: true });

        container.replaceChildren(wrap);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/tenders'); };
      }).catch(function (e) { console.error('[kpi_summary]', e); container.replaceChildren(M.Empty({ text: 'Нет данных' })); });
    }
  }
};
