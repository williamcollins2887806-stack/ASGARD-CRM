/**
 * ASGARD CRM — Mobile v3 · Счета
 * Окно 4, Страница 12
 * Компоненты: список счетов, суммы, статусы оплаты, модалка
 */
const InvoicesPage = {
  async render() {
    const el = Utils.el;
    const page = el('div', { className: 'asgard-invoices-page' });
    let items = [];
    let filter = 'all';

    page.appendChild(M.Header({
      title: 'Счета',
      subtitle: 'ФИНАНСЫ',
      back: true,
      backHref: '/home',
    }));

    page.appendChild(M.SearchBar({
      placeholder: 'Поиск счетов...',
      sticky: true,
      onSearch: (q) => renderList(q),
    }));

    page.appendChild(M.FilterPills({
      items: [
        { label: 'Все', value: 'all', active: true },
        { label: 'Неоплачен', value: 'unpaid' },
        { label: 'Частично', value: 'partial' },
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
      listWrap.appendChild(M.Skeleton({ type: 'card', count: 5 }));
      try {
        const resp = await API.fetch('/invoices?limit=200');
        items = Array.isArray(resp) ? resp : (resp.data || []);

        // Stats
        statsWrap.replaceChildren();
        const totalSum = items.reduce((s, inv) => s + (parseFloat(inv.amount) || 0), 0);
        const paidSum = items.filter(inv => inv.status === 'paid').reduce((s, inv) => s + (parseFloat(inv.amount) || 0), 0);
        const unpaidSum = totalSum - paidSum;
        statsWrap.appendChild(M.Stats({
          items: [
            { icon: '📄', label: 'Всего', value: items.length },
            { icon: '✅', label: 'Оплачено', value: Math.round(paidSum), color: DS.t.green },
            { icon: '⏳', label: 'К оплате', value: Math.round(unpaidSum), color: DS.t.orange },
          ],
        }));

        renderList('');
      } catch (_) {
        listWrap.replaceChildren();
        M.Toast({ message: 'Ошибка загрузки', type: 'error' });
        listWrap.appendChild(M.Empty({ text: 'Ошибка загрузки', type: 'error' }));
      }
    }

    function renderList(query) {
      listWrap.replaceChildren();
      const q = (query || '').toLowerCase();
      const filtered = items.filter(inv => {
        if (filter !== 'all' && inv.status !== filter) return false;
        if (q && !(inv.number || '').toLowerCase().includes(q) && !(inv.customer_name || '').toLowerCase().includes(q) && !(inv.work_name || '').toLowerCase().includes(q)) return false;
        return true;
      });

      if (!filtered.length) {
        listWrap.appendChild(M.Empty({ text: q ? 'Ничего не найдено' : 'Нет счетов', type: q ? 'search' : 'default', icon: '📄' }));
        return;
      }

      const statusMap = { unpaid: 'danger', partial: 'warning', paid: 'success', cancelled: 'neutral' };
      const statusLabel = { unpaid: 'Неоплачен', partial: 'Частично', paid: 'Оплачен', cancelled: 'Отменён' };

      const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 var(--sp-page)' } });
      filtered.forEach((inv, i) => {
        wrap.appendChild(M.Card({
          title: '№' + (inv.number || '—') + (inv.customer_name ? ' • ' + inv.customer_name : ''),
          subtitle: inv.work_name || '',
          badge: statusLabel[inv.status] || inv.status || '',
          badgeColor: statusMap[inv.status] || 'neutral',
          time: inv.date ? Utils.formatDate(inv.date) : '',
          fields: [
            { label: 'Сумма', value: inv.amount ? Utils.formatMoney(inv.amount) : '—' },
            ...(inv.paid_amount != null && inv.status === 'partial' ? [{ label: 'Оплачено', value: Utils.formatMoney(inv.paid_amount) }] : []),
            ...(inv.due_date ? [{ label: 'Срок оплаты', value: Utils.formatDate(inv.due_date) }] : []),
          ],
          onClick: () => viewInvoiceSheet(inv),
          animDelay: i * 0.03,
        }));
      });
      listWrap.appendChild(wrap);
    }

    load();
    return page;
  },
};

function viewInvoiceSheet(inv) {
  const el = Utils.el;
  const t = DS.t;
  const content = el('div');

  content.appendChild(M.DetailFields({
    fields: [
      { label: '№', value: inv.number || '—' },
      { label: 'Дата', value: inv.date ? Utils.formatDate(inv.date) : '—' },
      { label: 'Статус', value: inv.status || '—' },
      { label: 'Заказчик', value: inv.customer_name || '—' },
      { label: 'Работа', value: inv.work_name || '—' },
      { label: 'Сумма', value: inv.amount ? Utils.formatMoney(inv.amount) : '—' },
      { label: 'Сумма с НДС', value: inv.amount_with_vat ? Utils.formatMoney(inv.amount_with_vat) : '—' },
      { label: 'Оплачено', value: inv.paid_amount != null ? Utils.formatMoney(inv.paid_amount) : '—' },
      { label: 'Срок оплаты', value: inv.due_date ? Utils.formatDate(inv.due_date) : '—' },
      { label: 'Примечание', value: inv.note || inv.comment || '—' },
    ],
  }));

  // Payment progress
  if (inv.amount && inv.paid_amount != null) {
    const pctPaid = Math.round((inv.paid_amount / inv.amount) * 100);
    const progWrap = el('div', { style: { marginTop: '16px' } });
    progWrap.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textSec, marginBottom: '6px' }, textContent: 'Оплата' }));
    progWrap.appendChild(M.ProgressBar({ value: pctPaid, label: pctPaid + '%' }));
    content.appendChild(progWrap);
  }

  if (inv.file_url || inv.file_id) {
    const btn = el('div', { style: { marginTop: '16px' } });
    btn.appendChild(M.FullWidthBtn({
      label: '📥 Скачать счёт',
      variant: 'secondary',
      onClick: () => window.open(inv.file_url || '/api/invoices/' + inv.id + '/file', '_blank'),
    }));
    content.appendChild(btn);
  }

  M.BottomSheet({ title: '📄 Счёт ' + (inv.number || ''), content, fullscreen: true });
}

Router.register('/invoices', InvoicesPage);
if (typeof window !== 'undefined') window.InvoicesPage = InvoicesPage;
