/**
 * ASGARD CRM — Mobile v3: Офисные расходы
 * Route: #/office-expenses
 * API: GET /api/expenses/office, POST /api/expenses/office
 */
const OfficeExpensesPage = {
  async render() {
    const el = Utils.el;
    const t = DS.t;

    // Categories from desktop finances.js
    const CATEGORIES = [
      'Аренда', 'Коммунальные', 'Связь/Интернет', 'Канцелярия',
      'Хоз. нужды', 'ПО/Подписки', 'Транспорт', 'Питание',
      'Оборудование офис', 'Маркетинг', 'Юридические', 'Прочее',
    ];

    const page = el('div', { style: { paddingBottom: '100px' } });
    page.appendChild(M.Header({
      title: 'Офис расходы',
      subtitle: 'ФИНАНСЫ',
      back: true,
      backHref: '/finances',
    }));

    const body = el('div');
    body.appendChild(M.Skeleton({ type: 'card', count: 4 }));
    page.appendChild(body);

    let expenses = [];
    let currentFilter = 'all';

    try {
      const data = await API.fetch('/expenses/office');
      expenses = Array.isArray(data) ? data : (data.data || data.expenses || []);

      body.innerHTML = '';

      // Total
      const total = expenses.reduce((s, e) => s + (parseFloat(e.amount || 0)), 0);

      // Category breakdown
      const byCat = {};
      expenses.forEach(e => {
        const cat = e.category || 'Прочее';
        byCat[cat] = (byCat[cat] || 0) + parseFloat(e.amount || 0);
      });
      const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 4);

      // Hero
      const heroWrap = el('div', { style: { padding: '12px 20px' } });
      heroWrap.appendChild(M.HeroCard({
        label: 'ОФИСНЫЕ РАСХОДЫ',
        value: Utils.formatMoney(total),
        valueSuffix: ' ₽',
        details: topCats.slice(0, 3).map(([cat, sum]) => ({
          label: cat, value: Utils.formatMoney(sum) + ' ₽',
        })),
      }));
      body.appendChild(heroWrap);

      // Stats
      const thisMonth = expenses.filter(e => {
        if (!e.created_at) return false;
        const d = new Date(e.created_at);
        const now = new Date();
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      });
      const thisMonthTotal = thisMonth.reduce((s, e) => s + parseFloat(e.amount || 0), 0);

      body.appendChild(el('div', { style: { margin: '12px 0 4px' } }, M.Stats({
        items: [
          { icon: '💸', label: 'Всего', value: Utils.formatMoney(total) },
          { icon: '📅', label: 'Этот месяц', value: Utils.formatMoney(thisMonthTotal), color: 'var(--orange)' },
          { icon: '📋', label: 'Записей', value: expenses.length },
          { icon: '📊', label: 'Категорий', value: Object.keys(byCat).length },
        ],
      })));

      // Category filter
      const catPills = [
        { label: 'Все', value: 'all', active: true },
        ...topCats.map(([cat]) => ({ label: cat, value: cat })),
      ];

      body.appendChild(M.FilterPills({
        items: catPills,
        onChange: (val) => { currentFilter = val; renderList(); },
      }));

      // Monthly chart
      const monthlyData = buildMonthlyData(expenses);
      if (monthlyData.length > 1) {
        body.appendChild(M.Section({
          title: 'По месяцам',
          collapsible: true,
          content: M.BarChart({ data: monthlyData, opts: { height: 120 } }),
        }));
      }

      // List
      const listContainer = el('div', { style: { padding: '12px 0' } });
      body.appendChild(listContainer);

      function renderList() {
        listContainer.innerHTML = '';
        let filtered = expenses;
        if (currentFilter !== 'all') {
          filtered = expenses.filter(e => e.category === currentFilter);
        }

        if (!filtered.length) {
          listContainer.appendChild(M.Empty({ text: 'Нет расходов', type: 'search' }));
          return;
        }

        const sorted = [...filtered].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 20px' } });

        sorted.slice(0, 40).forEach((e, i) => {
          list.appendChild(M.Card({
            title: e.description || e.category || 'Расход',
            subtitle: e.category || '',
            badge: Utils.formatMoney(parseFloat(e.amount || 0)) + ' ₽',
            badgeColor: 'danger',
            fields: [
              { label: 'Дата', value: e.created_at ? Utils.formatDate(e.created_at) : '—' },
              ...(e.user_name ? [{ label: 'Автор', value: e.user_name }] : []),
            ],
            animDelay: i * 0.02,
            onClick: () => openDetail(e),
          }));
        });

        if (sorted.length > 40) {
          list.appendChild(el('div', {
            style: { ...DS.font('sm'), color: t.textTer, textAlign: 'center', padding: '12px' },
            textContent: 'Показаны 40 из ' + sorted.length,
          }));
        }

        listContainer.appendChild(list);
      }

      renderList();

    } catch (e) {
      body.innerHTML = '';
      body.appendChild(M.Empty({ text: 'Ошибка загрузки', type: 'error' }));
    }

    // FAB — new expense
    page.appendChild(M.FAB({
      icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
      onClick: () => openCreateModal(),
    }));

    function openDetail(e) {
      const content = el('div');
      content.appendChild(M.DetailFields({
        fields: [
          { label: 'Описание', value: e.description || '—' },
          { label: 'Категория', value: e.category || '—' },
          { label: 'Сумма', value: Utils.formatMoney(parseFloat(e.amount || 0)) + ' ₽' },
          { label: 'Дата', value: e.created_at ? Utils.formatDate(e.created_at) : '—' },
          { label: 'Автор', value: e.user_name || '—' },
          { label: 'Комментарий', value: e.comment || e.notes || '—' },
        ],
      }));
      M.BottomSheet({ title: 'Расход #' + e.id, content });
    }

    function openCreateModal() {
      const content = el('div');
      content.appendChild(M.Form({
        fields: [
          {
            id: 'category', label: 'Категория', type: 'select', required: true,
            placeholder: 'Выберите категорию',
            options: CATEGORIES.map(c => ({ value: c, label: c })),
          },
          { id: 'amount', label: 'Сумма, ₽', type: 'number', required: true, placeholder: '5000' },
          { id: 'description', label: 'Описание', type: 'text', required: true, placeholder: 'На что потрачено' },
          { id: 'comment', label: 'Комментарий', type: 'textarea', placeholder: 'Дополнительно...' },
        ],
        submitLabel: '💸 Добавить расход',
        onSubmit: async (data) => {
          try {
            await API.fetch('/expenses/office', {
              method: 'POST',
              body: {
                category: data.category,
                amount: parseFloat(data.amount),
                description: data.description,
                comment: data.comment,
              },
            });
            sheetRef.close();
            M.Toast({ message: 'Расход добавлен', type: 'success' });
            Router.navigate('/office-expenses', { replace: true });
          } catch (e) {
            M.Toast({ message: 'Ошибка: ' + (e.message || 'Сеть'), type: 'error' });
          }
        },
      }));

      const sheetRef = M.BottomSheet({ title: 'Новый расход', content, fullscreen: true });
    }

    function buildMonthlyData(expenses) {
      const months = {};
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        months[key] = { label: d.toLocaleDateString('ru-RU', { month: 'short' }), value: 0 };
      }
      expenses.forEach(e => {
        if (!e.created_at) return;
        const d = new Date(e.created_at);
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        if (months[key]) months[key].value += parseFloat(e.amount || 0);
      });
      return Object.values(months);
    }

    return page;
  },
};

Router.register('/office-expenses', OfficeExpensesPage);
if (typeof window !== 'undefined') window.OfficeExpensesPage = OfficeExpensesPage;
