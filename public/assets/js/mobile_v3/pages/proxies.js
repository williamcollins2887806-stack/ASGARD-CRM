/**
 * ASGARD CRM — Mobile v3 · Доверенности
 * Окно 4, Страница 10
 * Компоненты: список доверенностей, выбор шаблона, модалка
 */
const ProxiesPage = {
  async render() {
    const el = Utils.el;
    const page = el('div', { className: 'asgard-proxies-page' });
    let items = [];
    let filter = 'all';

    page.appendChild(M.Header({
      title: 'Доверенности',
      subtitle: 'ДОКУМЕНТЫ',
      back: true,
      backHref: '/home',
    }));

    page.appendChild(M.FilterPills({
      items: [
        { label: 'Все', value: 'all', active: true },
        { label: 'Действующие', value: 'active' },
        { label: 'Истекшие', value: 'expired' },
      ],
      onChange: (v) => { filter = v; renderList(); },
    }));

    const listWrap = el('div', { style: { padding: '8px 0', minHeight: '200px' } });
    page.appendChild(listWrap);

    async function load() {
      listWrap.replaceChildren();
      listWrap.appendChild(M.Skeleton({ type: 'card', count: 4 }));
      try {
        const resp = await API.fetch('/proxies?limit=100');
        items = Array.isArray(resp) ? resp : (resp.data || []);
        renderList();
      } catch (_) {
        listWrap.replaceChildren();
        listWrap.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate(location.hash.slice(1) || '/home', { replace: true }); } }));
      }
    }

    function renderList() {
      listWrap.replaceChildren();
      const now = Date.now();
      const filtered = items.filter(p => {
        if (filter === 'active') return !p.end_date || new Date(p.end_date) >= now;
        if (filter === 'expired') return p.end_date && new Date(p.end_date) < now;
        return true;
      });

      if (!filtered.length) {
        listWrap.appendChild(M.Empty({ text: 'Нет доверенностей', icon: '📋' }));
        return;
      }

      const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 var(--sp-page)' } });
      filtered.forEach((p, i) => {
        const isExpired = p.end_date && new Date(p.end_date) < now;
        wrap.appendChild(M.Card({
          title: p.title || p.number || 'Доверенность',
          subtitle: p.representative_name || p.trustee_name || '',
          badge: isExpired ? 'Истекла' : 'Действующая',
          badgeColor: isExpired ? 'danger' : 'success',
          fields: [
            ...(p.number ? [{ label: '№', value: p.number }] : []),
            ...(p.start_date ? [{ label: 'От', value: Utils.formatDate(p.start_date) }] : []),
            ...(p.end_date ? [{ label: 'До', value: Utils.formatDate(p.end_date) }] : []),
            ...(p.template_name ? [{ label: 'Шаблон', value: p.template_name }] : []),
          ],
          onClick: () => viewProxySheet(p),
          animDelay: i * 0.03,
        }));
      });
      listWrap.appendChild(wrap);
    }

    page.appendChild(M.FAB({
      icon: '+',
      onClick: () => createProxySheet(),
    }));

    load();
    return page;
  },
};

function viewProxySheet(p) {
  const content = Utils.el('div');
  content.appendChild(M.DetailFields({
    fields: [
      { label: 'Название', value: p.title || '—' },
      { label: '№', value: p.number || '—' },
      { label: 'Доверитель', value: p.grantor_name || '—' },
      { label: 'Представитель', value: p.representative_name || p.trustee_name || '—' },
      { label: 'Дата выдачи', value: p.start_date ? Utils.formatDate(p.start_date) : '—' },
      { label: 'Действует до', value: p.end_date ? Utils.formatDate(p.end_date) : '—' },
      { label: 'Шаблон', value: p.template_name || '—' },
      { label: 'Полномочия', value: p.scope || p.description || '—' },
    ],
  }));

  if (p.file_url || p.file_id) {
    const btn = Utils.el('div');
    btn.style.marginTop = '16px';
    btn.appendChild(M.FullWidthBtn({
      label: '📥 Скачать',
      variant: 'secondary',
      onClick: () => window.open(p.file_url || '/api/proxies/' + p.id + '/file', '_blank'),
    }));
    content.appendChild(btn);
  }

  M.BottomSheet({ title: '📋 ' + (p.title || 'Доверенность'), content, fullscreen: true });
}

function createProxySheet() {
  const content = Utils.el('div');
  content.appendChild(M.Form({
    fields: [
      { id: 'template', label: 'Шаблон', type: 'select', options: [
        { value: 'general', label: 'Генеральная' },
        { value: 'material', label: 'На получение ТМЦ' },
        { value: 'representation', label: 'На представление интересов' },
        { value: 'custom', label: 'Произвольная' },
      ], required: true },
      { id: 'representative_name', label: 'Представитель (ФИО)', type: 'text', required: true },
      { id: 'start_date', label: 'Дата выдачи', type: 'date', required: true },
      { id: 'end_date', label: 'Действует до', type: 'date', required: true },
      { id: 'scope', label: 'Полномочия', type: 'textarea' },
    ],
    submitLabel: 'Создать',
    onSubmit: async (data) => {
      try {
        await API.fetch('/proxies', { method: 'POST', body: data });
        M.Toast({ message: 'Доверенность создана', type: 'success' });
        Router.navigate('/proxies');
      } catch (_) { M.Toast({ message: 'Ошибка', type: 'error' }); }
    },
  }));
  M.BottomSheet({ title: '📋 Новая доверенность', content, fullscreen: true });
}

Router.register('/proxies', ProxiesPage);
if (typeof window !== 'undefined') window.ProxiesPage = ProxiesPage;
