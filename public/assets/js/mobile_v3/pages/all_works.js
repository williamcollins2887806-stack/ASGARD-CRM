/**
 * ASGARD CRM — Mobile v3: Все работы
 * Route: #/all-works
 * API: GET /api/works?limit=500
 */
const AllWorksPage = {
  async render() {
    const el = Utils.el;

    function statusColor(st) {
      const s = (st || '').toLowerCase();
      if (s.includes('сдали') || s.includes('завершен') || s.includes('закрыт')) return 'success';
      if (s.includes('выполнен') || s.includes('в работе') || s.includes('мобилиз')) return 'info';
      if (s.includes('пауз') || s.includes('ожидан') || s.includes('подписан')) return 'warning';
      if (s.includes('отмен') || s.includes('просроч')) return 'danger';
      return 'neutral';
    }

    let works = [];

    async function loadData() {
      try {
        const data = await API.fetch('/works?limit=500');
        works = Array.isArray(data) ? data : (data.works || data.data || []);
      } catch (e) {
        console.error('[AllWorks] Load error:', e);
        works = [];
      }
    }

    await loadData();

    // Collect unique PMs for filter
    const pmNames = [...new Set(works.map(w => w.pm_name).filter(Boolean))];
    const pmPills = [
      { label: 'Все', value: 'all', active: true },
      ...pmNames.slice(0, 6).map(n => ({ label: n.split(' ').map(p => p[0]).join(''), value: n })),
    ];

    function getStats() {
      const active = works.filter(w => !['Работы сдали', 'Закрыто', 'Отменено'].includes(w.work_status));
      const total = works.reduce((s, w) => s + (parseFloat(w.contract_amount || w.budget || 0)), 0);
      return [
        { icon: '🏗', label: 'Всего', value: works.length },
        { icon: '⚡', label: 'Активных', value: active.length, color: 'var(--blue)' },
        { icon: '💰', label: 'Общий бюджет', value: Utils.formatMoney(total) },
        { icon: '👥', label: 'РП', value: pmNames.length },
      ];
    }

    const page = M.TablePage({
      title: 'Все работы',
      subtitle: 'КОМПАНИЯ',
      back: true,
      backHref: '/home',
      search: true,
      stats: getStats(),
      filter: {
        pills: pmPills,
        filterFn: (item, filter) => {
          if (filter === 'all') return true;
          return item.pm_name === filter;
        },
      },
      items: works,
      renderItem: (w, i) => {
        const progress = parseInt(w.progress || w.completion || 0);
        const card = M.Card({
          title: w.customer_name || w.title || 'Работа #' + w.id,
          subtitle: w.work_title || '',
          badge: w.work_status || 'Новая',
          badgeColor: statusColor(w.work_status),
          fields: [
            { label: 'РП', value: w.pm_name || '—' },
            { label: 'Бюджет', value: Utils.formatMoney(parseFloat(w.contract_amount || w.budget || 0)) },
          ],
          animDelay: i * 0.02,
          onClick: () => Router.navigate('/pm-works/' + w.id),
        });

        if (progress > 0) {
          const pw = el('div', { style: { padding: '8px 0 0' } });
          pw.appendChild(M.ProgressBar({ value: progress, label: progress + '%' }));
          card.appendChild(pw);
        }

        return card;
      },
      onRefresh: async () => { await loadData(); return works; },
      empty: M.Empty({ text: 'Работ пока нет', icon: '🏗' }),
    });

    return page;
  },
};

Router.register('/all-works', AllWorksPage);
if (typeof window !== 'undefined') window.AllWorksPage = AllWorksPage;
