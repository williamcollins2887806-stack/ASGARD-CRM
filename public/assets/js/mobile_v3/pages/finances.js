/**
 * ASGARD CRM — Mobile v3: Финансы
 * Route: #/finances
 * API: GET /api/works, GET /api/expenses/work, GET /api/expenses/office, GET /api/incomes
 */
const FinancesPage = {
  async render() {
    const el = Utils.el;
    const t = DS.t;

    const page = el('div', { style: { paddingBottom: '100px' } });
    page.appendChild(M.Header({ title: 'Финансы', subtitle: 'СВОДКА', back: true, backHref: '/home' }));

    const body = el('div');
    body.appendChild(M.Skeleton({ type: 'hero', count: 1 }));
    body.appendChild(el('div', { style: { height: '12px' } }));
    body.appendChild(M.Skeleton({ type: 'stats', count: 1 }));
    body.appendChild(M.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(body);

    try {
      // Load all financial data in parallel
      const [works, workExpenses, officeExpenses] = await Promise.all([
        API.fetch('/works?limit=500').catch(() => []),
        API.fetch('/expenses/work').catch(() => []),
        API.fetch('/expenses/office').catch(() => []),
      ]);

      const worksList = Array.isArray(works) ? works : (works.works || works.data || []);
      const wExpList = Array.isArray(workExpenses) ? workExpenses : (workExpenses.data || []);
      const oExpList = Array.isArray(officeExpenses) ? officeExpenses : (officeExpenses.data || []);

      body.innerHTML = '';

      // Calculate totals
      const totalRevenue = worksList.reduce((s, w) => s + (parseFloat(w.contract_amount || w.income || 0)), 0);
      const totalWorkExp = wExpList.reduce((s, e) => s + (parseFloat(e.amount || 0)), 0);
      const totalOfficeExp = oExpList.reduce((s, e) => s + (parseFloat(e.amount || 0)), 0);
      const totalExpenses = totalWorkExp + totalOfficeExp;
      const profit = totalRevenue - totalExpenses;

      // Hero — profit
      const heroWrap = el('div', { style: { padding: '12px 20px' } });
      heroWrap.appendChild(M.HeroCard({
        label: 'ПРИБЫЛЬ',
        value: Utils.formatMoney(profit),
        valueSuffix: ' ₽',
        details: [
          { label: 'Выручка', value: Utils.formatMoney(totalRevenue) + ' ₽', color: '#34C759' },
          { label: 'Расходы', value: Utils.formatMoney(totalExpenses) + ' ₽', color: '#FF5252' },
        ],
      }));
      body.appendChild(heroWrap);

      // Stats grid
      body.appendChild(el('div', { style: { margin: '12px 0 4px' } }, M.Stats({
        items: [
          { icon: '📈', label: 'Выручка', value: Utils.formatMoney(totalRevenue), color: 'var(--green)' },
          { icon: '📉', label: 'Расходы', value: Utils.formatMoney(totalExpenses), color: 'var(--red)' },
          { icon: '🔧', label: 'Расх. работы', value: Utils.formatMoney(totalWorkExp) },
          { icon: '🏢', label: 'Расх. офис', value: Utils.formatMoney(totalOfficeExp) },
        ],
      })));

      // Monthly bar chart
      const monthlyData = buildMonthlyChart(worksList, wExpList, oExpList);
      if (monthlyData.length > 1) {
        body.appendChild(M.Section({
          title: 'Динамика по месяцам',
          collapsible: true,
          content: M.BarChart({
            data: monthlyData,
            opts: { height: 140, dual: true },
          }),
        }));

        // Legend for dual chart
        const legend = el('div', {
          style: { display: 'flex', gap: '16px', padding: '4px 20px 8px', justifyContent: 'center' },
        });
        [{ color: t.blue, label: 'Выручка' }, { color: t.red, label: 'Расходы' }].forEach(l => {
          const item = el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } });
          item.appendChild(el('div', { style: { width: '10px', height: '10px', borderRadius: '2px', background: l.color } }));
          item.appendChild(el('span', { style: { ...DS.font('xs'), color: t.textSec }, textContent: l.label }));
          legend.appendChild(item);
        });
        body.appendChild(legend);
      }

      // Tabs: works expenses / office expenses
      let activeTab = 'works';
      const tabContent = el('div', { style: { padding: '12px 0' } });

      body.appendChild(el('div', { style: { height: '8px' } }));
      body.appendChild(M.Tabs({
        items: [
          { label: 'Расходы работ (' + wExpList.length + ')', value: 'works' },
          { label: 'Офисные (' + oExpList.length + ')', value: 'office' },
        ],
        active: 'works',
        onChange: (val) => { activeTab = val; renderTab(); },
      }));
      body.appendChild(tabContent);

      function renderTab() {
        tabContent.innerHTML = '';
        const items = activeTab === 'works' ? wExpList : oExpList;

        if (!items.length) {
          tabContent.appendChild(M.Empty({ text: 'Нет данных', type: 'search' }));
          return;
        }

        const sorted = [...items].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 20px' } });

        sorted.slice(0, 30).forEach((e, i) => {
          list.appendChild(M.Card({
            title: e.description || e.category || 'Расход',
            subtitle: activeTab === 'works' ? (e.work_title || '') : (e.category || ''),
            badge: Utils.formatMoney(parseFloat(e.amount || 0)) + ' ₽',
            badgeColor: 'danger',
            fields: [
              { label: 'Дата', value: e.created_at ? Utils.formatDate(e.created_at) : '—' },
              ...(e.user_name ? [{ label: 'Автор', value: e.user_name }] : []),
            ],
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
      body.innerHTML = '';
      body.appendChild(M.Empty({ text: 'Ошибка загрузки', type: 'error' }));
    }

    return page;

    function buildMonthlyChart(works, wExp, oExp) {
      const months = {};
      const now = new Date();

      // Initialize last 6 months
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        months[key] = { label: d.toLocaleDateString('ru-RU', { month: 'short' }), value: 0, value2: 0 };
      }

      // Revenue from works (by created_at or start_date)
      works.forEach(w => {
        const d = w.start_date || w.created_at;
        if (!d) return;
        const dt = new Date(d);
        const key = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
        if (months[key]) months[key].value += parseFloat(w.contract_amount || 0);
      });

      // Expenses
      [...wExp, ...oExp].forEach(e => {
        const d = e.created_at || e.date;
        if (!d) return;
        const dt = new Date(d);
        const key = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
        if (months[key]) months[key].value2 += parseFloat(e.amount || 0);
      });

      return Object.values(months);
    }
  },
};

Router.register('/finances', FinancesPage);
if (typeof window !== 'undefined') window.FinancesPage = FinancesPage;
