window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.money_summary = {
  name: 'Финансы', icon: '💰', size: 'normal', roles: ['ADMIN','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'hero', count: 1 }));
    _load();
    function _load() {
      Promise.all([
        API.fetchCached('works', '/works'),
        API.fetchCached('tenders', '/data/tenders')
      ]).then(function (res) {
        var works = res[0] || []; var tenders = res[1] || [];
        var y = new Date().getFullYear();
        var tIds = {}; tenders.filter(function (x) {
          if (x.year) return String(x.year) === String(y);
          if (x.period) return (x.period || '').indexOf(String(y)) === 0;
          var d = x.created_at ? new Date(x.created_at) : null;
          return d ? d.getFullYear() === y : true;
        }).forEach(function (x) { tIds[x.id] = true; });
        var yWorks = works.filter(function (x) { var d = x.start_fact || x.start_plan || x.created_at; if (d && new Date(d).getFullYear() === y) return true; if (x.tender_id && tIds[x.tender_id]) return true; return false; });
        var revenue = yWorks.reduce(function (s, x) { return s + (Number(x.contract_sum) || Number(x.contract_value) || 0); }, 0);
        var expenses = yWorks.reduce(function (s, x) { return s + (Number(x.total_cost) || Number(x.expenses) || 0); }, 0);
        var profit = revenue - expenses;

        /* Hero wrapper with gradient */
        var hero = el('div', { style: {
          background: 'var(--hero-grad)', borderRadius: '16px', padding: '18px 16px 14px',
          position: 'relative', overflow: 'hidden', cursor: 'pointer',
        } });

        /* ASGARD watermark */
        hero.appendChild(el('div', { style: {
          position: 'absolute', right: '12px', top: '10px',
          fontSize: '32px', fontWeight: '800', color: 'rgba(255,255,255,0.08)',
          letterSpacing: '2px', lineHeight: '1',
        } }, 'ᚨ'));

        /* label */
        hero.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), {
          color: 'rgba(255,255,255,0.55)', letterSpacing: '1.5px', fontWeight: '600', marginBottom: '6px',
        }) }, 'ФИНАНСЫ ' + y));

        /* main amount with animated counter */
        var amountEl = el('div', { style: Object.assign({}, DS.font('hero'), {
          color: '#fff', fontWeight: '800', letterSpacing: '-0.5px', marginBottom: '2px',
        }) });
        amountEl.textContent = '0 ₽';
        hero.appendChild(amountEl);

        /* animate counter */
        var startTime = null;
        var duration = 800;
        function animateCount(ts) {
          if (!startTime) startTime = ts;
          var progress = Math.min((ts - startTime) / duration, 1);
          var eased = 1 - Math.pow(1 - progress, 3);
          var current = Math.round(revenue * eased);
          amountEl.textContent = Utils.formatMoney(current, { short: true });
          if (progress < 1) requestAnimationFrame(animateCount);
        }
        requestAnimationFrame(animateCount);

        /* sparkline — real monthly revenue data */
        var sparkData = [];
        for (var m = 0; m < 12; m++) {
          var mRev = yWorks.filter(function (x) {
            var d = x.start_fact || x.start_plan || x.created_at;
            return d && new Date(d).getMonth() === m;
          }).reduce(function (s, x) { return s + (Number(x.contract_sum) || Number(x.contract_value) || 0); }, 0);
          sparkData.push(mRev);
        }
        if (typeof M.Sparkline === 'function') {
          var sparkWrap = el('div', { style: { margin: '8px 0 10px', opacity: '0.9' } });
          sparkWrap.appendChild(M.Sparkline({ data: sparkData, color: 'rgba(255,255,255,0.7)', width: 200, height: 28 }));
          hero.appendChild(sparkWrap);
        }

        /* details row */
        var details = el('div', { style: { display: 'flex', gap: '16px' } });
        var mkDetail = function (label, value, color) {
          var d = el('div');
          d.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'rgba(255,255,255,0.5)' }) }, label));
          d.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: color, fontWeight: '700' }) }, value));
          return d;
        };
        details.appendChild(mkDetail('Расходы', Utils.formatMoney(expenses, { short: true }), '#FF6B6B'));
        details.appendChild(mkDetail('Прибыль', Utils.formatMoney(profit, { short: true }), profit >= 0 ? '#51CF66' : '#FF6B6B'));
        hero.appendChild(details);

        hero.addEventListener('click', function () { Router.navigate('/finances'); });
        container.replaceChildren(hero);
      }).catch(function (e) { console.error('[money_summary]', e); container.replaceChildren(M.Empty({ text: 'Нет данных' })); });
    }
  }
};
