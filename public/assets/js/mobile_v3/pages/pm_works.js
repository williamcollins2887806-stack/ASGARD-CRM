/**
 * ASGARD CRM — Mobile v3: Мои работы (РП)
 * Route: #/pm-works
 * API: GET /api/works
 */
var PMWorksPage = (function () {
  'use strict';

  var el = Utils.el;

  function statusColor(st) {
    var s = (st || '').toLowerCase();
    if (s.includes('сдали') || s.includes('завершен') || s.includes('закрыт')) return 'success';
    if (s.includes('выполнен') || s.includes('в работе') || s.includes('мобилиз')) return 'info';
    if (s.includes('пауз') || s.includes('ожидан') || s.includes('подписан')) return 'warning';
    if (s.includes('отмен') || s.includes('просроч')) return 'danger';
    if (s.includes('подготовк') || s.includes('новая') || s.includes('черновик')) return 'neutral';
    return 'info';
  }

  function getStats(works) {
    var active = works.filter(function (w) {
      return ['Работы сдали', 'Закрыто', 'Отменено'].indexOf(w.work_status) === -1;
    });
    var totalBudget = works.reduce(function (s, w) { return s + (parseFloat(w.contract_amount || w.budget || 0)); }, 0);
    return [
      { icon: '🔧', label: 'Всего работ', value: works.length },
      { icon: '⚡', label: 'Активных', value: active.length, color: 'var(--blue)' },
      { icon: '💰', label: 'Бюджет', value: Utils.formatMoney(totalBudget) },
      { icon: '✅', label: 'Завершено', value: works.filter(function (w) { return w.work_status === 'Работы сдали'; }).length, color: 'var(--green)' },
    ];
  }

  return {
    render: function () {
      var user = Store.get('user') || {};
      var works = [];

      async function loadData() {
        var data = await API.fetch('/works');
        var list = API.extractRows(data);
        works = list.filter(function (w) { return w.pm_id === user.id || w.pm_id === user.user_id; });
        return works;
      }

      var page = M.TablePage({
        title: 'Мои работы',
        subtitle: 'РАБОТЫ',
        back: false,
        search: true,
        stats: getStats([]),
        filter: {
          pills: [
            { label: 'Все', value: 'all', active: true },
            { label: 'В работе', value: 'active' },
            { label: 'Завершены', value: 'done' },
            { label: 'На паузе', value: 'paused' },
          ],
          filterFn: function (item, filter) {
            if (filter === 'all') return true;
            var st = (item.work_status || '').toLowerCase();
            if (filter === 'active') return st.includes('работ') || st.includes('выполнен') || st.includes('мобилиз') || st.includes('подготовк');
            if (filter === 'done') return st.includes('сдали') || st.includes('завершен') || st.includes('закрыт');
            if (filter === 'paused') return st.includes('пауз');
            return true;
          },
        },
        items: [],
        renderItem: function (w, i) {
          var progress = parseInt(w.progress || w.completion || 0);
          var card = M.Card({
            title: w.customer_name || w.title || 'Работа #' + w.id,
            subtitle: w.work_title || w.object_name || '',
            badge: w.work_status || 'Новая',
            badgeColor: statusColor(w.work_status),
            fields: [
              { label: 'Объект', value: w.object_name || '—' },
              { label: 'Бюджет', value: Utils.formatMoney(parseFloat(w.contract_amount || w.budget || 0)) },
            ],
            animDelay: i * 0.03,
            onClick: function () { Router.navigate('/pm-works/' + w.id); },
          });

          if (progress > 0) {
            var pw = el('div', { style: { padding: '8px 0 0' } });
            pw.appendChild(M.ProgressBar({ value: progress, label: progress + '%' }));
            card.appendChild(pw);
          }

          return card;
        },
        onRefresh: async function () {
          try {
            return await loadData();
          } catch (e) {
            M.Toast({ message: 'Ошибка загрузки работ', type: 'error' });
            return [];
          }
        },
        empty: M.Empty({ text: 'Нет работ, воин', icon: '🔧' }),
      });

      var listEl = page.querySelector('.asgard-table-page__list');
      if (listEl) listEl.replaceChildren(M.Skeleton({ type: 'card', count: 5 }));
      setTimeout(function () { window.dispatchEvent(new Event('asgard:refresh')); }, 0);

      return page;
    },
  };
})();

/* ── Detail page ── */
var PMWorkDetailPage = (function () {
  'use strict';

  var el = Utils.el;

  return {
    render: function (params) {
      var id = params.id;
      var page = el('div', { style: { paddingBottom: '40px' } });
      page.appendChild(M.Header({ title: 'Работа', subtitle: 'ДЕТАЛИ', back: true, backHref: '/pm-works' }));

      var body = el('div', { style: { padding: '12px 0' } });
      body.appendChild(M.Skeleton({ type: 'card', count: 3 }));
      page.appendChild(body);

      setTimeout(async function () {
        try {
          var w = await API.fetch('/works/' + id);
          body.replaceChildren();

          var heroWrap = el('div', { style: { padding: '12px 20px' } });
          heroWrap.appendChild(M.HeroCard({
            label: w.customer_name || 'Работа',
            value: Utils.formatMoney(parseFloat(w.contract_amount || w.budget || 0)),
            valueSuffix: ' ₽',
            details: [
              { label: 'Статус', value: w.work_status || '—' },
              { label: 'Прогресс', value: (w.progress || 0) + '%' },
            ],
          }));
          body.appendChild(heroWrap);

          body.appendChild(el('div', { style: { height: '12px' } }));
          body.appendChild(M.DetailFields({
            fields: [
              { label: 'Заказчик', value: w.customer_name || '—' },
              { label: 'Объект', value: w.object_name || '—' },
              { label: 'Название', value: w.work_title || '—' },
              { label: 'Статус', value: w.work_status || '—', type: 'badge', badgeColor: 'info' },
              { label: 'Дата начала', value: w.start_date ? Utils.formatDate(w.start_date) : '—' },
              { label: 'Дата окончания', value: w.end_date ? Utils.formatDate(w.end_date) : '—' },
              { label: 'Бюджет', value: Utils.formatMoney(parseFloat(w.contract_amount || w.budget || 0)) + ' ₽' },
              { label: 'РП', value: w.pm_name || '—' },
            ],
          }));
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

Router.register('/pm-works', PMWorksPage);
Router.register('/pm-works/:id', PMWorkDetailPage);
if (typeof window !== 'undefined') {
  window.PMWorksPage = PMWorksPage;
  window.PMWorkDetailPage = PMWorkDetailPage;
}
