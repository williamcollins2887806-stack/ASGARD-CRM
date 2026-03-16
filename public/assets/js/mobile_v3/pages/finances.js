/**
 * ASGARD CRM — Mobile v3: Финансы
 * Route: #/finances
 * API: GET /api/works, GET /api/expenses/work, GET /api/expenses/office
 */
var FinancesPage = (function () {
  'use strict';

  var el = Utils.el;

  function buildMonthlyChart(works, wExp, oExp) {
    var months = {};
    var now = new Date();
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      months[key] = { label: d.toLocaleDateString('ru-RU', { month: 'short' }), value: 0, value2: 0 };
    }
    works.forEach(function (w) {
      var dt = w.start_date || w.created_at;
      if (!dt) return;
      var dd = new Date(dt);
      var k = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0');
      if (months[k]) months[k].value += parseFloat(w.contract_amount || 0);
    });
    wExp.concat(oExp).forEach(function (e) {
      var dt = e.created_at || e.date;
      if (!dt) return;
      var dd = new Date(dt);
      var k = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0');
      if (months[k]) months[k].value2 += parseFloat(e.amount || 0);
    });
    return Object.values(months);
  }

  return {
    render: function () {
      var t = DS.t;
      var page = el('div', { style: { paddingBottom: '100px' } });
      page.appendChild(M.Header({ title: 'Финансы', subtitle: 'СВОДКА', back: true, backHref: '/home' }));

      var body = el('div');
      body.appendChild(M.Skeleton({ type: 'hero', count: 1 }));
      body.appendChild(el('div', { style: { height: '12px' } }));
      body.appendChild(M.Skeleton({ type: 'stats', count: 1 }));
      body.appendChild(M.Skeleton({ type: 'card', count: 3 }));
      page.appendChild(body);

      setTimeout(async function () {
        try {
          var results = await Promise.all([
            API.fetch('/works?limit=500').catch(function () { return []; }),
            API.fetch('/expenses/work').catch(function () { return []; }),
            API.fetch('/expenses/office').catch(function () { return []; }),
          ]);

          var worksList = API.extractRows(results[0]);
          var wExpList = API.extractRows(results[1]);
          var oExpList = API.extractRows(results[2]);

          body.replaceChildren();

          var totalRevenue = worksList.reduce(function (s, w) { return s + parseFloat(w.contract_amount || w.income || 0); }, 0);
          var totalWorkExp = wExpList.reduce(function (s, e) { return s + parseFloat(e.amount || 0); }, 0);
          var totalOfficeExp = oExpList.reduce(function (s, e) { return s + parseFloat(e.amount || 0); }, 0);
          var totalExpenses = totalWorkExp + totalOfficeExp;
          var profit = totalRevenue - totalExpenses;

          // Hero
          var heroWrap = el('div', { style: { padding: '12px 20px' } });
          heroWrap.appendChild(M.HeroCard({
            label: 'ПРИБЫЛЬ',
            value: Utils.formatMoney(profit),
            valueSuffix: ' ₽',
            details: [
              { label: 'Выручка', value: Utils.formatMoney(totalRevenue) + ' ₽', color: DS.t.green },
              { label: 'Расходы', value: Utils.formatMoney(totalExpenses) + ' ₽', color: DS.t.redBright },
            ],
          }));
          body.appendChild(heroWrap);

          // Stats
          body.appendChild(el('div', { style: { margin: '12px 0 4px' } }, M.Stats({
            items: [
              { icon: '📈', label: 'Выручка', value: Utils.formatMoney(totalRevenue), color: 'var(--green)' },
              { icon: '📉', label: 'Расходы', value: Utils.formatMoney(totalExpenses), color: 'var(--red)' },
              { icon: '🔧', label: 'Расх. работы', value: Utils.formatMoney(totalWorkExp) },
              { icon: '🏢', label: 'Расх. офис', value: Utils.formatMoney(totalOfficeExp) },
            ],
          })));

          // Chart
          var monthlyData = buildMonthlyChart(worksList, wExpList, oExpList);
          if (monthlyData.length > 1) {
            body.appendChild(M.Section({
              title: 'Динамика по месяцам',
              collapsible: true,
              content: M.BarChart({ data: monthlyData, opts: { height: 140, dual: true } }),
            }));
            var legend = el('div', { style: { display: 'flex', gap: '16px', padding: '4px 20px 8px', justifyContent: 'center' } });
            [{ color: t.blue, label: 'Выручка' }, { color: t.red, label: 'Расходы' }].forEach(function (l) {
              var item = el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } });
              item.appendChild(el('div', { style: { width: '10px', height: '10px', borderRadius: '2px', background: l.color } }));
              item.appendChild(el('span', { style: { ...DS.font('xs'), color: t.textSec }, textContent: l.label }));
              legend.appendChild(item);
            });
            body.appendChild(legend);
          }

          // Tabs
          var activeTab = 'works';
          var tabContent = el('div', { style: { padding: '12px 0' } });

          body.appendChild(el('div', { style: { height: '8px' } }));
          body.appendChild(M.Tabs({
            items: [
              { label: 'Расходы работ (' + wExpList.length + ')', value: 'works' },
              { label: 'Офисные (' + oExpList.length + ')', value: 'office' },
            ],
            active: 'works',
            onChange: function (val) { activeTab = val; renderTab(); },
          }));
          body.appendChild(tabContent);

          function renderTab() {
            tabContent.replaceChildren();
            var items = activeTab === 'works' ? wExpList : oExpList;

            if (!items.length) {
              tabContent.appendChild(M.Empty({ text: 'Нет данных', type: 'search' }));
              return;
            }

            var sorted = items.slice().sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
            var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 20px' } });

            sorted.slice(0, 30).forEach(function (e, i) {
              list.appendChild(M.Card({
                title: e.description || e.category || 'Расход',
                subtitle: activeTab === 'works' ? (e.work_title || '') : (e.category || ''),
                badge: Utils.formatMoney(parseFloat(e.amount || 0)) + ' ₽',
                badgeColor: 'danger',
                fields: [
                  { label: 'Дата', value: e.created_at ? Utils.formatDate(e.created_at) : '—' },
                ].concat(e.user_name ? [{ label: 'Автор', value: e.user_name }] : []),
                animDelay: i * 0.02,
              }));
            });

            if (sorted.length > 30) {
              list.appendChild(el('div', {
                style: { ...DS.font('sm'), color: t.textTer, textAlign: 'center', padding: '12px' },
                textContent: 'Показаны 30 из ' + sorted.length,
              }));
            }

            tabContent.appendChild(list);
          }

          renderTab();

        } catch (e) {
          body.replaceChildren();
          body.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate(location.hash.slice(1) || '/home', { replace: true }); } }));
          M.Toast({ message: 'Ошибка загрузки: ' + (e.message || e), type: 'error' });
        }
      }, 0);

      return page;
    },
  };
})();

Router.register('/finances', FinancesPage);
if (typeof window !== 'undefined') window.FinancesPage = FinancesPage;
