/**
 * ASGARD CRM — Mobile v3: Мои работы (РП)
 * Route: #/pm-works
 * API: GET /api/works
 */
const PMWorksPage = {
  async render() {
    const el = Utils.el;
    const user = Store.get('user') || {};

    // Status → badge color mapping
    function statusColor(st) {
      const s = (st || '').toLowerCase();
      if (s.includes('сдали') || s.includes('завершен') || s.includes('закрыт')) return 'success';
      if (s.includes('выполнен') || s.includes('в работе') || s.includes('мобилиз')) return 'info';
      if (s.includes('пауз') || s.includes('ожидан') || s.includes('подписан')) return 'warning';
      if (s.includes('отмен') || s.includes('просроч')) return 'danger';
      if (s.includes('подготовк') || s.includes('новая') || s.includes('черновик')) return 'neutral';
      return 'info';
    }

    // Load data
    let works = [];
    let loading = true;

    async function loadData() {
      try {
        const data = await API.fetch('/works');
        const list = Array.isArray(data) ? data : (data.works || data.data || []);
        // Filter to current PM
        works = list.filter(w => w.pm_id === user.id || w.pm_id === user.user_id);
      } catch (e) {
        console.error('[PMWorks] Load error:', e);
        works = [];
      }
      loading = false;
    }

    // Compute stats
    function getStats() {
      const active = works.filter(w => !['Работы сдали', 'Закрыто', 'Отменено'].includes(w.work_status));
      const totalBudget = works.reduce((s, w) => s + (parseFloat(w.contract_amount || w.budget || 0)), 0);
      return [
        { icon: '🔧', label: 'Всего работ', value: works.length },
        { icon: '⚡', label: 'Активных', value: active.length, color: 'var(--blue)' },
        { icon: '💰', label: 'Бюджет', value: Utils.formatMoney(totalBudget) },
        { icon: '✅', label: 'Завершено', value: works.filter(w => w.work_status === 'Работы сдали').length, color: 'var(--green)' },
      ];
    }

    // Build page using TablePage component
    await loadData();

    const page = M.TablePage({
      title: 'Мои работы',
      subtitle: 'РАБОТЫ',
      back: false,
      search: true,
      stats: getStats(),
      filter: {
        pills: [
          { label: 'Все', value: 'all', active: true },
          { label: 'В работе', value: 'active' },
          { label: 'Завершены', value: 'done' },
          { label: 'На паузе', value: 'paused' },
        ],
        filterFn: (item, filter) => {
          if (filter === 'all') return true;
          const st = (item.work_status || '').toLowerCase();
          if (filter === 'active') return st.includes('работ') || st.includes('выполнен') || st.includes('мобилиз') || st.includes('подготовк');
          if (filter === 'done') return st.includes('сдали') || st.includes('завершен') || st.includes('закрыт');
          if (filter === 'paused') return st.includes('пауз');
          return true;
        },
      },
      items: works,
      renderItem: (w, i) => {
        const progress = parseInt(w.progress || w.completion || 0);
        const card = M.Card({
          title: w.customer_name || w.title || 'Работа #' + w.id,
          subtitle: w.work_title || w.object_name || '',
          badge: w.work_status || 'Новая',
          badgeColor: statusColor(w.work_status),
          fields: [
            { label: 'Объект', value: w.object_name || '—' },
            { label: 'Бюджет', value: Utils.formatMoney(parseFloat(w.contract_amount || w.budget || 0)) },
          ],
          animDelay: i * 0.03,
          onClick: () => Router.navigate('/pm-works/' + w.id),
        });

        // Progress bar
        if (progress > 0) {
          const pw = el('div', { style: { padding: '8px 0 0' } });
          pw.appendChild(M.ProgressBar({ value: progress, label: progress + '%' }));
          card.appendChild(pw);
        }

        return card;
      },
      onRefresh: async () => {
        await loadData();
        return works;
      },
      empty: M.Empty({ text: 'Нет работ, воин', icon: '🔧' }),
    });

    return page;
  },
};

// Detail page
const PMWorkDetailPage = {
  async render(params) {
    const el = Utils.el;
    const id = params.id;

    const page = el('div', { style: { paddingBottom: '40px' } });
    page.appendChild(M.Header({ title: 'Работа', subtitle: 'ДЕТАЛИ', back: true, backHref: '/pm-works' }));

    // Loading
    const body = el('div', { style: { padding: '12px 0' } });
    body.appendChild(M.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(body);

    try {
      const w = await API.fetch('/works/' + id);
      body.innerHTML = '';

      // Hero
      const heroWrap = el('div', { style: { padding: '12px 20px' } });
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

      // Fields
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
      body.innerHTML = '';
      body.appendChild(M.Empty({ text: 'Не удалось загрузить', type: 'error' }));
    }

    return page;
  },
};

Router.register('/pm-works', PMWorksPage);
Router.register('/pm-works/:id', PMWorkDetailPage);
if (typeof window !== 'undefined') {
  window.PMWorksPage = PMWorksPage;
  window.PMWorkDetailPage = PMWorkDetailPage;
}
