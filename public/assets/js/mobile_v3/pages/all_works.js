/**
 * ASGARD CRM — Mobile v3: Все работы
 * Route: #/all-works
 * API: GET /api/works?limit=500
 */
var AllWorksPage = (function () {
  'use strict';

  var el = Utils.el;

  function statusColor(st) {
    var s = (st || '').toLowerCase();
    if (s.includes('сдали') || s.includes('завершен') || s.includes('закрыт')) return 'success';
    if (s.includes('выполнен') || s.includes('в работе') || s.includes('мобилиз')) return 'info';
    if (s.includes('пауз') || s.includes('ожидан') || s.includes('подписан')) return 'warning';
    if (s.includes('отмен') || s.includes('просроч')) return 'danger';
    return 'neutral';
  }

  return {
    render: function () {
      var works = [];

      async function loadData() {
        var data = await API.fetch('/works?limit=500');
        works = API.extractRows(data);
        return works;
      }

      var page = M.TablePage({
        title: 'Все работы',
        subtitle: 'КОМПАНИЯ',
        back: true,
        backHref: '/home',
        search: true,
        stats: [
          { icon: '🏗', label: 'Всего', value: 0 },
          { icon: '⚡', label: 'Активных', value: 0, color: 'var(--blue)' },
          { icon: '💰', label: 'Общий бюджет', value: '—' },
          { icon: '👥', label: 'РП', value: 0 },
        ],
        filter: {
          pills: [{ label: 'Все', value: 'all', active: true }],
          filterFn: function (item, filter) {
            if (filter === 'all') return true;
            return item.pm_name === filter;
          },
        },
        items: [],
        renderItem: function (w, i) {
          var progress = parseInt(w.progress || w.completion || 0);
          var card = M.Card({
            title: w.customer_name || w.title || 'Работа #' + w.id,
            subtitle: w.work_title || '',
            badge: w.work_status || 'Новая',
            badgeColor: statusColor(w.work_status),
            fields: [
              { label: 'РП', value: w.pm_name || '—' },
              { label: 'Бюджет', value: Utils.formatMoney(parseFloat(w.contract_amount || w.budget || 0)) },
            ],
            animDelay: i * 0.02,
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
        empty: M.Empty({ text: 'Работ пока нет', icon: '🏗' }),
      });

      var listEl = page.querySelector('.asgard-table-page__list');
      if (listEl) listEl.replaceChildren(M.Skeleton({ type: 'card', count: 5 }));
      setTimeout(function () { window.dispatchEvent(new Event('asgard:refresh')); }, 0);

      return page;
    },
  };
})();

Router.register('/all-works', AllWorksPage);
if (typeof window !== 'undefined') window.AllWorksPage = AllWorksPage;
