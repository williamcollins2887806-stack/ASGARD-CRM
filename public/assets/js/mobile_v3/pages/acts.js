/**
 * ASGARD CRM — Mobile v3 · Акты
 * Окно 4, Страница 11
 * Компоненты: список актов, pill-статус, модалка
 */
const ActsPage = {
  async render() {
    const el = Utils.el;
    const page = el('div', { className: 'asgard-acts-page' });
    let items = [];
    let filter = 'all';

    page.appendChild(M.Header({
      title: 'Акты',
      subtitle: 'ФИНАНСЫ',
      back: true,
      backHref: '/home',
    }));

    page.appendChild(M.SearchBar({
      placeholder: 'Поиск актов...',
      sticky: true,
      onSearch: (q) => renderList(q),
    }));

    page.appendChild(M.FilterPills({
      items: [
        { label: 'Все', value: 'all', active: true },
        { label: 'Черновик', value: 'draft' },
        { label: 'На подписании', value: 'signing' },
        { label: 'Подписан', value: 'signed' },
        { label: 'Оплачен', value: 'paid' },
      ],
      onChange: (v) => { filter = v; renderList(''); },
    }));

    const statsWrap = el('div', { style: { marginTop: '8px' } });
    page.appendChild(statsWrap);

    const listWrap = el('div', { style: { padding: '8px 0', minHeight: '200px' } });
    page.appendChild(listWrap);

    async function load() {
      listWrap.replaceChildren();
      listWrap.appendChild(M.Skeleton({ type: 'card', count: 4 }));
      try {
        const resp = await API.fetch('/acts?limit=200');
        items = API.extractRows(resp);

        // Stats
        statsWrap.replaceChildren();
        const totalSum = items.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
        const signedCount = items.filter(a => a.status === 'signed' || a.status === 'paid').length;
        statsWrap.appendChild(M.Stats({
          items: [
            { icon: '📑', label: 'Всего', value: items.length },
            { icon: '✅', label: 'Подписано', value: signedCount, color: DS.t.green },
            { icon: '💰', label: 'Сумма', value: Math.round(totalSum), color: DS.t.gold },
          ],
        }));

        renderList('');
      } catch (_) {
        listWrap.replaceChildren();
        M.Toast({ message: 'Ошибка загрузки', type: 'error' });
        listWrap.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate(location.hash.slice(1) || '/home', { replace: true }); } }));
      }
    }

    function renderList(query) {
      listWrap.replaceChildren();
      const q = (query || '').toLowerCase();
      const filtered = items.filter(a => {
        if (filter !== 'all' && a.status !== filter) return false;
        if (q && !(a.number || '').toLowerCase().includes(q) && !(a.work_title || a.title || '').toLowerCase().includes(q) && !(a.customer_name || '').toLowerCase().includes(q)) return false;
        return true;
      });

      if (!filtered.length) {
        listWrap.appendChild(M.Empty({ text: q ? 'Ничего не найдено' : 'Нет актов', type: q ? 'search' : 'default', icon: '📑' }));
        return;
      }

      const statusMap = { draft: 'neutral', signing: 'warning', signed: 'success', paid: 'info', cancelled: 'danger' };
      const statusLabel = { draft: 'Черновик', signing: 'На подписании', signed: 'Подписан', paid: 'Оплачен', cancelled: 'Отменён' };

      const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 var(--sp-page)' } });
      filtered.forEach((act, i) => {
        wrap.appendChild(M.Card({
          title: act.number || act.title || 'Акт',
          subtitle: act.customer_name || act.work_title || '',
          badge: statusLabel[act.status] || act.status || '',
          badgeColor: statusMap[act.status] || 'neutral',
          time: act.date ? Utils.formatDate(act.date) : '',
          fields: [
            ...(act.amount ? [{ label: 'Сумма', value: Utils.formatMoney(act.amount) }] : []),
            ...(act.work_title ? [{ label: 'Работа', value: act.work_title }] : []),
          ],
          onClick: () => viewActSheet(act),
          animDelay: i * 0.03,
        }));
      });
      listWrap.appendChild(wrap);
    }

    load();
    return page;
  },
};

function viewActSheet(act) {
  const content = Utils.el('div');
  content.appendChild(M.DetailFields({
    fields: [
      { label: '№', value: act.number || '—' },
      { label: 'Дата', value: act.date ? Utils.formatDate(act.date) : '—' },
      { label: 'Статус', value: act.status || '—' },
      { label: 'Заказчик', value: act.customer_name || '—' },
      { label: 'Работа', value: act.work_title || '—' },
      { label: 'Сумма', value: act.amount ? Utils.formatMoney(act.amount) : '—' },
      { label: 'Сумма с НДС', value: act.amount_with_vat ? Utils.formatMoney(act.amount_with_vat) : '—' },
      { label: 'Ответственный', value: act.responsible_name || '—' },
      { label: 'Примечание', value: act.note || act.comment || '—' },
    ],
  }));

  if (act.file_url || act.file_id) {
    const btn = Utils.el('div');
    btn.style.marginTop = '16px';
    btn.appendChild(M.FullWidthBtn({
      label: '📥 Скачать акт',
      variant: 'secondary',
      onClick: () => window.open(act.file_url || '/api/acts/' + act.id + '/file', '_blank'),
    }));
    content.appendChild(btn);
  }

  M.BottomSheet({ title: '📑 Акт ' + (act.number || ''), content, fullscreen: true });
}

Router.register('/acts', ActsPage);
if (typeof window !== 'undefined') window.ActsPage = ActsPage;
