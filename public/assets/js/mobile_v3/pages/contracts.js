/**
 * ASGARD CRM — Mobile v3 · Договоры
 * Окно 4, Страница 8
 * Компоненты: список договоров, pill-статус, модалка деталей
 */
const ContractsPage = {
  async render() {
    const el = Utils.el;
    const page = el('div', { className: 'asgard-contracts-page' });
    let items = [];
    let filter = 'all';

    page.appendChild(M.Header({
      title: 'Договоры',
      subtitle: 'ДОКУМЕНТЫ',
      back: true,
      backHref: '/home',
    }));

    page.appendChild(M.SearchBar({
      placeholder: 'Поиск договоров...',
      sticky: true,
      onSearch: (q) => renderList(q),
    }));

    page.appendChild(M.FilterPills({
      items: [
        { label: 'Все', value: 'all', active: true },
        { label: 'Действующие', value: 'active' },
        { label: 'На подписании', value: 'signing' },
        { label: 'Завершённые', value: 'completed' },
      ],
      onChange: (v) => { filter = v; renderList(''); },
    }));

    const listWrap = el('div', { style: { padding: '8px 0', minHeight: '200px' } });
    page.appendChild(listWrap);

    async function load() {
      listWrap.innerHTML = '';
      listWrap.appendChild(M.Skeleton({ type: 'card', count: 4 }));
      try {
        const resp = await API.fetch('/contracts?limit=100');
        items = Array.isArray(resp) ? resp : (resp.data || []);
        renderList('');
      } catch (_) {
        listWrap.innerHTML = '';
        listWrap.appendChild(M.Empty({ text: 'Ошибка загрузки', type: 'error' }));
      }
    }

    function renderList(query) {
      listWrap.innerHTML = '';
      const q = (query || '').toLowerCase();
      const filtered = items.filter(c => {
        if (filter !== 'all' && c.status !== filter) return false;
        if (q && !(c.title || '').toLowerCase().includes(q) && !(c.number || '').toLowerCase().includes(q) && !(c.contractor_name || '').toLowerCase().includes(q)) return false;
        return true;
      });

      if (!filtered.length) {
        listWrap.appendChild(M.Empty({ text: q ? 'Ничего не найдено' : 'Нет договоров', type: q ? 'search' : 'default', icon: '📑' }));
        return;
      }

      const statusMap = { active: 'success', signing: 'warning', draft: 'neutral', completed: 'info', cancelled: 'danger' };
      const statusLabel = { active: 'Действующий', signing: 'На подписании', draft: 'Черновик', completed: 'Завершён', cancelled: 'Расторгнут' };

      const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 var(--sp-page)' } });
      filtered.forEach((c, i) => {
        wrap.appendChild(M.Card({
          title: c.title || c.number || 'Договор',
          subtitle: c.contractor_name || '',
          badge: statusLabel[c.status] || c.status || '',
          badgeColor: statusMap[c.status] || 'neutral',
          time: c.date ? Utils.formatDate(c.date) : '',
          fields: [
            ...(c.number ? [{ label: '№', value: c.number }] : []),
            ...(c.amount ? [{ label: 'Сумма', value: Utils.formatMoney(c.amount) }] : []),
            ...(c.end_date ? [{ label: 'До', value: Utils.formatDate(c.end_date) }] : []),
          ],
          onClick: () => viewContractSheet(c),
          animDelay: i * 0.03,
        }));
      });
      listWrap.appendChild(wrap);
    }

    load();
    return page;
  },
};

function viewContractSheet(c) {
  const content = document.createElement('div');
  content.appendChild(M.DetailFields({
    fields: [
      { label: 'Название', value: c.title || '—' },
      { label: '№', value: c.number || '—' },
      { label: 'Контрагент', value: c.contractor_name || '—' },
      { label: 'Статус', value: c.status || '—' },
      { label: 'Дата', value: c.date ? Utils.formatDate(c.date) : '—' },
      { label: 'Действует до', value: c.end_date ? Utils.formatDate(c.end_date) : '—' },
      { label: 'Сумма', value: c.amount ? Utils.formatMoney(c.amount) : '—' },
      { label: 'Тип', value: c.type || '—' },
      { label: 'Ответственный', value: c.responsible_name || '—' },
      { label: 'Примечание', value: c.note || c.comment || '—' },
    ],
  }));

  if (c.file_url || c.file_id) {
    const btn = document.createElement('div');
    btn.style.marginTop = '16px';
    btn.appendChild(M.FullWidthBtn({
      label: '📥 Скачать договор',
      variant: 'secondary',
      onClick: () => window.open(c.file_url || '/api/contracts/' + c.id + '/file', '_blank'),
    }));
    content.appendChild(btn);
  }

  M.BottomSheet({ title: '📑 ' + (c.title || 'Договор'), content, fullscreen: true });
}

Router.register('/contracts', ContractsPage);
if (typeof window !== 'undefined') window.ContractsPage = ContractsPage;
