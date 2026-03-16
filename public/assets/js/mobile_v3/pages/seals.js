/**
 * ASGARD CRM — Mobile v3 · Печати
 * Окно 4, Страница 9
 * Компоненты: список печатей, кнопка передачи, модалка
 */
const SealsPage = {
  async render() {
    const el = Utils.el;
    const t = DS.t;
    const page = el('div', { className: 'asgard-seals-page' });
    let items = [];

    page.appendChild(M.Header({
      title: 'Печати',
      subtitle: 'ДОКУМЕНТЫ',
      back: true,
      backHref: '/home',
    }));

    const listWrap = el('div', { style: { padding: '12px 0', minHeight: '200px' } });
    page.appendChild(listWrap);

    async function load() {
      listWrap.replaceChildren();
      listWrap.appendChild(M.Skeleton({ type: 'card', count: 3 }));
      try {
        const resp = await API.fetch('/seals?limit=100');
        items = Array.isArray(resp) ? resp : (resp.data || []);
        renderList();
      } catch (_) {
        listWrap.replaceChildren();
        listWrap.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate(location.hash.slice(1) || '/home', { replace: true }); } }));
      }
    }

    function renderList() {
      listWrap.replaceChildren();
      if (!items.length) {
        listWrap.appendChild(M.Empty({ text: 'Нет печатей', icon: '🔏' }));
        return;
      }

      const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 var(--sp-page)' } });
      items.forEach((seal, i) => {
        wrap.appendChild(M.Card({
          title: seal.name || seal.title || 'Печать',
          subtitle: seal.holder_name ? 'У: ' + seal.holder_name : '',
          badge: seal.status === 'available' ? 'Доступна' : 'Выдана',
          badgeColor: seal.status === 'available' ? 'success' : 'warning',
          fields: [
            ...(seal.number ? [{ label: '№', value: seal.number }] : []),
            ...(seal.type ? [{ label: 'Тип', value: seal.type }] : []),
          ],
          actions: [
            { label: '🔄 Передать', onClick: () => transferSheet(seal) },
          ],
          onClick: () => viewSealSheet(seal),
          animDelay: i * 0.03,
        }));
      });
      listWrap.appendChild(wrap);
    }

    load();
    return page;
  },
};

function viewSealSheet(seal) {
  const content = Utils.el('div');
  content.appendChild(M.DetailFields({
    fields: [
      { label: 'Название', value: seal.name || seal.title || '—' },
      { label: '№', value: seal.number || '—' },
      { label: 'Тип', value: seal.type || '—' },
      { label: 'Статус', value: seal.status || '—' },
      { label: 'Ответственный', value: seal.holder_name || '—' },
      { label: 'Дата выдачи', value: seal.issued_date ? Utils.formatDate(seal.issued_date) : '—' },
      { label: 'Примечание', value: seal.note || '—' },
    ],
  }));

  // Transfer history
  if (seal.history && seal.history.length) {
    const wrap = Utils.el('div');
    wrap.style.marginTop = '16px';
    wrap.appendChild(M.Timeline({
      items: seal.history.map(h => ({
        title: (h.from_name || '?') + ' → ' + (h.to_name || '?'),
        time: h.date ? Utils.formatDate(h.date) : '',
        text: h.comment || '',
      })),
    }));
    content.appendChild(wrap);
  }

  M.BottomSheet({ title: '🔏 ' + (seal.name || 'Печать'), content, fullscreen: true });
}

function transferSheet(seal) {
  const content = Utils.el('div');
  content.appendChild(M.Form({
    fields: [
      { id: 'to_user_id', label: 'Кому передать', type: 'text', required: true, placeholder: 'ФИО сотрудника' },
      { id: 'comment', label: 'Комментарий', type: 'textarea' },
    ],
    submitLabel: 'Передать печать',
    onSubmit: async (data) => {
      try {
        await API.fetch('/seals/' + seal.id + '/transfer', { method: 'POST', body: data });
        M.Toast({ message: 'Печать передана', type: 'success' });
        Router.navigate('/seals');
      } catch (_) { M.Toast({ message: 'Ошибка', type: 'error' }); }
    },
  }));
  M.BottomSheet({ title: '🔄 Передача печати', content });
}

Router.register('/seals', SealsPage);
if (typeof window !== 'undefined') window.SealsPage = SealsPage;
