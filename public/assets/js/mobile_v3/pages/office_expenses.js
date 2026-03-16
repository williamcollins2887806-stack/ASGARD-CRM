/**
 * ASGARD CRM — Mobile v3: Офисные расходы
 * Route: #/office-expenses
 * API: GET /api/expenses/office, POST /api/expenses/office
 */
var OfficeExpensesPage = (function () {
  'use strict';

  var el = Utils.el;

  var CATEGORIES = [
    'Аренда', 'Коммунальные', 'Связь/Интернет', 'Канцелярия',
    'Хоз. нужды', 'ПО/Подписки', 'Транспорт', 'Питание',
    'Оборудование офис', 'Маркетинг', 'Юридические', 'Прочее',
  ];

  function buildMonthlyData(expenses) {
    var months = {};
    var now = new Date();
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      months[key] = { label: d.toLocaleDateString('ru-RU', { month: 'short' }), value: 0 };
    }
    expenses.forEach(function (e) {
      if (!e.created_at) return;
      var dd = new Date(e.created_at);
      var k = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0');
      if (months[k]) months[k].value += parseFloat(e.amount || 0);
    });
    return Object.values(months);
  }

  function openDetail(e) {
    var content = el('div');
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
    M.BottomSheet({ title: 'Расход #' + e.id, content: content });
  }

  function openCreateModal() {
    var content = el('div');
    content.appendChild(M.Form({
      fields: [
        { id: 'category', label: 'Категория', type: 'select', required: true, placeholder: 'Выберите категорию', options: CATEGORIES.map(function (c) { return { value: c, label: c }; }) },
        { id: 'amount', label: 'Сумма, ₽', type: 'number', required: true, placeholder: '5000' },
        { id: 'description', label: 'Описание', type: 'text', required: true, placeholder: 'На что потрачено' },
        { id: 'comment', label: 'Комментарий', type: 'textarea', placeholder: 'Дополнительно...' },
      ],
      submitLabel: '💸 Добавить расход',
      onSubmit: async function (data) {
        try {
          await API.fetch('/expenses/office', {
            method: 'POST',
            body: { category: data.category, amount: parseFloat(data.amount), description: data.description, comment: data.comment },
          });
          sheetRef.close();
          M.Toast({ message: 'Расход добавлен', type: 'success' });
          Router.navigate('/office-expenses', { replace: true });
        } catch (e) {
          M.Toast({ message: 'Ошибка: ' + (e.message || 'Сеть'), type: 'error' });
        }
      },
    }));
    var sheetRef = M.BottomSheet({ title: 'Новый расход', content: content, fullscreen: true });
  }

  return {
    render: function () {
      var t = DS.t;
      var page = el('div', { style: { paddingBottom: '100px' } });
      page.appendChild(M.Header({ title: 'Офис расходы', subtitle: 'ФИНАНСЫ', back: true, backHref: '/finances' }));

      var body = el('div');
      body.appendChild(M.Skeleton({ type: 'hero', count: 1 }));
      body.appendChild(el('div', { style: { height: '12px' } }));
      body.appendChild(M.Skeleton({ type: 'card', count: 4 }));
      page.appendChild(body);

      page.appendChild(M.FAB({
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        onClick: function () { openCreateModal(); },
      }));

      setTimeout(async function () {
        try {
          var data = await API.fetch('/expenses/office');
          var expenses = API.extractRows(data);

          body.replaceChildren();

          var total = expenses.reduce(function (s, e) { return s + parseFloat(e.amount || 0); }, 0);
          var byCat = {};
          expenses.forEach(function (e) {
            var cat = e.category || 'Прочее';
            byCat[cat] = (byCat[cat] || 0) + parseFloat(e.amount || 0);
          });
          var topCats = Object.entries(byCat).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 4);

          // Hero
          var heroWrap = el('div', { style: { padding: '12px 20px' } });
          heroWrap.appendChild(M.HeroCard({
            label: 'ОФИСНЫЕ РАСХОДЫ',
            value: Utils.formatMoney(total),
            valueSuffix: ' ₽',
            details: topCats.slice(0, 3).map(function (c) { return { label: c[0], value: Utils.formatMoney(c[1]) + ' ₽' }; }),
          }));
          body.appendChild(heroWrap);

          // Stats
          var now = new Date();
          var thisMonth = expenses.filter(function (e) {
            if (!e.created_at) return false;
            var d = new Date(e.created_at);
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
          });
          var thisMonthTotal = thisMonth.reduce(function (s, e) { return s + parseFloat(e.amount || 0); }, 0);

          body.appendChild(el('div', { style: { margin: '12px 0 4px' } }, M.Stats({
            items: [
              { icon: '💸', label: 'Всего', value: Utils.formatMoney(total) },
              { icon: '📅', label: 'Этот месяц', value: Utils.formatMoney(thisMonthTotal), color: 'var(--orange)' },
              { icon: '📋', label: 'Записей', value: expenses.length },
              { icon: '📊', label: 'Категорий', value: Object.keys(byCat).length },
            ],
          })));

          // Category filter
          var currentFilter = 'all';
          var catPills = [{ label: 'Все', value: 'all', active: true }].concat(topCats.map(function (c) { return { label: c[0], value: c[0] }; }));

          body.appendChild(M.FilterPills({
            items: catPills,
            onChange: function (val) { currentFilter = val; renderList(); },
          }));

          // Chart
          var monthlyData = buildMonthlyData(expenses);
          if (monthlyData.length > 1) {
            body.appendChild(M.Section({
              title: 'По месяцам',
              collapsible: true,
              content: M.BarChart({ data: monthlyData, opts: { height: 120 } }),
            }));
          }

          var listContainer = el('div', { style: { padding: '12px 0' } });
          body.appendChild(listContainer);

          function renderList() {
            listContainer.replaceChildren();
            var filtered = currentFilter === 'all' ? expenses : expenses.filter(function (e) { return e.category === currentFilter; });

            if (!filtered.length) {
              listContainer.appendChild(M.Empty({ text: 'Нет расходов', type: 'search' }));
              return;
            }

            var sorted = filtered.slice().sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
            var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 20px' } });

            sorted.slice(0, 40).forEach(function (e, i) {
              list.appendChild(M.Card({
                title: e.description || e.category || 'Расход',
                subtitle: e.category || '',
                badge: Utils.formatMoney(parseFloat(e.amount || 0)) + ' ₽',
                badgeColor: 'danger',
                fields: [
                  { label: 'Дата', value: e.created_at ? Utils.formatDate(e.created_at) : '—' },
                ].concat(e.user_name ? [{ label: 'Автор', value: e.user_name }] : []),
                animDelay: i * 0.02,
                onClick: function () { openDetail(e); },
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
          body.replaceChildren();
          body.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate(location.hash.slice(1) || '/home', { replace: true }); } }));
          M.Toast({ message: 'Ошибка загрузки: ' + (e.message || e), type: 'error' });
        }
      }, 0);

      return page;
    },
  };
})();

Router.register('/office-expenses', OfficeExpensesPage);
if (typeof window !== 'undefined') window.OfficeExpensesPage = OfficeExpensesPage;
